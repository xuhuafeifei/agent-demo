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
  resolveSessionIndexPath,
  type SessionMessage,
  resolveSessionDir,
} from "./session/index.js";
import {
  SessionManager,
  type SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";
import { prepareBeforeGetReply } from "./pre-run.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getMemoryIndexManager } from "../memory/index.js";
import { readWorkspaceSoul, readWorkspaceUser } from "./workspace.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";
import { resolveWorkspaceDir } from "../utils/app-path.js";
import { getAgentToolings } from "./tool/index.js";
import { getSkillManager } from "./skill/skill-manager.js";
import {
  getAgentRuntimeState,
  tryAcquireAgent,
  releaseAgent,
} from "./agent-state.js";
import { formatChinaIso } from "../watch-dog/time.js";
import { ToolRegister } from "./tool/tool-register.js";
import { getChannelPolicy, type AgentChannel } from "./channel-policy.js";
import { refreshFgbgUserConfigCache } from "../config/index.js";
import { areTextsOverTokenThreshold } from "./utils/token-counter.js";

export const DEFAULT_SESSION_KEY = "agent:main:main";

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

export function logRuntimePaths(): void {
  agentLogger.info(`全局配置路径: ${getGlobalModelConfigPath()}`);
  const entry = loadSessionIndexEntry("agent:main:main");
  agentLogger.info(`会话索引路径: ${resolveSessionIndexPath()}`);
  agentLogger.info(`会话文件路径: ${entry?.sessionFile ?? "未创建"}`);
}

export function getHistory(): SessionMessage[] {
  const entry = loadSessionIndexEntry("agent:main:main");
  if (!entry?.sessionFile) return [];
  if (!fs.existsSync(entry.sessionFile)) return [];
  const sessionManager = SessionManager.open(
    entry.sessionFile,
    resolveSessionDir(),
  );
  const entries = sessionManager.getEntries();
  return entries
    .filter(
      (entryItem): entryItem is SessionMessageEntry =>
        entryItem.type === "message",
    )
    .map((entryItem) => entryItem.message);
}

export function clearHistory(): void {
  const entry = loadSessionIndexEntry("agent:main:main");
  if (!entry?.sessionFile) return;
  try {
    fs.unlinkSync(entry.sessionFile);
  } catch {
    // ignore missing file
  }
}

/**
 * 从 session 消息列表剪枝：只保留每条 message 的 role 与文本内容，
 * 返回 "user: ...\n\nassistant: ..." 格式字符串。
 */
function pruneSessionChat(messages: SessionMessage[]): string {
  const selected: string[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    const raw = msg as {
      role?: string;
      content?: unknown[];
      toolName?: string;
    };
    const role = raw.role ?? "unknown";
    const toolName = raw.toolName ?? "";
    if (
      ToolRegister.getInstance().getFilterContextToolNames().includes(toolName)
    ) {
      continue;
    }

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
      const line = `${role}: ${parts.join("\n")}`;
      selected.push(line);
    }
  }

  return selected.reverse().join("\n\n");
}

/**
 * message: 用户输入信息
 * onEvent: layer中间层回调
 * channel: 通信渠道, 目前支持 web 和 qq
 * sessionKey: 如果上游不传，默认"agent:main:main". 在当前设计下，所有通过 layer层传递的信息
 * 都是默认sessionKey. 如果是通过watch-dog触发，则需要新建 sessionKey，避免并发问题.
 */
