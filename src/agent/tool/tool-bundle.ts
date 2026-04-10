/**
 * 工具装配（bundle）
 *
 * 读 readFgbgUserConfig() → resolveToolSecurityConfig → 按 enabledTools 过滤 tool-catalog → 生成 tools[] / toolings[]
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
 * 根据当前配置为给定 cwd 生成工具实例与说明文案。
 * 工具列表完全由 toolSecurity.enabledTools 决定。
 */
export function createToolBundle(cwd: string): ToolBundle {
  const config = readFgbgUserConfig();
  const securityConfig = resolveToolSecurityConfig(config.toolSecurity);

  // 从 enabledTools 过滤出已注册的工具
  const enabledToolNames = securityConfig.enabledTools.filter(
    (name): name is string =>
      typeof name === "string" && name in TOOL_CATALOG,
  );

  const tools = enabledToolNames.map((name) =>
    TOOL_CATALOG[name].factory(cwd),
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
 * 下述工具的返回值本就会成为系统提示词的一部分，因此不应该出现在历史对话信息中
 */
export const FILTER_FROM_CONTEXT_TOOL_NAMES = [
  "memorySearch",
  "persistKnowledge",
  "loadSkill",
  "read",
  "reminderTask",
] as const;

/**
 * 获取需要从上下文过滤的工具名列表
 */
export function getFilterContextToolNames(): readonly string[] {
  return FILTER_FROM_CONTEXT_TOOL_NAMES;
}
