/**
 * 系统内置工具名（与 lane 无关）。
 * 与历史 pi-coding-agent 默认四件套 read/bash/edit/write 对齐，由本仓 factory 经 customTools 提供实现。
 * heavy 运行时由 ToolHook 与用户 enabledTools 求并集；light 不注入任何工具。
 */
export const BUILTIN_TOOL_NAMES = [
  "read",
  // "bash",
  // "edit",
  // "write",
  "memorySearch",
  "getNow",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];
