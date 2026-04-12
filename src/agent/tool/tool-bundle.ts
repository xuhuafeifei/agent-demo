/**
 * 工具装配（Tool Bundle）
 *
 * 核心职责：将「配置」转换为「运行时工具实例 + 说明文案」。
 *
 * tenantId 的完整流转链路：
 * 1. 调用方（如 session 管理器）传入 tenantId → createToolBundle(cwd, tenantId)
 * 2. createToolBundle 读取用户配置（readFgbgUserConfig）和安全配置（resolveToolSecurityConfig）
 * 3. 根据 securityConfig.enabledTools 从 TOOL_CATALOG 中筛选出允许的工具名
 * 4. 对每个工具名，调用 TOOL_CATALOG[name].factory(cwd, tenantId) 实例化
 * 5. 工具内部闭包持有 tenantId，用于：
 *    - 解析租户专属的文件路径（如 workspace/memory/、workspace/skills/）
 *    - 获取该租户的 agent 运行状态（如 IM channel：qq/weixin）
 *    - 路由 bot 账号（不同租户可能绑定不同 bot）
 *
 * 按租户组装工具的机制：
 * - 不同租户调用 createToolBundle 时，传入各自的 (cwd, tenantId)
 * - 同一工具工厂函数会为不同租户产出不同实例，实例间完全隔离
 * - enabledTools 也按租户配置差异化，因此不同租户看到的工具集合可能不同
 */

import { readFgbgUserConfig } from "../../config/index.js";
import { resolveToolSecurityConfig } from "./security/tool-security.resolve.js";
import type { ToolMode } from "./security/constants.js";
import { TOOL_CATALOG } from "./tool-catalog.js";

/**
 * 工具包：包含给定 cwd 和 tenantId 下的所有工具实例与说明文案。
 */
export type ToolBundle = {
  /** 工具实例列表 —— 每个工具已绑定 (cwd, tenantId) 闭包，可直接调用 */
  tools: unknown[];
  /** 工具说明文案列表 —— 用于拼接 system prompt，告知 LLM 有哪些工具可用 */
  toolings: string[];
  /** 当前内置安全模式（如 "guard" 表示受限模式） */
  preset: ToolMode;
};

/**
 * 根据当前配置为给定 cwd 和 tenantId 生成工具实例与说明文案。
 *
 * tenantId 流转过程：
 *   传入 → 筛选 enabledTools → 对每个工具调用 factory(cwd, tenantId) → 工具闭包持有 tenantId
 *
 * @param cwd 租户 workspace 目录（用于文件路径安全检查，防止越权访问）
 * @param tenantId 租户 ID（用于工具内部路由 agent 状态和 bot 账号）
 */
export function createToolBundle(cwd: string, tenantId: string): ToolBundle {
  // 1. 读取用户配置（包含 enabledTools 等安全策略）
  const config = readFgbgUserConfig();
  // 2. 解析出最终的安全配置（合并默认值、用户覆盖等）
  const securityConfig = resolveToolSecurityConfig(config.toolSecurity);

  // 3. 从 enabledTools 中过滤出已在 TOOL_CATALOG 注册的有效工具名
  const enabledToolNames = securityConfig.enabledTools.filter(
    (name): name is string =>
      typeof name === "string" && name in TOOL_CATALOG,
  );

  // 4. 为每个工具名调用工厂函数，传入 (cwd, tenantId) 生成实例
  //    工具内部通过闭包持有 tenantId，后续调用时可访问租户专属资源
  const tools = enabledToolNames.map((name) =>
    TOOL_CATALOG[name].factory(cwd, tenantId),
  );
  // 5. 收集工具说明文案，用于构建 system prompt
  const toolings = enabledToolNames.map(
    (name) => TOOL_CATALOG[name].description,
  );

  return {
    tools,
    toolings,
    preset: securityConfig.preset || "guard",
  };
}

/**
 * 需要从 session 历史对话记录（context）中过滤掉的工具名列表。
 *
 * 为什么需要过滤：
 * - 这些工具的返回值已经作为 system prompt 的一部分注入到 LLM 上下文中
 * - 如果保留在历史对话中，会造成信息重复，浪费 context window
 * - 典型场景：memorySearch 返回的记忆内容、persistKnowledge 的确认信息、
 *   read 读取的文件内容等，都已直接放入 prompt，无需在对话历史中再出现
 *
 * 包含的工具：
 * - memorySearch：记忆搜索结果已注入 prompt
 * - persistKnowledge：知识持久化的确认信息已注入 prompt
 * - loadSkill：技能加载内容已注入 prompt
 * - read：文件读取内容已注入 prompt
 * - reminderTask：提醒任务信息已注入 prompt
 */
export const FILTER_FROM_CONTEXT_TOOL_NAMES = [
  "memorySearch",
  "persistKnowledge",
  "loadSkill",
  "read",
  "reminderTask",
] as const;

/**
 * 获取需要从上下文过滤的工具名列表。
 *
 * 返回值：只读字符串数组，包含所有「结果已注入 system prompt」的工具名。
 * 调用方在构建 LLM 对话历史时，应过滤掉这些工具的调用记录，避免重复。
 */
export function getFilterContextToolNames(): readonly string[] {
  return FILTER_FROM_CONTEXT_TOOL_NAMES;
}
