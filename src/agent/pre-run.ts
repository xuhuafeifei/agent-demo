import { ensureAgentDir } from "./utils/agent-path.js";
import { normalizeProviderId } from "./pi-embedded-runner/model-config.js";
import { selectModelForRuntime } from "./model-selection.js";
import {
  initSessionState,
  prepareBeforeSessionManager,
  resolveSessionDir,
} from "./session/index.js";
import type { RuntimeModel } from "../types.js";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { ensureAgentWorkspace } from "./workspace.js";

function getContextTokens(model?: RuntimeModel): number | undefined {
  if (!model) return undefined;
  const maybeContext = (model as { contextWindow?: number }).contextWindow;
  if (typeof maybeContext === "number") return maybeContext;
  const maybeTokens = (model as { contextTokens?: number }).contextTokens;
  if (typeof maybeTokens === "number") return maybeTokens;
  return undefined;
}

/**
 * 在处理「获取回复」请求前做统一准备：选模型、建目录、刷新模型与鉴权、初始化会话状态并可选创建 Agent 会话。
 * 若当前无可用 runtime 模型则只返回 modelRef/session 信息；否则创建 session 并返回，供后续 prompt 使用。
 */
export async function prepareBeforeGetReply(params: {
  sessionKey: string;
}): Promise<{
  cwd: string;
  agentDir: string;
  sessionDir: string;
  modelRef: { provider: string; model: string };
  model?: RuntimeModel;
  modelError?: string;
  discoveryError?: string;
  sessionKey: string;
  sessionId: string;
  sessionFile: string;
  normalizedProvider: string;
  apiKey?: string;
  thinkingLevel: ThinkingLevel;
}> {
  const sessionKey = params.sessionKey;
  const selected = await selectModelForRuntime();
  const modelRef = selected.modelRef;
  const model = selected.model;

  const cwd = ensureAgentWorkspace();
  const agentDir = ensureAgentDir();
  const sessionDir = resolveSessionDir();

  const normalizedProvider = normalizeProviderId(modelRef.provider);
  const apiKey = (model as { apiKey?: string } | undefined)?.apiKey;
  const thinkingLevel: ThinkingLevel = "off";

  const runtimeModel = model;

  // session管理器前置准备
  prepareBeforeSessionManager({
    sessionKey,
    modelProvider: modelRef.provider,
    model: modelRef.model,
    contextTokens: getContextTokens(runtimeModel ?? model),
    cwd,
  });

  const sessionInfo = initSessionState(sessionKey);

  if (!runtimeModel) {
    return {
      cwd,
      agentDir,
      sessionDir,
      modelRef,
      model,
      modelError: selected.modelError,
      discoveryError: selected.discoveryError,
      sessionKey,
      sessionId: sessionInfo.sessionId,
      sessionFile: sessionInfo.sessionFile,
      normalizedProvider,
      apiKey,
      thinkingLevel,
    };
  }

  return {
    cwd,
    agentDir,
    sessionDir,
    modelRef,
    model: runtimeModel,
    modelError: selected.modelError,
    discoveryError: selected.discoveryError,
    sessionKey,
    sessionId: sessionInfo.sessionId,
    sessionFile: sessionInfo.sessionFile,
    normalizedProvider,
    apiKey,
    thinkingLevel,
  };
}
