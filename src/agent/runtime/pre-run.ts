import { ensureAgentDir } from "../utils/agent-path.js";
import { normalizeProviderId } from "../pi-embedded-runner/model-config.js";
import { selectModelForRuntime } from "../model-selection.js";
import {
  initSessionState,
  prepareBeforeSessionManager,
  resolveSessionDir,
} from "../session/index.js";
import type { RuntimeModel } from "../../types.js";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { ensureAgentWorkspace } from "../workspace.js";
import { type AgentChannel } from "../channel-policy.js";
import { readFgbgUserConfig } from "../../config/index.js";
import type { BaseHook } from "../../hook/base-hook.js";
import type { AgentHookEvent } from "../../hook/events.js";
import { LaneHook } from "../../hook/lane-hook.js";
import { PromptHook } from "../../hook/prompt-hook.js";
import { ToolHook } from "../../hook/tool-hook.js";

/**
 * 从模型配置中获取上下文 token 数
 *
 * 不同模型有不同的上下文窗口大小，此函数用于获取模型可接受的
 * 最大上下文 token 数量。如果模型配置中未指定，则使用默认值 8KB。
 * 这个值后续会被 session manager 用于控制对话历史的长度。
 */
function getContextTokens(model?: RuntimeModel): number | undefined {
  // 默认上下文 token 数，适用于大多数中等规模的模型
  const DEFAULT_CONTENT_TOKEN = 8 * 1024;
  if (!model) return DEFAULT_CONTENT_TOKEN;
  // 尝试从模型对象中读取 contextWindow 属性（某些模型配置会包含此信息）
  const maybeContext = (model as { contextWindow?: number }).contextWindow;
  if (typeof maybeContext === "number") return maybeContext;
  return DEFAULT_CONTENT_TOKEN;
}

/**
 * 从配置文件读取思考级别
 *
 * 思考级别（ThinkingLevel）决定了 Agent 在生成回复时的推理深度：
 * - "low": 快速简单回复，适合日常对话
 * - "medium": 平衡推理质量和速度
 * - "high": 深度推理，适合复杂问题
 *
 * 思考级别是按渠道（channel）配置的，不同渠道（如 im、webhook）
 * 可以有不同的默认思考级别，以满足不同场景的响应延迟要求。
 * 如果配置中未指定，则回退到 "medium"。
 */
function resolveThinkingLevel(channel: AgentChannel): ThinkingLevel {
  return readFgbgUserConfig().agents.thinking[channel] ?? "medium";
}

/**
 * 在处理「获取回复」请求前做统一准备工作。
 *
 * ─── 租户隔离架构中的定位 ───
 * 本函数是多租户系统的核心入口，负责为每次 Agent 请求建立完整的运行环境。
 * tenantId 是整个租户隔离体系的关键参数，它驱动了所有路径的解析：
 *   - workspace 目录：/workspaces/{tenantId}/          -> 租户的工作空间
 *   - agent 数据目录：/workspaces/{tenantId}/.agent/    -> Agent 内部数据
 *   - session 目录：  /workspaces/{tenantId}/sessions/  -> 会话状态文件
 * 通过 tenantId 确保不同租户的数据在文件系统层面完全隔离，互不干扰。
 *
 * ─── 执行步骤 ───
 * 1. 模型选择：根据配置选择合适的 LLM 模型和 Provider
 * 2. Workspace 创建：确保租户的工作空间目录结构存在
 * 3. Session 设置：初始化会话状态，准备 session 文件读写
 * 4. 思考级别解析：根据渠道类型确定 Agent 的推理深度
 *
 * @param params.tenantId 租户 ID，用于定位租户的 workspace/session 目录，是租户隔离的核心标识
 * @param params.sessionKey 会话键（如 "session:main:default"），用于唯一标识一个对话会话
 * @param params.channel 渠道类型（如 "im"、"webhook"），用于选择对应的思考级别配置
 */
