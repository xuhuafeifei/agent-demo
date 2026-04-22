/**
 * 工具装配（Tool Bundle）模块
 *
 * 该模块提供了 Agent 运行时工具的装配、管理和上下文过滤功能。
 * 核心职责包括：
 * - 按工具名称列表创建工具包（含安全包装）
 * - 装配内置工具（与业务场景无关的通用工具）
 * - 管理需要从会话历史中过滤的工具列表（避免信息重复）
 */

import {
  TOOL_ENTRY_BY_NAME,
  type RuntimeToolDefinition,
} from "./tool-catalog.js";
import type { AgentChannel } from "../channel-policy.js";
import { wrapToolWithCheck } from "./security/security-wrapper.js";
import { BUILTIN_TOOL_NAMES } from "./builtin-tools.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";

// 工具装配模块专用日志记录器
const toolBundleLogger = getSubsystemConsoleLogger("tool-bundle");

/**
 * 从工具定义中提取工具描述
 *
 * 优先使用工具自身的 description 属性，若为空则使用备用名称
 *
 * @param tool - 运行时工具定义
 * @param fallbackName - 工具描述为空时的备用名称
 * @returns 格式化后的工具描述字符串
 */
function toolingDescriptionFromTool(
  tool: RuntimeToolDefinition,
  fallbackName: string,
): string {
  const d = tool.description.trim();
  if (d) return d;
  return fallbackName;
}

/**
 * 工具包类型定义
 *
 * 包含给定环境下的所有工具实例和对应的说明文案，用于 Agent 运行时的工具管理
 */
export type ToolBundle = {
  /** 工具实例数组 */
  tools: RuntimeToolDefinition[];
  /** 工具说明文案数组，与 tools 数组一一对应 */
  toolings: string[];
};

/**
 * 按工具名称列表创建工具包
 *
 * 核心功能：
 * - 根据工具名称从工具目录中查找对应的工厂函数
 * - 使用安全包装器包装工具（添加权限检查、安全限制等）
 * - 生成工具说明文案数组
 *
 * @param cwd - 当前工作目录
 * @param runtimeTenantId - 运行时租户ID
 * @param channel - Agent 渠道策略（影响工具可用范围）
 * @param agentId - Agent 实例ID
 * @param toolNames - 要装配的工具名称列表
 * @returns 包含工具实例和说明文案的工具包
 */
export function createToolBundle(
  cwd: string,
  runtimeTenantId: string,
  channel: AgentChannel,
  agentId: string,
  toolNames: readonly string[],
): ToolBundle {
  // 过滤有效工具名称（仅保留在工具目录中注册过的工具）
  const enabledToolNames: string[] = [];
  for (const name of toolNames) {
    if (!TOOL_ENTRY_BY_NAME.has(name)) {
      toolBundleLogger.error(
        `[tool-bundle] unknown tool name, skipped: ${String(name)}`,
      );
      continue;
    }
    enabledToolNames.push(name);
  }

  // 创建工具实例并应用安全包装
  const tools = enabledToolNames.map((name) => {
    const entry = TOOL_ENTRY_BY_NAME.get(name)!;
    let tool = entry.factory(cwd, runtimeTenantId, channel, agentId);

    // 若工具配置了安全检查，则应用安全包装
    if (entry.checks && entry.checks.length > 0) {
      tool = wrapToolWithCheck(
        tool,
        entry.checks,
        cwd,
        runtimeTenantId,
        channel,
        agentId,
      );
    }

    return tool;
  });

  // 生成工具说明文案数组
  const toolings = tools.map((tool, i) =>
    toolingDescriptionFromTool(tool, enabledToolNames[i] ?? "tool"),
  );

  return { tools, toolings };
}

/**
 * 创建内置工具包
 *
 * 内置工具是与业务场景无关的通用工具，所有 Agent 实例都会默认加载
 *
 * @param cwd - 当前工作目录
 * @param runtimeTenantId - 运行时租户ID
 * @param channel - Agent 渠道策略
 * @param agentId - Agent 实例ID
 * @returns 包含所有内置工具的工具包
 */
export function createBuiltInTools(
  cwd: string,
  runtimeTenantId: string,
  channel: AgentChannel,
  agentId: string,
): ToolBundle {
  // 过滤有效的内置工具名称（确保工具在目录中已注册）
  const names = BUILTIN_TOOL_NAMES.filter((n) => TOOL_ENTRY_BY_NAME.has(n));
  return createToolBundle(cwd, runtimeTenantId, channel, agentId, names);
}

/**
 * 需要从会话历史对话记录中过滤的工具名称列表
 *
 * 设计原因：
 * - 这些工具的返回值已经作为 system prompt 的一部分直接注入到 LLM 上下文中
 * - 如果保留在历史对话中，会造成信息重复，浪费 context window 空间
 * - 典型场景：memorySearch 返回的记忆内容、read 读取的文件内容等已直接放入 prompt
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
 * 获取需要从上下文过滤的工具名称列表
 *
 * 提供只读访问接口，避免外部直接修改过滤列表
 *
 * @returns 需要过滤的工具名称数组
 */
export function getFilterContextToolNames(): readonly string[] {
  return FILTER_FROM_CONTEXT_TOOL_NAMES;
}
