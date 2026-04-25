/**
 * Agent 主运行入口：单次拉取回复（getReplyFromAgent）与单飞包装（runWithSingleFlight）。
 * 历史 / Hook / 路径调试等见 {@link run.helper.js} 再 export。
 */
import {
  createRuntimeAgentSession,
  runEmbeddedPiAgent,
} from "../pi-embedded-runner/attempt.js";
import { createCacheTrace } from "../utils/cache-trace.js";
import type { RuntimeStreamEvent } from "../utils/events.js";
import { prepareBeforeGetReply } from "./pre-run.js";
import {
  appendCurrentChatSection,
  buildSystemPromptStem,
} from "../system-prompt.js";
import type { AgentLane } from "../../hook/events.js";
import { LANE_HOOK_KIND, PROMPT_BUILD_KIND, TOOL_HOOK_KIND } from "../../hook/events.js";
import {
  readWorkspaceSoul,
  readWorkspaceUserinfoSummary,
} from "../workspace.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { resolveTenantWorkspaceDir } from "../../utils/app-path.js";
import { getSkillManager } from "../skill/skill-manager.js";
import {
  getAllRunningAgentStates,
  tryAcquireAgent,
  releaseAgent,
  bindAgentSession,
} from "../agent-state.js";
import { formatChinaIso } from "../../watch-dog/time.js";
import { BUILTIN_TOOL_NAMES } from "../tool/builtin-tools.js";
import { createToolBundle } from "../tool/tool-bundle.js";
import { getChannelPolicy, type AgentChannel } from "../channel-policy.js";
import { refreshFgbgUserConfigCache } from "../../config/index.js";
import { areTextsOverTokenThreshold } from "../utils/token-counter.js";
import {
  getSessionMessageEntrys,
  invokeAgentHooks,
  pruneSessionChat,
} from "./run.helper.js";

const agentLogger = getSubsystemConsoleLogger("agent");

export {
  clearHistory,
  defaultMainSessionKey,
  getHistory,
  getRecentLaneDialogueForRouter,
  invokeAgentHooks,
  logRuntimePaths,
} from "./run.helper.js";

export type { RouterLaneHistoryLine } from "./run.helper.js";

/** 已选出 provider/model 但 `RuntimeModel` 缺失（如未配置 API Key、模型元数据未加载）时由主链路抛出。 */
export class ModelUnavailableError extends Error {
  provider?: string;
  model?: string;
  detail?: string;

  constructor(params: { provider?: string; model?: string; detail?: string }) {
    super("模型未初始化，请检查 provider/model 与 API Key 配置");
    this.name = "ModelUnavailableError";
    this.provider = params.provider;
    this.model = params.model;
    this.detail = params.detail;
  }
}

export type { AgentLane } from "../../hook/events.js";

export type AgentRunResult =
  | { status: "busy"; message: string; systemError: false }
  | {
      status: "success";
      finalText: string;
      message: string;
      systemError: false;
    }
  | {
      status: "failed";
      message: string;
      systemError: true;
      code?: string;
      detail?: string;
    };

/**
 * 向 Agent 拉取一次回复（完整一轮：准备环境 → 工具 Hook → 建 Pi session → 拼 system prompt 与第二段 Hook →
 * 设入模型 → 跑嵌入式 Pi）。流式进度经 `onEvent` 上抛给 web/IM 等中间层。
 *
 * 与 {@link runWithSingleFlight} 的区别：本函数不抢 agent 互斥锁，仅假设调用方已选好 `sessionKey` / `agentId`。
 *
 * @param params.message 本轮用户输入
 * @param params.onEvent 流式事件（含 token/工具/context 等）
 * @param params.channel 渠道（影响渠道策略、thinking 等）
 * @param params.tenantId 租户，驱动 workspace / session 路径
 * @param params.sessionKey 已解析好的会话键（须与 `agentId` 所代表的模块一致）
 * @param params.agentId 与 agent-state 绑定的实例 id（如 `agent:main:xxx`）
 * @param params.lane 轻量/重量会话模式，影响工具预装等（默认 `heavy`）
 */
