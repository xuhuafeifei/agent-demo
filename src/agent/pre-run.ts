import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import { ensureAgentDir } from "./utils/agent-path.js";
import {
  getResolvedApiKey,
  getUserFgbgConfig,
  normalizeProviderId,
} from "./pi-embedded-runner/model-config.js";
import { selectModelForRuntime } from "../model-selection.js";
import {
  initSessionState,
  prepareBeforeSessionManager,
  resolveSessionDir,
} from "./session/index.js";
import type { RuntimeModel } from "./types.js";

const DEFAULT_SESSION_KEY = "agent:main:main";

function resolveWorkspaceDir(): string {
  const cfg = getUserFgbgConfig();
  const configured = cfg?.agents?.defaults?.workspace?.trim();
  if (configured) return configured;
  return process.cwd();
}

function getContextTokens(model?: RuntimeModel): number | undefined {
  if (!model) return undefined;
  const maybeContext = (model as { contextWindow?: number }).contextWindow;
  if (typeof maybeContext === "number") return maybeContext;
  const maybeTokens = (model as { contextTokens?: number }).contextTokens;
  if (typeof maybeTokens === "number") return maybeTokens;
  return undefined;
}

function openSessionManager(params: {
  sessionDir: string;
  sessionFile: string;
}): SessionManager {
  const { sessionDir, sessionFile } = params;
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  }
  return SessionManager.open(sessionFile, sessionDir);
}

/**
 * 在处理「获取回复」请求前做统一准备：选模型、建目录、刷新模型与鉴权、初始化会话状态并可选创建 Agent 会话。
 * 若当前无可用 runtime 模型则只返回 modelRef/session 信息；否则创建 session 并返回，供后续 prompt 使用。
 */
export async function prepareBeforeGetReply(params?: {
  sessionKey?: string;
}): Promise<{
  session?: Awaited<ReturnType<typeof createAgentSession>>["session"];
  modelRef: { provider: string; model: string };
  model?: RuntimeModel;
  modelError?: string;
  discoveryError?: string;
  sessionKey: string;
  sessionId: string;
  sessionFile: string;
}> {
  const sessionKey = params?.sessionKey ?? DEFAULT_SESSION_KEY;
  const selected = await selectModelForRuntime();
  const modelRef = selected.modelRef;
  const model = selected.model;

  const cwd = resolveWorkspaceDir();
  const agentDir = ensureAgentDir();
  const sessionDir = resolveSessionDir();

  const settingsManager = SettingsManager.create(cwd, agentDir);
  const authStorage = new AuthStorage(path.join(agentDir, "auth.json"));
  const modelRegistry = new ModelRegistry(
    authStorage,
    path.join(agentDir, "models.json"),
  );
  modelRegistry.refresh();

  const normalizedProvider = normalizeProviderId(modelRef.provider);
  const apiKey = getResolvedApiKey({ provider: modelRef.provider });
  if (apiKey) {
    authStorage.setRuntimeApiKey(normalizedProvider, apiKey);
  }

  const registryModel = modelRegistry.find(normalizedProvider, modelRef.model);
  const runtimeModel = registryModel ?? model;

  prepareBeforeSessionManager({
    sessionKey,
    modelProvider: modelRef.provider,
    model: modelRef.model,
    contextTokens: getContextTokens(runtimeModel ?? model),
    cwd,
  });

  const sessionInfo = initSessionState(sessionKey);
  const sessionManager = openSessionManager({
    sessionDir,
    sessionFile: sessionInfo.sessionFile,
  });

  if (!runtimeModel) {
    return {
      modelRef,
      model,
      modelError: selected.modelError,
      discoveryError: selected.discoveryError,
      sessionKey,
      sessionId: sessionInfo.sessionId,
      sessionFile: sessionInfo.sessionFile,
    };
  }

  const { session } = await createAgentSession({
    model: runtimeModel,
    sessionManager,
    settingsManager,
    authStorage,
    modelRegistry,
    cwd,
    agentDir,
    thinkingLevel: "off",
  });
  session.agent.setSystemPrompt("你是一个友好的人,能快速回复别人信息");

  const sessionId = sessionInfo.sessionId;
  const sessionFile = sessionInfo.sessionFile;

  return {
    session,
    modelRef,
    model: runtimeModel,
    modelError: selected.modelError,
    discoveryError: selected.discoveryError,
    sessionKey,
    sessionId,
    sessionFile,
  };
}