export async function prepareBeforeGetReply(params: {
  tenantId: string;
  sessionKey: string;
  channel: AgentChannel;
}): Promise<{
  cwd: string; // 租户 workspace 目录
  agentDir: string; // agent 内部数据目录
  sessionDir: string; // 租户 session 目录
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
  /** 工具 / prompt 共用（各 Hook 按 event.kind 自行过滤；默认含 PromptHook + ToolHook） */
  hooks: Set<BaseHook<AgentHookEvent>>;
}> {
  const { tenantId, sessionKey, channel } = params;

  const hooks = new Set<BaseHook<AgentHookEvent>>();
  hooks.add(new PromptHook());
  hooks.add(new ToolHook());
  hooks.add(new LaneHook());

  // ─── 步骤 1：选择运行时模型 ───
  // 根据全局配置选择本次请求要使用的 LLM 模型
  // 返回值包含 modelRef（provider + model 名称）和可选的 model 对象（含 API Key 等元信息）
  const selected = await selectModelForRuntime();
  const modelRef = selected.modelRef;
  const model = selected.model;

  // ─── 步骤 2：确保租户 workspace 目录结构存在 ───
  // tenantId 是这里的关键参数，所有目录路径都基于它解析
  // ensureAgentWorkspace 会创建 /workspaces/{tenantId}/ 目录（如果不存在），并返回该路径
  // cwd（current working directory）是 Agent 运行时的根目录，后续所有文件操作都以此为基准
  const cwd = ensureAgentWorkspace(tenantId);
  // ensureAgentDir 创建 Agent 内部数据目录 /workspaces/{tenantId}/.agent/
  // 用于存放 Agent 的配置、缓存、日志等内部文件
  const agentDir = ensureAgentDir(tenantId);
  // resolveSessionDir 解析会话目录 /workspaces/{tenantId}/sessions/
  // 所有会话的 session 文件（JSON 格式）都存放在此目录下
  const sessionDir = resolveSessionDir(tenantId);

  // ─── 提取模型相关的元信息 ───
  // 规范化 Provider ID：将不同写法的 provider 名称（如 "openai"、"OpenAI"、"open-ai"）
  // 统一为标准格式，避免后续比较时因大小写或格式不同而导致匹配失败
  const normalizedProvider = normalizeProviderId(modelRef.provider);
  // 从模型对象中提取 API Key（如果有的话）
  // 某些模型配置会直接附带 API Key，这样调用方可以直接使用，无需再次查找
  const apiKey = (model as { apiKey?: string } | undefined)?.apiKey;
  // ─── 步骤 4：解析思考级别 ───
  // 根据渠道类型从配置文件中读取对应的思考级别
  // 思考级别会影响 Agent 的推理深度和响应速度
  const thinkingLevel: ThinkingLevel = resolveThinkingLevel(channel);
  const runtimeModel = model;

  // ─── 步骤 3（前半部分）：会话管理器前置准备 ───
  // 在租户的 session 目录下初始化 session 管理器的运行环境
  // 这一步会将模型信息、上下文 token 限制等传递给 session manager
  // session manager 后续会根据这些配置来管理对话历史、控制 token 使用量
  prepareBeforeSessionManager({
    tenantId,
    sessionKey,
    modelProvider: modelRef.provider,
    model: modelRef.model,
    contextTokens: getContextTokens(runtimeModel ?? model),
    cwd,
  });

  // ─── 步骤 3（后半部分）：初始化会话状态 ───
  // initSessionState 会根据 tenantId 和 sessionKey 定位到具体的 session 文件
  // 如果 session 文件已存在，则读取其中的状态（sessionId、对话历史等）
  // 如果是新会话，则创建新的 session 文件并生成唯一的 sessionId
  // 这一步确保了 Agent 能够恢复之前的对话上下文，实现多轮对话
  const sessionInfo = initSessionState(tenantId, sessionKey);

  // ─── 汇总所有初始化结果并返回 ───
  // 调用方（通常是 getReply 或类似的入口函数）会使用这些结果来：
  //   - 在 cwd 目录下执行 Agent 任务（保证租户隔离）
  //   - 使用 modelRef 调用对应的 LLM API
  //   - 通过 sessionId/sessionFile 读写会话状态
  //   - 根据 thinkingLevel 控制推理深度
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
    hooks,
  };
}
