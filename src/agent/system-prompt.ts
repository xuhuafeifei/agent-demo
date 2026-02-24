const DEFAULT_PROMPT = "你是一个友好的人,能快速回复别人信息";

/**
 * 构建用于 Agent 的系统提示词，目前固定返回默认值，可后续根据配置扩展。
 */
export function buildSystemPrompt(): string {
  // TODO: 可引入配置/环境，动态拼接 context
  return DEFAULT_PROMPT;
}
