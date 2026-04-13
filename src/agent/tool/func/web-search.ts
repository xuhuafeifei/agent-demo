import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { okResult, errResult, type ToolDetails } from "../tool-result.js";
import { createSearchProvider } from "../../../web-search/factory.js";

const webSearchParams = Type.Object({
  query: Type.String({ minLength: 1, description: "搜索关键词" }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 10 })),
});

type Input = Static<typeof webSearchParams>;

type Output = {
  query: string;
  results: Array<{ title: string; url: string; snippet: string }>;
  count: number;
};

export function createWebSearchTool(): ToolDefinition<
  typeof webSearchParams,
  ToolDetails<Output>
> {
  return {
    name: "webSearch",
    label: "Web Search",
    description: "webSearch(query, limit?) - search the web for information",
    parameters: webSearchParams,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      try {
        const provider = createSearchProvider();
        const response = await provider.search({
          query: params.query,
          limit: params.limit,
        });

        return okResult(
          `Found ${response.results.length} results for "${params.query}"`,
          {
            query: response.query,
            results: response.results,
            count: response.results.length,
          },
        );
      } catch (error) {
        return errResult(`搜索失败: ${String(error)}`, {
          code: "INTERNAL_ERROR",
          message: String(error),
        });
      }
    },
  };
}