export async function getReplyFromAgent(params: {
  message: string;
  onEvent: (event: RuntimeStreamEvent) => void;
  channel: AgentChannel;
  tenantId: string;
  sessionKey: string;
  agentId: string;
  lane?: AgentLane;
}): Promise<string> {
  agentLogger.debug(
    `getReplyFromAgent params=${JSON.stringify(params)}`,
  );
  // 刷新配置缓存，确保使用最新的模型配置
  refreshFgbgUserConfigCache();

  const {
    message,
    onEvent,
    channel,
    tenantId,
    sessionKey,
    agentId,
    lane = "heavy",
  } = params;

  // 阶段一：与本次请求绑定的环境（模型、工作目录、session 文件、默认 PromptHook+ToolHook 等）
  const prepared = await prepareBeforeGetReply({
    tenantId,
    sessionKey,
    channel,
  });

  const modelRef = prepared.modelRef;
  const model = prepared.model;
  const modelError = prepared.modelError;
  const discoveryError = prepared.discoveryError;

  // 记录模型发现错误（不阻塞，可能是非关键问题）
  if (discoveryError) {
    agentLogger.error(`模型发现失败: ${discoveryError}`);
  }

  // 非 ollama 模型需要 API Key，否则记录警告
  if (!prepared.apiKey && modelRef.provider !== "ollama") {
    agentLogger.warn(
      `警告：未配置 ${modelRef.provider.toUpperCase()}_API_KEY，模型可能无法工作`,
    );
  }

  // 模型不可用时抛出错误
  if (!model) {
    throw new ModelUnavailableError({
      provider: modelRef.provider,
      model: modelRef.model,
      detail: modelError,
    });
  }

  // 触发 lane hook：用户输入先落地
  const laneModule = sessionKey.split(":")[1] ?? "main";
  const laneKey = `lane:${laneModule}:${tenantId}`;
  await invokeAgentHooks(prepared.hooks, {
    kind: LANE_HOOK_KIND,
    lane,
    tenantId,
    channel,
    role: "user",
    content: message,
    agentId,
    sessionKey,
    laneKey,
    module: laneModule,
  });

  // 创建请求追踪 trace
  const requestId = Date.now().toString();
  const trace = createCacheTrace({
    requestId,
    provider: modelRef.provider,
    model: modelRef.model,
  });

  // 创建内置工具
  const builtInBundle = createToolBundle(
    prepared.cwd,
    tenantId,
    channel,
    agentId,
    BUILTIN_TOOL_NAMES,
  );

  const toolHookEvent = {
    kind: TOOL_HOOK_KIND,
    lane,
    tenantId,
    channel,
    cwd: prepared.cwd,
    agentId,
    tools: builtInBundle.tools,
    toolings: builtInBundle.toolings,
  };
  await invokeAgentHooks(prepared.hooks, toolHookEvent);

  // 创建运行时 agent session（包含工具链、模型配置、租户隔离）
  const session = await createRuntimeAgentSession({
    model: prepared.model!,
    sessionDir: prepared.sessionDir, // prepared.sessionDir 是租户 session 目录
    sessionFile: prepared.sessionFile, // prepared.sessionFile 是租户 session 文件
    cwd: prepared.cwd, // prepared.cwd 是租户 workspace 目录
    agentDir: prepared.agentDir, // prepared.agentDir 是租户 agent 内部数据目录
    provider: prepared.normalizedProvider, // prepared.normalizedProvider 是规范化后的 provider 名称
    apiKey: prepared.apiKey, // prepared.apiKey 是模型 API Key
    thinkingLevel: prepared.thinkingLevel, // prepared.thinkingLevel 是思考级别
    tenantId: tenantId, // tenantId 是租户 ID
    channel: channel, // channel 是渠道
    agentId, // agentId 是 agent 主键
    customTools: toolHookEvent.tools,
  });
  // 绑定到agent-state. 当前 agent 主运行的容器
  bindAgentSession(agentId, session);

  // 从 session 历史剪枝生成对话上下文字
  const chatHistoryText = pruneSessionChat(
    getSessionMessageEntrys(tenantId, sessionKey),
  );

  let promptText = buildSystemPromptStem({
    soul: readWorkspaceSoul(tenantId),
    user: readWorkspaceUserinfoSummary(tenantId),
    nowText: formatChinaIso(new Date()),
    language: process.env.FGBG_PROMPT_LANGUAGE?.trim() || "zh-CN",
    channel: channel,
    tenantId: tenantId,
  });
  const heavyPayload = {
    workspace: resolveTenantWorkspaceDir(tenantId),
    toolings: toolHookEvent.toolings,
    skillsMeta: getSkillManager(tenantId).getMetaPromptText(),
  };
  const promptBuildEvent = {
    kind: PROMPT_BUILD_KIND,
    lane,
    tenantId,
    channel,
    promptText,
    heavyPayload,
  };
  await invokeAgentHooks(prepared.hooks, promptBuildEvent, {
    logErrors: true,
  });
  const prompt =
    promptBuildEvent.promptText + appendCurrentChatSection(chatHistoryText);
  agentLogger.trace(`prompt: ${prompt}`);

  // 检查提示词总 token 数是否超过模型上下文窗口，决定是否需要压缩
  const maxTokens = prepared.model!.maxTokens;
  const tokenRatio = prepared.model!.tokenRatio || 0.75;
  const compressionResult = areTextsOverTokenThreshold(
    [prompt, message],
    maxTokens,
    tokenRatio,
  );
  const needsCompression = compressionResult.isOver;

  agentLogger.info(
    `maxTokens: ${maxTokens}, tokenRatio: ${tokenRatio}, compressionResult: ${JSON.stringify(compressionResult)}`,
  );

  if (needsCompression) {
    agentLogger.warn(
      `提示词总 Token 数超过阈值: ${compressionResult.totalTokens}/${compressionResult.threshold} (${maxTokens} max)，需要压缩会话`,
    );
  }

  // 设置 system prompt 到 session
  session.agent.setSystemPrompt(prompt);

  // 记录请求阶段开始
  trace.recordStage("request:start");
  trace.recordStage("prompt:start");

  // 事件转发器：在 message_end 时记录 prompt:end
  const emit = (event: RuntimeStreamEvent) => {
    if (event.type === "message_end") trace.recordStage("prompt:end");
    onEvent(event);
  };

  // 发送 context_used 事件，告知前端上下文窗口使用情况
  emit({
    type: "context_used",
    totalTokens: compressionResult.totalTokens,
    threshold: compressionResult.threshold,
    contextWindow: maxTokens,
  });

  // 根据渠道策略决定是否发送 context_snapshot（如 web 端调试用）
  const channelPolicy = getChannelPolicy(channel);
  const emitContextSnapshot = (reason: "before_prompt") => {
    if (!channelPolicy.emitContextSnapshot) return;
    emit({ type: "context_snapshot", seq: 0, reason, contextText: prompt });
  };

  try {
    emitContextSnapshot("before_prompt");
    // 执行嵌入式 PI agent
    const finalText = await runEmbeddedPiAgent({
      session,
      message,
      onEvent: (event) => emit(event),
      needsCompression,
      agentId,
    });
    trace.recordStage("request:end");

    // 触发 lane hook：模型输出后补齐
    await invokeAgentHooks(prepared.hooks, {
      kind: LANE_HOOK_KIND,
      lane,
      tenantId,
      channel,
      role: "assistant",
      content: finalText,
      agentId,
      sessionKey,
      laneKey,
      module: laneModule,
    });

    emit({ type: "done" });
    trace.logTimeline("done");
    return finalText;
  } catch (error) {
    trace.recordStage("request:end");
    const message = error instanceof Error ? error.message : "服务器内部错误";
    agentLogger.error(`[agent] request failed: ${message}`, error);
    trace.logTimeline("error");
    throw error;
  } finally {
    // 释放 session 资源
    session.dispose();
  }
}

