import { randomUUID } from "node:crypto";

/**
 * 与 qwen-code `DEFAULT_DASHSCOPE_BASE_URL` 一致（OpenAI 兼容入口）。
 * @see qwen-code/packages/core/src/core/openaiContentGenerator/constants.ts
 */
export const QWEN_DASHSCOPE_COMPAT_V1_BASE =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";

/**
 * 与 qwen-code `QwenContentGenerator.getCurrentEndpoint` 一致：
 * 有 `resource_url`（OAuth 下发，常见为 portal）则以其为 base；无则退回 DEFAULT_DASHSCOPE_BASE_URL。
 * @see qwen-code/packages/core/src/qwen/qwenContentGenerator.ts
 */
export function normalizeQwenOAuthResourceBaseUrl(
  resourceUrl?: string | null,
): string {
  const baseEndpoint = resourceUrl?.trim() || QWEN_DASHSCOPE_COMPAT_V1_BASE;
  const normalizedUrl = baseEndpoint.startsWith("http")
    ? baseEndpoint
    : `https://${baseEndpoint}`;
  return normalizedUrl.endsWith("/v1") ? normalizedUrl : `${normalizedUrl}/v1`;
}

type CacheMode = "system_only" | "all";

/**
 * 与 qwen-code `DashScopeOpenAICompatibleProvider.addDashScopeCacheControl` 对齐：
 * 在 X-DashScope-CacheControl: enable 时，portal 侧通常要求带 cache_control 的块结构，而不是纯字符串 content。
 */
function applyDashScopeCacheControlToMessages(
  messages: unknown[],
  cacheMode: CacheMode,
): void {
  if (messages.length === 0) return;
  const systemIndex = messages.findIndex(
    (m) =>
      m && typeof m === "object" && (m as { role?: string }).role === "system",
  );
  const lastIndex = messages.length - 1;

  for (let index = 0; index < messages.length; index++) {
    const shouldAddCacheControl = Boolean(
      (index === systemIndex && systemIndex !== -1) ||
      (index === lastIndex && cacheMode === "all"),
    );
    if (!shouldAddCacheControl) continue;

    const msg = messages[index] as {
      content?: unknown;
    };
    if (msg.content === null || msg.content === undefined) continue;

    if (typeof msg.content === "string") {
      msg.content = [
        {
          type: "text",
          text: msg.content,
          cache_control: { type: "ephemeral" },
        },
      ];
      continue;
    }
    if (!Array.isArray(msg.content) || msg.content.length === 0) continue;
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const part = msg.content[j] as { type?: string };
      if (part?.type === "text") {
        Object.assign(part, { cache_control: { type: "ephemeral" } });
        break;
      }
    }
  }
}

/**
 * 连接测试用 body：保留 portal 在 CacheControl enable 下必需的块结构（system 带 cache_control），
 * 其余字段按「能连通即可」收敛，避免与真实对话路径完全同构。
 */
export function buildQwenPortalProbeChatCompletionBody(params: {
  model: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      {
        role: "system",
        content: [
          {
            type: "text",
            text: "You are a connection tester, just test the connection, no need thinking",
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "text", text: "test connection" }],
      },
    ],
    max_tokens: 64,
  };
  return body;
}
