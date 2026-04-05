/**
 * pi-agent-core 仅在 execute() 抛错时设置 tool_execution_end.isError。
 * 使用 errResult() 正常返回时 isError 仍为 false，但 details.ok === false。
 * 此处统一供 SSE / Runtime 层做展示与 isError 对齐。
 */

export function toolReturnedFailure(result: unknown): boolean {
  if (!result || typeof result !== "object" || !("details" in result)) {
    return false;
  }
  const details = (result as { details?: { ok?: unknown } }).details;
  return details != null && details.ok === false;
}

export function toolUserRejected(result: unknown): boolean {
  if (!result || typeof result !== "object" || !("details" in result)) {
    return false;
  }
  const err = (result as { details?: { error?: { code?: string } } }).details
    ?.error;
  return err?.code === "USER_REJECTED";
}
