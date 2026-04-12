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
import { type AgentChannel, normalizeChannel } from "./channel-policy.js";
import { readFgbgUserConfig } from "../config/index.js";

/**
 * 从模型配置中获取上下文 token 数
 */
function getContextTokens(model?: RuntimeModel): number | undefined {
  const DEFAULT_CONTENT_TOKEN = 8 * 1024;
  if (!model) return DEFAULT_CONTENT_TOKEN;
  const maybeContext = (model as { contextWindow?: number }).contextWindow;
  if (typeof maybeContext === "number") return maybeContext;
  return DEFAULT_CONTENT_TOKEN;
}

/**
 * 从配置文件读取思考级别
 */
function resolveThinkingLevel(channel: AgentChannel): ThinkingLevel {
  return readFgbgUserConfig().agents.thinking[channel] ?? "medium";
}

/**
 * 在处理「获取回复」请求前做统一准备工作。
 * 主要职责：
 * 1. 选择运行时模型
 * 2. 确保租户 workspace 目录结构存在
 * 3. 初始化会话状态
 * 4. 解析思考级别
 *
 * @param params.tenantId 租户 ID，用于定位租户的 workspace/session 目录
 * @param params.sessionKey 会话键（如 "session:main:default"）
 * @param params.channel 渠道类型，用于选择思考级别
 */
export async function prepareBeforeGetReply(params: {
  tenantId: string;
  sessionKey: string;
  channel?: AgentChannel;
}): Promise<{
  cwd: string;             // 租户 workspace 目录
  agentDir: string;        // agent 内部数据目录
  sessionDir: string;      // 租户 session 目录
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
  const { tenantId, sessionKey } = params;
  const channel = normalizeChannel(params.channel);

  // 选择运行时模型
  const selected = await selectModelForRuntime();
  const modelRef = selected.modelRef;
  const model = selected.model;

  // 确保租户 workspace 目录存在，返回目录路径作为 cwd
  const cwd = ensureAgentWorkspace(tenantId);
  const agentDir = ensureAgentDir(tenantId);
  const sessionDir = resolveSessionDir(tenantId);

  const normalizedProvider = normalizeProviderId(modelRef.provider);
  const apiKey = (model as { apiKey?: string } | undefined)?.apiKey;
  const thinkingLevel: ThinkingLevel = resolveThinkingLevel(channel);
  const runtimeModel = model;

  // 会话管理器前置准备（在租户 session 目录下管理 session 文件）
  prepareBeforeSessionManager({
    tenantId,
    sessionKey,
    modelProvider: modelRef.provider,
    model: modelRef.model,
    contextTokens: getContextTokens(runtimeModel ?? model),
    cwd,
  });

  // 初始化会话状态，读取 sessionId 和 sessionFile
  const sessionInfo = initSessionState(tenantId, sessionKey);

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