export { getAllRunningAgentStates };

/**
 * 以单飞模式运行 agent：同一 agentId（module + tenantId）同时只允许一个执行。
 * 不同 module 的同租户 agent 可以并发（如 watch-dog 与 main 互不阻塞）。
 *
 * @param params.tenantId 租户 ID
 * @param params.module   模块名，决定锁粒度与 session 隔离（channel 来源传 "main"，watch-dog 传 "watch-dog"）
 * @param params.watchDogTaskId 仅 `module === "watch-dog"` 时必填，用于组装独立任务会话
 * @param params.channel 当前渠道
 * @param params.message 用户消息
 * @param params.onEvent 流式事件回调
 * @param params.onAccepted 成功获取锁（开始执行）时的回调
 */
export async function runWithSingleFlight(params: {
  message: string;
  onEvent?: (event: RuntimeStreamEvent) => void;
  onAccepted?: () => void | Promise<void>;
  tenantId: string;
  module: string;
  watchDogTaskId?: string;
  channel: AgentChannel;
  lane?: AgentLane;
}): Promise<AgentRunResult> {
  const {
    message,
    onEvent,
    onAccepted,
    tenantId,
    module: mod,
    channel,
    lane = "heavy",
  } = params;
  const emitEvent = onEvent ?? (() => {});

  // 锁 key 由 module + tenantId 组成，不同 module 的同租户 agent 可并发
  const agentId = `agent:${mod}:${tenantId}`;
  const sessionKey = `session:${mod}:${lane}:${tenantId}`;

  if (!tryAcquireAgent(agentId, tenantId, channel)) {
    return {
      status: "busy",
      message: "指令正在运行中，请稍后",
      systemError: false,
    };
  }

  try {
    await onAccepted?.();
    const finalText = await getReplyFromAgent({
      message,
      onEvent: emitEvent,
      channel,
      tenantId,
      sessionKey,
      agentId,
      lane,
    });
    return {
      status: "success",
      finalText,
      message: finalText,
      systemError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务器内部错误";
    agentLogger.error(`[agent] singleFlight failed: ${message}`, error);
    // model异常
    if (error instanceof ModelUnavailableError) {
      const detail = [
        error.provider ? `provider=${error.provider}` : "",
        error.model ? `model=${error.model}` : "",
        error.detail ? `detail=${error.detail}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return {
        status: "failed",
        message,
        systemError: true,
        code: "MODEL_UNAVAILABLE",
        detail: detail || undefined,
      };
    }
    const normalized = message.toLowerCase();
    const isAborted =
      normalized.includes("request was aborted") ||
      normalized.includes("aborted") ||
      normalized.includes("idle too long") ||
      normalized.includes("stopped by -stop command");
    // 系统内部异常
    return {
      status: "failed",
      message: isAborted ? `任务已中断：${message}` : message,
      systemError: true,
      code: isAborted ? "AGENT_ABORTED" : "INTERNAL_ERROR",
    };
  } finally {
    releaseAgent(agentId);
  }
}
