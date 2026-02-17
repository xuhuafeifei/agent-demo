import fs from "node:fs";
import {
  getGlobalModelConfigPath,
  getResolvedApiKey,
} from "./pi-embedded-runner/model-config.js";
import { resolveModel } from "./pi-embedded-runner/model.js";
import { runEmbeddedPiAgent } from "./pi-embedded-runner/attempt.js";
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
  const sessionManager = SessionManager.open(entry.sessionFile, resolveSessionDir());
  const entries = sessionManager.getEntries();
  return entries
    .filter((entryItem): entryItem is SessionMessageEntry => entryItem.type === "message")
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

export async function getReplyFromAgent(params: {
  message: string;
  onEvent: (event: RuntimeStreamEvent) => void;
}): Promise<void> {
  const { message, onEvent } = params;

  // 每次请求都动态选模型并初始化 Session，run 层不持有任何状态对象。
  const prepared = await prepareBeforeGetReply({ sessionKey: "agent:main:main" });
  const modelRef = prepared.modelRef;
  const model = prepared.model;
  const modelError = prepared.modelError;
  const discoveryError = prepared.discoveryError;

  if (discoveryError) {
    console.error(`模型发现失败: ${discoveryError}`);
  }

  const apiKey = getResolvedApiKey({ provider: modelRef.provider });
  if (!apiKey && modelRef.provider !== "ollama") {
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

  const session = prepared.session;
  if (!session) {
    throw new ModelUnavailableError({
      provider: modelRef.provider,
      model: modelRef.model,
      detail: modelError ?? "session 初始化失败",
    });
  }

  trace.recordStage("request:start");
  trace.recordStage("prompt:start");

  let firstAssistantChunkLogged = false;
  const emit = (event: RuntimeStreamEvent) => {
    // 以第一段 assistant 文本作为首包时间点（delta 或 text 任一非空）。
    if (
      !firstAssistantChunkLogged &&
      (event.type === "message_update" || event.type === "message_end")
    ) {
      const deltaText =
        event.type === "message_update" && typeof event.delta === "string"
          ? event.delta.trim()
          : "";
      const fullText = typeof event.text === "string" ? event.text.trim() : "";
      if (deltaText.length > 0 || fullText.length > 0) {
        firstAssistantChunkLogged = true;
        trace.recordStage("prompt:first_assistant", `source=${event.type}`);
        console.log(
          `[LLM首包] requestId=${requestId} provider=${modelRef.provider} model=${modelRef.model} source=${event.type}`,
        );
      }
    }

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
    emit({
      type: "error",
      error: error instanceof Error ? error.message : "服务器内部错误",
    });
    trace.logTimeline("error");
  } finally {
    session.dispose();
  }
}

// 兼容现有 resolveModel 的类型引用，避免外层导入断裂。
export type RuntimeResolveModel = ReturnType<typeof resolveModel>;
