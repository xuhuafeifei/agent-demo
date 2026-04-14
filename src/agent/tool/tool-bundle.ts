/**
 * 工具装配（Tool Bundle）
 *
 * 核心职责：将「配置」转换为「运行时工具实例 + 说明文案」。
 * 安全检查通过 checks 声明式注册，由 security-wrapper 统一织入。
 */

import { readFgbgUserConfig } from "../../config/index.js";
import { resolveToolSecurityConfig } from "./security/tool-security.resolve.js";
import type { ToolMode } from "./security/constants.js";
import { TOOL_CATALOG, type RuntimeToolDefinition } from "./tool-catalog.js";
import type { AgentChannel } from "../channel-policy.js";
import { wrapToolWithCheck } from "./security/security-wrapper.js";

function toolingDescriptionFromTool(
  tool: RuntimeToolDefinition,
  fallbackName: string,
): string {
  const d = tool.description.trim();
  if (d) return d;
  return fallbackName;
}

/**
 * 工具包：包含给定 cwd 和 tenantId 下的所有工具实例与说明文案。
 */
export type ToolBundle = {
  /** 工具实例列表 —— 每个工具已绑定 (cwd, tenantId) 闭包，可直接调用 */
  tools: RuntimeToolDefinition[];
  /** 工具说明文案列表 —— 用于拼接 system prompt，告知 LLM 有哪些工具可用 */
  toolings: string[];
  /** 当前内置安全模式（如 "guard" 表示受限模式） */
  preset: ToolMode;
};

/**
 * 根据当前配置为给定 cwd 和 tenantId 生成工具实例与说明文案。
 *
 * tenantId / channel / agentId 由调用方显式传入，便于测试；agentId 与 agent-state 主键一致，工具内可按需使用。
 *
 * @param cwd 租户 workspace 目录（用于文件路径安全检查，防止越权访问）
 * @param tenantId 租户 ID（用于工具内部路由 bot 账号等）
 * @param channel 当前运行渠道
 * @param agentId 运行实例键 `agent:{module}:{tenantId}`，装配时传入供工具闭包预留
 */
export function createToolBundle(
  cwd: string,
  tenantId: string,
  channel: AgentChannel,
  agentId: string,
): ToolBundle {
  // 1. 读取用户配置（包含 enabledTools 等安全策略）
  const config = readFgbgUserConfig();
  // 2. 解析出最终的安全配置（合并默认值、用户覆盖等）
  const securityConfig = resolveToolSecurityConfig(config.toolSecurity);

  // 3. 从 enabledTools 中过滤出已在 TOOL_CATALOG 注册的有效工具名
  const enabledToolNames = securityConfig.enabledTools.filter(
    (name): name is string => typeof name === "string" && name in TOOL_CATALOG,
  );

  // 4. 为每个工具名调用工厂函数，传入 (cwd, tenantId, channel, agentId) 生成实例
  //    然后自动织入安全检查 wrapper（如果 catalog 注册了 checks）
  const tools = enabledToolNames.map((name) => {
    const entry = TOOL_CATALOG[name];
    let tool = entry.factory(cwd, tenantId, channel, agentId);

    // AOP 织入：所有 checks（安全检查 + 通道运行时校验）
    if (entry.checks && entry.checks.length > 0) {
      tool = wrapToolWithCheck(
        tool,
        entry.checks,
        cwd,
        tenantId,
        channel,
        agentId,
      );
    }

    return tool;
  });

  // 5. 与 Pi 一致：说明文案取自工具实例上的 description（单源）
  const toolings = tools.map((tool, i) =>
    toolingDescriptionFromTool(tool, enabledToolNames[i] ?? "tool"),
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
