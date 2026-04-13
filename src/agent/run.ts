import fs from "node:fs";
import { getGlobalModelConfigPath } from "./pi-embedded-runner/model-config.js";
import {
  createRuntimeAgentSession,
  runEmbeddedPiAgent,
} from "./pi-embedded-runner/attempt.js";
import { createCacheTrace } from "./utils/cache-trace.js";
import type { RuntimeStreamEvent } from "./utils/events.js";
import {
  loadSessionIndexEntry,
  resolveSessionDir,
} from "./session/index.js";
import {
  SessionManager,
  type SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";
import { prepareBeforeGetReply } from "./pre-run.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getMemoryIndexManager } from "../memory/index.js";
import {
  readWorkspaceSoul,
  readWorkspaceUserinfoSummary,
} from "./workspace.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";
import { resolveTenantWorkspaceDir } from "../utils/app-path.js";
import { createToolBundle } from "./tool/tool-bundle.js";
import { getSkillManager } from "./skill/skill-manager.js";
import {
  getAllRunningAgentStates,
  tryAcquireAgent,
  releaseAgent,
} from "./agent-state.js";
import { formatChinaIso } from "../watch-dog/time.js";
import { getFilterContextToolNames } from "./tool/tool-bundle.js";
import { getChannelPolicy, type AgentChannel } from "./channel-policy.js";
import { refreshFgbgUserConfigCache } from "../config/index.js";
import { areTextsOverTokenThreshold } from "./utils/token-counter.js";

const agentLogger = getSubsystemConsoleLogger("agent");

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

/**
 * 打印当前租户的运行时路径信息（调试用）
 */
export function logRuntimePaths(tenantId: string): void {
  const sessionKey = `session:main:${tenantId}`;
  agentLogger.info(`全局配置路径: ${getGlobalModelConfigPath()}`);
  const entry = loadSessionIndexEntry(tenantId, sessionKey);
  agentLogger.info(`会话索引路径: ${resolveSessionDir(tenantId)}/session.json`);
  agentLogger.info(`会话文件路径: ${entry?.sessionFile ?? "未创建"}`);
}

const DEFAULT_HISTORY_LIMIT = 20;

/**
 * 获取指定租户的 session 消息列表（内部用，用于构建对话历史上下文）
 *
 * 流程：
 * 1. 通过 sessionKey 定位索引文件
 * 2. 打开 SessionManager 读取所有消息条目
 * 3. 过滤出 type === "message" 的条目返回
 */
function getSessionMessageEntrys(tenantId: string): SessionMessageEntry[] {
  // 构造该租户的主会话键
  const sessionKey = `session:main:${tenantId}`;
  const entry = loadSessionIndexEntry(tenantId, sessionKey);
  // 无索引或文件不存在，返回空列表
  if (!entry?.sessionFile) return [];
  if (!fs.existsSync(entry.sessionFile)) return [];

  // 打开 session 文件，提取所有消息条目
  const sessionManager = SessionManager.open(
    entry.sessionFile,
    resolveSessionDir(tenantId),
  );
  const entries = sessionManager.getEntries();

  // 只保留 type === "message" 的条目（排除 system/tool 类型）
  return entries.filter(
    (entryItem): entryItem is SessionMessageEntry =>
      entryItem.type === "message",
  );
}

/**
 * 获取指定租户的对话历史（前端 API 消费）
 *
 * 从 session 文件中提取最近 20 条 user/assistant 消息，
 * 只保留纯文本内容，过滤掉 tool 调用等内部消息。
 */
export function getHistory(tenantId: string): Array<{
  role: string;
  content: string;
  timestamp?: number;
}> {
  const messageEntrys = getSessionMessageEntrys(tenantId);
  // 只保留 user 和 assistant 角色的消息
  const filtered = messageEntrys.filter(
    (msg) => msg.message.role === "user" || msg.message.role === "assistant",
  );
  // 取最近 20 条
  const recent = filtered.slice(-DEFAULT_HISTORY_LIMIT);
  const history: Array<{ role: string; content: string; timestamp?: number }> = [];
  // 伪造时间戳：基于当前时间倒推，每条间隔 1 秒
  const baseTimestamp = Date.now() - recent.length * 1000;

  recent.forEach((msg, idx) => {
    const raw = msg.message as {
      role?: string;
      content?: unknown[];
      toolName?: string;
    };
    // 从复合消息中提取文本部分
    const textParts: string[] = [];
    if (Array.isArray(raw.content)) {
      for (const block of raw.content) {
        const b = block as { type?: string; text?: string };
        if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
          textParts.push(b.text.trim());
        }
      }
    }
    // 只保留有文本内容的消息
    if (textParts.length > 0) {
      history.push({
        role: raw.role || "unknown",
        content: textParts.join("\n"),
        timestamp: baseTimestamp + idx * 1000,
      });
    }
  });

  return history;
}

/**
 * 清除指定租户的会话历史
 */
export function clearHistory(tenantId: string): void {
  const sessionKey = `session:main:${tenantId}`;
  const entry = loadSessionIndexEntry(tenantId, sessionKey);
  if (!entry?.sessionFile) return;
  try {
    fs.unlinkSync(entry.sessionFile);
  } catch {
    // 忽略文件不存在的情况
  }
}

/**
 * 从 session 消息列表剪枝，返回 "user: ...\n\nassistant: ..." 格式文本。
 *
 * 用于构建 system prompt 中的对话历史上下文。
 * 过滤掉 context tool（如 memory-search、read 等无实际对话意义的工具调用），
 * 只保留有文本内容的 user/assistant 消息，按时间倒序后反转恢复正序。
 */
