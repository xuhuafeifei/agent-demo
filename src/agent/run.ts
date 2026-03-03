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
import { createDebugTrace, logTrace } from "../utils/log-trace.js";
import { readWorkspaceSoul, readWorkspaceUser } from "./workspace.js";
import type { MemoryHit } from "../memory/index.js";

const memoryDebug = createDebugTrace("memory");

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
  console.log(`全局配置路径: ${getGlobalModelConfigPath()}`);
  const entry = loadSessionIndexEntry("agent:main:main");
  console.log(`会话索引路径: ${resolveSessionIndexPath()}`);
  console.log(`会话文件路径: ${entry?.sessionFile ?? "未创建"}`);
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

function formatMemoryHits(hits: MemoryHit[]): string {
  if (hits.length === 0) return "";
  return hits
    .map(
      (hit, idx) =>
        `[${idx + 1}] ${hit.path}:${hit.lineStart}-${hit.lineEnd}\n${hit.content}`,
    )
    .join("\n\n");
}

function logMemoryHitsForDebug(
  query: string,
  sessionHits: MemoryHit[],
  historyHits: MemoryHit[],
): void {
  const all = [...sessionHits, ...historyHits];
  memoryDebug(
    `[memory] prompt hits query="${query.slice(0, 80)}${query.length > 80 ? "..." : ""}" total=${all.length} session=${sessionHits.length} history=${historyHits.length}`,
  );
  for (const [index, hit] of all.entries()) {
    const preview = hit.content.replace(/\s+/g, " ").slice(0, 140);
    memoryDebug(
      `[memory] hit#${index + 1} source=${hit.source} score=${hit.score.toFixed(6)} path=${hit.path}:${hit.lineStart}-${hit.lineEnd} preview="${preview}${hit.content.length > 140 ? "..." : ""}"`,
    );
  }
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
    console.error(`模型发现失败: ${discoveryError}`);
  }

  if (!prepared.apiKey && modelRef.provider !== "ollama") {
    console.warn(
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
  // 记忆检索
  const memoryHits = await getMemoryIndexManager().search(message);
  const sessionHits = memoryHits.filter((hit) => hit.source === "sessions");
  const historyHits = memoryHits.filter((hit) => hit.source !== "sessions");
  logMemoryHitsForDebug(message, sessionHits, historyHits);

  // 提示词函数是纯组合器：数据由调用方准备后传入。
  const prompt = buildSystemPrompt({
    soul: readWorkspaceSoul(),
    user: readWorkspaceUser(),
    nowText: new Date().toISOString(),
    language: process.env.FGBG_PROMPT_LANGUAGE?.trim() || "zh-CN",
    sessionMemory: formatMemoryHits(sessionHits),
    historyMemory: formatMemoryHits(historyHits),
  });
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
    logTrace("error", `[agent] request failed: ${message}`, error);
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
