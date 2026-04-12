/**
 * 工具装配（bundle）
 *
 * 读 readFgbgUserConfig() → resolveToolSecurityConfig → 按 enabledTools 过滤 tool-catalog → 生成 tools[] / toolings[]
 * tenantId 透传给每个工具工厂，工具内部通过 tenantId 解析路径和 agent 状态。
 */

import { readFgbgUserConfig } from "../../config/index.js";
import { resolveToolSecurityConfig } from "./security/tool-security.resolve.js";
import type { ToolMode } from "./security/constants.js";
import { TOOL_CATALOG } from "./tool-catalog.js";

export type ToolBundle = {
  /** 工具实例列表 */
  tools: unknown[];
  /** 工具说明文案列表（用于 system prompt） */
  toolings: string[];
  /** 当前内置模式 */
  preset: ToolMode;
};

/**
 * 根据当前配置为给定 cwd 和 tenantId 生成工具实例与说明文案。
 * 工具列表由 toolSecurity.enabledTools 决定，每个工具通过 (cwd, tenantId) 实例化。
 *
 * @param cwd 租户 workspace 目录（用于文件路径安全检查）
 * @param tenantId 租户 ID（用于工具内部路由 agent 状态和 bot 账号）
 */
export function createToolBundle(cwd: string, tenantId: string): ToolBundle {
  const config = readFgbgUserConfig();
  const securityConfig = resolveToolSecurityConfig(config.toolSecurity);

  // 从 enabledTools 过滤出已注册的工具
  const enabledToolNames = securityConfig.enabledTools.filter(
    (name): name is string =>
      typeof name === "string" && name in TOOL_CATALOG,
  );

  // 每个工具工厂接收 (cwd, tenantId)，工具闭包内持有租户上下文
  const tools = enabledToolNames.map((name) =>
    TOOL_CATALOG[name].factory(cwd, tenantId),
  );
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
 * 返回需要从 session 历史对话记录（context）中过滤掉的工具名列表。
 * 这些工具的返回值已作为 system prompt 的一部分，不应重复出现在历史对话中。
 */
export const FILTER_FROM_CONTEXT_TOOL_NAMES = [
  "memorySearch",
  "persistKnowledge",
  "loadSkill",
  "read",
  "reminderTask",
] as const;

/** 获取需要从上下文过滤的工具名列表 */
export function getFilterContextToolNames(): readonly string[] {
  return FILTER_FROM_CONTEXT_TOOL_NAMES;
}
