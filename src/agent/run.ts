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
  const lines: string[] = [];
  for (const msg of messages) {
    const raw = msg as { role?: string; content?: unknown[] };
    const role = raw.role === "assistant" ? "assistant" : "user";
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
      lines.push(`${role}: ${parts.join("\n")}`);
    }
  }
  return lines.join("\n\n");
}

export async function getReplyFromAgent(params: {
  message: string;
  onEvent: (event: RuntimeStreamEvent) => void;
}): Promise<void> {
  const { message, onEvent } = params;

  // 每次请求都动态选模型并初始化 Session，run 层不持有任何状态对象。
  const prepared = await prepareBeforeGetReply({
    sessionKey: "agent:main:main",
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
    nowText: new Date().toISOString(),
    language: process.env.FGBG_PROMPT_LANGUAGE?.trim() || "zh-CN",
    chatHistory: chatHistoryText,
    workspace: resolveWorkspaceDir(),
    toolings: getAgentToolings(prepared.cwd),
  });
  agentLogger.trace(`prompt: ${prompt}`);

  session.agent.setSystemPrompt(prompt);

  trace.recordStage("request:start");
  trace.recordStage("prompt:start");

  const emit = (event: RuntimeStreamEvent) => {
    if (event.type === "message_end") {
      trace.recordStage("prompt:end");
    }
    onEvent(event);
  };

  try {
    await runEmbeddedPiAgent({
      session,
      message,
      onEvent: emit,
    });
    trace.recordStage("request:end");
    emit({ type: "done" });
    trace.logTimeline("done");
  } catch (error) {
    trace.recordStage("request:end");
    const message = error instanceof Error ? error.message : "服务器内部错误";
    agentLogger.error(`[agent] request failed: ${message}`, error);
    emit({
      type: "error",
      error: message,
    });
    trace.logTimeline("error");
  } finally {
    getMemoryIndexManager().onMemorySourceChanged(
      "session",
      prepared.sessionFile,
    );
    session.dispose();
  }
}
