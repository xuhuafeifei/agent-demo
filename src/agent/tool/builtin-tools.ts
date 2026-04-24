/**
 * 系统必带工具名：与 heavy/light 中「能力档位」无关，只要主链路为 heavy 并装配基础包，这四项会始终注入。
 * - memorySearch / persistKnowledge / loadSkill：知识侧
 * - getNow：时间/调度侧
 *
 * 以下**不属于**本列表，仅出现在 heavy 下由「用户/预设 enabledTools」装配（可勾选、可关）：
 * - read, bash, edit, write 等工程与文件类工具
 */
export const BUILTIN_TOOL_NAMES = [
  "memorySearch",
  "getNow",
  "persistKnowledge",
  "loadSkill",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];
