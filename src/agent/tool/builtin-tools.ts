/**
 * 系统内置工具名（与 lane 无关）。
 * heavy 运行时由 ToolHook 与用户 enabledTools 求并集；light 不注入任何工具。
 */
export const BUILTIN_TOOL_NAMES = [
  "read",
  "memorySearch",
  "getNow",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];
