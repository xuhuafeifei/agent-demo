import { getGlobalModelConfigPath, getResolvedApiKey, normalizeProviderId } from "./model-config";
import { resolveModel } from "./pi-embedded-runner/model";
import {
  createAgentRuntime as createPiAgentRuntime,
  runEmbeddedPiAgent,
} from "./pi-embedded-runner/attempt";
import { selectModelForRuntime } from "../model-selection";
import { createCacheTrace } from "./utils/cache-trace";
import type { RuntimeStreamEvent } from "./events";
import { createSessionManager } from "./session";
import type { SessionMessage } from "./session";

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
  const sessionManager = createSessionManager("main");
  console.log(`全局配置路径: ${getGlobalModelConfigPath()}`);
  console.log(`会话文件路径: ${sessionManager.sessionFile}`);
}

export function getHistory(): SessionMessage[] {
  return createSessionManager("main").loadMessages();
}

export function clearHistory(): void {
  createSessionManager("main").clearMessages();
}

export async function getReplyFromAgent(params: {
  message: string;
  onEvent: (event: RuntimeStreamEvent) => void;
}): Promise<void> {
  const { message, onEvent } = params;
  const sessionManager = createSessionManager("main");

  // 每次请求都动态选模型，run 层不持有任何状态对象。
  const selected = await selectModelForRuntime();
  const modelRef = selected.modelRef;
  const model = selected.model;
  const modelError = selected.modelError;
  const discoveryError = selected.discoveryError;

  if (discoveryError) {
    console.error(`模型发现失败: ${discoveryError}`);
  }

  const apiKey = getResolvedApiKey({ provider: modelRef.provider });
  if (!apiKey && modelRef.provider !== "ollama") {
    console.warn(`警告：未配置 ${modelRef.provider.toUpperCase()}_API_KEY，模型可能无法工作`);
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

  const agent = createPiAgentRuntime({
    model,
    messages: sessionManager.loadMessages(),
    getApiKey: (provider) => getResolvedApiKey({ provider: normalizeProviderId(provider) }),
  });

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
      agent,
      message,
      onEvent: emit,
    });
    // 成功返回后把最新会话历史落盘，供下次请求恢复。
    sessionManager.saveMessages(agent.state.messages as SessionMessage[]);
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
  }
}

// 兼容现有 resolveModel 的类型引用，避免外层导入断裂。
export type RuntimeResolveModel = ReturnType<typeof resolveModel>;