export async function getReplyFromAgent(params: {
  message: string;
  onEvent: (event: RuntimeStreamEvent) => void;
  channel: AgentChannel;
  sessionKey?: string;
}): Promise<{ finalText: string }> {
  // 刷新本地fgbg.json配置缓存
  refreshFgbgUserConfigCache();

  const { message, onEvent, channel, sessionKey } = params;

  // 每次请求都动态选模型并初始化 Session，run 层不持有任何状态对象。
  const prepared = await prepareBeforeGetReply({
    sessionKey: sessionKey ?? DEFAULT_SESSION_KEY,
    channel,
  });

  const modelRef = prepared.modelRef;
  const model = prepared.model;
  const modelError = prepared.modelError;
  const discoveryError = prepared.discoveryError;

  if (discoveryError) {
    agentLogger.error(`模型发现失败: ${discoveryError}`);
  }

  if (!prepared.apiKey && modelRef.provider !== "ollama") {
    agentLogger.warn(
      `警告：未配置 ${modelRef.provider.toUpperCase()}_API_KEY，模型可能无法工作`,
    );
  }

  if (!model) {
    throw new ModelUnavailableError({
      provider: modelRef.provider,
      model: modelRef.model,
      detail: modelError,
    });
  }

  const requestId = Date.now().toString();
  const trace = createCacheTrace({
    requestId,
    provider: modelRef.provider,
    model: modelRef.model,
  });

  if (!prepared.model) {
    throw new ModelUnavailableError({
      provider: modelRef.provider,
      model: modelRef.model,
      detail: modelError ?? "session 初始化失败",
    });
  }

  // 创建会话 (核心)
  const session = await createRuntimeAgentSession({
    model: prepared.model,
    sessionDir: prepared.sessionDir,
    sessionFile: prepared.sessionFile,
    cwd: prepared.cwd,
    agentDir: prepared.agentDir,
    provider: prepared.normalizedProvider,
    apiKey: prepared.apiKey,
    thinkingLevel: prepared.thinkingLevel,
  });

  // session 获取当前聊天信息，剪枝为仅保留 user/assistant 的文本内容
  const chatHistoryText = pruneSessionChat(getHistory());

  // 提示词函数是纯组合器：数据由调用方准备后传入。
  const prompt = buildSystemPrompt({
    soul: readWorkspaceSoul(),
    user: readWorkspaceUser(),
    nowText: formatChinaIso(new Date()),
    language: process.env.FGBG_PROMPT_LANGUAGE?.trim() || "zh-CN",
    chatHistory: chatHistoryText,
    workspace: resolveWorkspaceDir(),
    toolings: getAgentToolings(prepared.cwd),
    skillsMeta: getSkillManager().getMetaPromptText(),
    channel: channel,
  });
  agentLogger.trace(`prompt: ${prompt}`);

  // 使用 token-counter 工具计算 systemprompt + 用户输入的总 token 数
  const maxTokens = prepared.model.maxTokens;
  const tokenRatio = prepared.model.tokenRatio || 0.75;
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

  session.agent.setSystemPrompt(prompt);

  trace.recordStage("request:start");
  trace.recordStage("prompt:start");

  const emit = (event: RuntimeStreamEvent) => {
    if (event.type === "message_end") {
      trace.recordStage("prompt:end");
    }
    onEvent(event);
  };

  // 发送 context used 事件到前端
  emit({
    type: "context_used",
    totalTokens: compressionResult.totalTokens,
    threshold: compressionResult.threshold,
    contextWindow: maxTokens,
  });
  const channelPolicy = getChannelPolicy(channel);
  const emitContextSnapshot = (reason: "before_prompt") => {
    if (!channelPolicy.emitContextSnapshot) return;
    emit({ type: "context_snapshot", seq: 0, reason, contextText: prompt });
  };

  try {
    emitContextSnapshot("before_prompt");
    const runResult = await runEmbeddedPiAgent({
      session,
      message,
      onEvent: (event) => {
        emit(event);
      },
      needsCompression, // 传递压缩标记
    });
    trace.recordStage("request:end");
    emit({ type: "done" });
    trace.logTimeline("done");
    return runResult;
  } catch (error) {
    trace.recordStage("request:end");
    const message = error instanceof Error ? error.message : "服务器内部错误";
    agentLogger.error(`[agent] request failed: ${message}`, error);
    emit({
      type: "error",
      error: message,
    });
    trace.logTimeline("error");
    return { finalText: "" };
  } finally {
    getMemoryIndexManager().onMemorySourceChanged(
      "session",
      prepared.sessionFile,
    );
    session.dispose();
  }
}

export { getAgentRuntimeState };

export async function runWithSingleFlight(params: {
  message: string;
  onEvent: (event: RuntimeStreamEvent) => void;
  onBusy?: () => void | Promise<void>;
  onAccepted?: () => void | Promise<void>;
  agentId?: string;
  channel: AgentChannel;
}): Promise<{ status: "busy" | "completed"; finalText: string }> {
  const {
    message,
    onEvent,
    onBusy,
    onAccepted,
    channel,
    agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  } = params;

  if (!tryAcquireAgent(agentId)) {
    await onBusy?.();
    return { status: "busy", finalText: "" };
  }

  await onAccepted?.();
  try {
    const result = await getReplyFromAgent({ message, onEvent, channel });
    return { status: "completed", finalText: result.finalText };
  } finally {
    releaseAgent(agentId);
  }
}
