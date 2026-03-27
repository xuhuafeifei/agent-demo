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

/**
 * 从模型配置中获取上下文token数
 * 支持两种字段名：contextWindow 或 contextTokens
 * @param model 运行时模型配置
 * @returns 上下文token数，或undefined（如果模型未定义或没有配置）
 */
function getContextTokens(model?: RuntimeModel): number | undefined {
  if (!model) return undefined;

  // 尝试从contextWindow字段获取
  const maybeContext = (model as { contextWindow?: number }).contextWindow;
  if (typeof maybeContext === "number") return maybeContext;

  // 尝试从contextTokens字段获取
  const maybeTokens = (model as { contextTokens?: number }).contextTokens;
  if (typeof maybeTokens === "number") return maybeTokens;

  return undefined;
}

/**
 * 有效的思考级别枚举
 * off: 无思考过程
 * minimal: 最小思考过程
 * low: 低思考过程
 * medium: 中等思考过程
 * high: 高思考过程
 * xhigh: 极高思考过程
 */
const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

/**
 * 解析思考级别的字符串值
 * @param value 要解析的字符串值
 * @returns 有效的ThinkingLevel，或undefined（如果解析失败）
 */
function parseThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
  if (!value) return undefined;

  const normalized = value.trim().toLowerCase();

  return THINKING_LEVELS.includes(normalized as ThinkingLevel)
    ? (normalized as ThinkingLevel)
    : undefined;
}

/**
 * 根据渠道和环境变量解析思考级别
 * 优先级：渠道特定环境变量 > 全局环境变量 > 默认值
 * @param channel 渠道类型（web或qq）
 * @returns 解析后的思考级别
 */
function resolveThinkingLevel(channel: "web" | "qq" | undefined): ThinkingLevel {
  // 根据渠道设置默认思考级别
  const channelDefault: ThinkingLevel = channel === "web" ? "medium" : "off";

  // 从渠道特定环境变量获取
  const fromChannelEnv = parseThinkingLevel(
    channel === "web"
      ? process.env.FGBG_WEB_THINKING_LEVEL
      : process.env.FGBG_QQ_THINKING_LEVEL,
  );

  // 从全局环境变量获取
  const fromGlobalEnv = parseThinkingLevel(process.env.FGBG_THINKING_LEVEL);

  // 解析优先级：渠道特定 > 全局 > 默认值
  return fromChannelEnv ?? fromGlobalEnv ?? channelDefault;
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
  channel?: "web" | "qq";
}): Promise<{
  cwd: string;              // 工作目录
  agentDir: string;         // 代理目录
  sessionDir: string;       // 会话目录
  modelRef: { provider: string; model: string };  // 模型引用
  model?: RuntimeModel;     // 运行时模型配置（可选）
  modelError?: string;      // 模型选择错误信息（可选）
  discoveryError?: string;  // 模型发现错误信息（可选）
  sessionKey: string;       // 会话密钥
  sessionId: string;        // 会话ID
  sessionFile: string;      // 会话文件路径
  normalizedProvider: string;  // 规范化的提供商ID
  apiKey?: string;          // API密钥（可选）
  thinkingLevel: ThinkingLevel;  // 思考级别
}> {
  const sessionKey = params.sessionKey;

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
  const thinkingLevel: ThinkingLevel = resolveThinkingLevel(params.channel);

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