function pruneSessionChat(messages: SessionMessageEntry[]): string {
  const selected: string[] = [];
  const filterToolNames = getFilterContextToolNames();
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    const raw = msg.message as {
      role?: string;
      content?: unknown[];
      toolName?: string;
    };
    const role = raw.role ?? "unknown";
    const toolName = raw.toolName ?? "";
    // 跳过 context tool 的调用记录（如 memory-search、read 等）
    if (filterToolNames.includes(toolName)) continue;

    // 提取消息中的文本部分
    const parts: string[] = [];
    if (Array.isArray(raw.content)) {
      for (const block of raw.content) {
        const b = block as { type?: string; text?: string };
        if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
          parts.push(b.text.trim());
        }
      }
    }
    if (parts.length > 0) {
      selected.push(`${role}: ${parts.join("\n")}`);
    }
  }
  // 反转恢复时间正序，用双换行分隔
  return selected.reverse().join("\n\n");
}

/**
 * 向 Agent 拉取一次回复；流式进度通过 `onEvent` 交给中间层。
 *
 * @param params.message 用户输入
 * @param params.onEvent 流式事件回调
 * @param params.channel 渠道：web | qq | weixin
 * @param params.tenantId 租户 ID，决定使用哪套 workspace/memory/session
 * @param params.sessionKey 会话键（watch-dog 使用 `watchdog:task:{id}`，普通渠道使用 `session:main:{tenantId}`）
 */
export async function getReplyFromAgent(params: {
  message: string;
  onEvent: (event: RuntimeStreamEvent) => void;
  channel: AgentChannel;
  tenantId: string;
  sessionKey: string;
}): Promise<{ finalText: string }> {
  // 刷新配置缓存，确保使用最新的模型配置
  refreshFgbgUserConfigCache();

  const { message, onEvent, channel, tenantId, sessionKey } = params;

  // 准备运行时环境：模型选择、workspace 创建、session 初始化
  const prepared = await prepareBeforeGetReply({ tenantId, sessionKey, channel });

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

  // 创建请求追踪 trace
  const requestId = Date.now().toString();
  const trace = createCacheTrace({
    requestId,
    provider: modelRef.provider,
    model: modelRef.model,
  });

  // 创建运行时 agent session（包含工具链、模型配置、租户隔离）
  const session = await createRuntimeAgentSession({
    model: prepared.model!,
    sessionDir: prepared.sessionDir,
    sessionFile: prepared.sessionFile,
    cwd: prepared.cwd,
    agentDir: prepared.agentDir,
    provider: prepared.normalizedProvider,
    apiKey: prepared.apiKey,
    thinkingLevel: prepared.thinkingLevel,
    tenantId,
  });

  // 从 session 历史剪枝生成对话上下文字
  const chatHistoryText = pruneSessionChat(getSessionMessageEntrys(tenantId));

  // 构建 system prompt：整合 SOUL.md、userinfo、对话历史、工具元数据、技能元数据
  const prompt = buildSystemPrompt({
    soul: readWorkspaceSoul(tenantId),
    user: readWorkspaceUserinfoSummary(tenantId),
    nowText: formatChinaIso(new Date()),
    language: process.env.FGBG_PROMPT_LANGUAGE?.trim() || "zh-CN",
    chatHistory: chatHistoryText,
    workspace: resolveTenantWorkspaceDir(tenantId),
    toolings: createToolBundle(prepared.cwd, tenantId).toolings,
    skillsMeta: getSkillManager(tenantId).getMetaPromptText(),
    channel: channel,
    // tenantId 作为 channel 的上下文信息写入 system prompt，供工具参数填写参考
    tenantId: tenantId,
  });
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
    const runResult = await runEmbeddedPiAgent({
      session,
      message,
      onEvent: (event) => emit(event),
      needsCompression,
    });
    trace.recordStage("request:end");
    emit({ type: "done" });
    trace.logTimeline("done");
    return runResult;
  } catch (error) {
    trace.recordStage("request:end");
    const message = error instanceof Error ? error.message : "服务器内部错误";
    agentLogger.error(`[agent] request failed: ${message}`, error);
    emit({ type: "error", error: message });
    trace.logTimeline("error");
    return { finalText: "" };
  } finally {
    // 通知 memory 系统 session 文件已变更，触发增量索引
    getMemoryIndexManager(tenantId).onMemorySourceChanged("session", prepared.sessionFile);
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
 * @param params.onBusy 同一 agentId 正在运行时的回调
 * @param params.onAccepted 成功获取锁（开始执行）时的回调
 */
export async function runWithSingleFlight(params: {
  message: string;
  onEvent: (event: RuntimeStreamEvent) => void;
  onBusy?: () => void | Promise<void>;
  onAccepted?: () => void | Promise<void>;
  tenantId: string;
  module: string;
  watchDogTaskId?: string;
  channel: AgentChannel;
}): Promise<{ status: "busy" | "completed"; finalText: string }> {
  const { message, onEvent, onBusy, onAccepted, tenantId, module: mod, channel } = params;

  // 锁 key 由 module + tenantId 组成，不同 module 的同租户 agent 可并发
  const agentId = `agent:${mod}:${tenantId}`;
  const sessionKey = `session:${mod}:${tenantId}`;

  if (!tryAcquireAgent(agentId, tenantId, channel)) {
    await onBusy?.();
    return { status: "busy", finalText: "" };
  }

  await onAccepted?.();
  try {
    const result = await getReplyFromAgent({
      message,
      onEvent,
      channel,
      tenantId,
      sessionKey,
    });
    return { status: "completed", finalText: result.finalText };
  } finally {
    releaseAgent(agentId);
  }
}
