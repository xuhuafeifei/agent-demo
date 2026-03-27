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
 * 从模型配置中获取上下文token数
 * 支持两种字段名：contextWindow 或 contextTokens
 * @param model 运行时模型配置
 * @returns 上下文token数
 */
function getContextTokens(model?: RuntimeModel): number | undefined {
  const DEFAULT_CONTENT_TOKEN = 8 * 1024;
  if (!model) return DEFAULT_CONTENT_TOKEN;

  // 尝试从contextWindow字段获取
  const maybeContext = (model as { contextWindow?: number }).contextWindow;
  if (typeof maybeContext === "number") return maybeContext;

  return DEFAULT_CONTENT_TOKEN;
}

/**
 * 从配置文件读取思考级别配置
 * 如果配置无效，则回写默认配置并返回默认值
 * @returns 解析后的思考级别配置
 */
function resolveThinkingLevel(channel: AgentChannel): ThinkingLevel {
  return readFgbgUserConfig().agents.thinking[channel] ?? "medium";
}

/**
 * 在处理「获取回复」请求前做统一准备工作
 * 主要职责：
 * 1. 选择运行时模型
 * 2. 确保工作目录结构存在
 * 3. 初始化会话状态
 * 4. 解析思考级别
 *
 * 若当前无可用 runtime 模型则只返回 modelRef/session 信息；
 * 否则返回完整的准备结果，供后续 prompt 使用。
 *
 * @param params 准备参数
 * @param params.sessionKey 会话密钥，用于标识会话
 * @param params.channel 渠道类型（web或qq），用于确定默认行为
 *
 * @returns 包含所有准备结果的对象
 */
export async function prepareBeforeGetReply(params: {
  sessionKey: string;
  channel?: AgentChannel;
}): Promise<{
  cwd: string; // 工作目录
  agentDir: string; // 代理目录
  sessionDir: string; // 会话目录
  modelRef: { provider: string; model: string }; // 模型引用
  model?: RuntimeModel; // 运行时模型配置（可选）
  modelError?: string; // 模型选择错误信息（可选）
  discoveryError?: string; // 模型发现错误信息（可选）
  sessionKey: string; // 会话密钥
  sessionId: string; // 会话ID
  sessionFile: string; // 会话文件路径
  normalizedProvider: string; // 规范化的提供商ID
  apiKey?: string; // API密钥（可选）
  thinkingLevel: ThinkingLevel; // 思考级别
}> {
  const sessionKey = params.sessionKey;
  const channel = normalizeChannel(params.channel);

  // 选择运行时模型
  const selected = await selectModelForRuntime();
  const modelRef = selected.modelRef;
  const model = selected.model;

  // 确保工作目录结构存在
  const cwd = ensureAgentWorkspace();
  const agentDir = ensureAgentDir();
  const sessionDir = resolveSessionDir();

  // 规范化提供商ID和API密钥
  const normalizedProvider = normalizeProviderId(modelRef.provider);
  const apiKey = (model as { apiKey?: string } | undefined)?.apiKey;

  // 解析思考级别
  const thinkingLevel: ThinkingLevel = resolveThinkingLevel(channel);

  const runtimeModel = model;

  // Session管理器前置准备
  prepareBeforeSessionManager({
    sessionKey,
    modelProvider: modelRef.provider,
    model: modelRef.model,
    contextTokens: getContextTokens(runtimeModel ?? model),
    cwd,
  });

  // 初始化会话状态
  const sessionInfo = initSessionState(sessionKey);

  // 无运行时模型配置的情况
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

  // 有运行时模型配置的情况
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
