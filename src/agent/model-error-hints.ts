/**
 * 模型/Provider 原始错误信息增强（本仓库维护，不修改 pi-ai 等依赖）
 *
 * 用于日志与推送给前端的 error 文案，便于排查已知模式。
 */

/**
 * 若匹配已知模式，在原始错误后追加简短说明；否则原样返回。
 */
export function enrichProviderErrorMessage(message: string): string {
  // OpenAI Completions 流结束时对 tool 参数做 JSON.parse；截断/非法 JSON 会抛 SyntaxError
  if (
    /Unterminated string in JSON/i.test(message) ||
    /Unexpected (?:token|end) in JSON/i.test(message)
  ) {
    return (
      `${message} ` +
      `[提示：多为流式 tool_calls 的 arguments 不完整或网关/模型返回了非法 JSON，可重试一次或更换模型/检查兼容层。]`
    );
  }
  return message;
}
