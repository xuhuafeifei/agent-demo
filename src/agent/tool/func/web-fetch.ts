import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { okResult, errResult, type ToolDetails } from "../tool-result.js";
import { fetchUrl } from "../../../web-fetch/http-fetcher.js";

const webFetchParams = Type.Object({
  url: Type.String({ description: "要抓取内容的 URL" }),
  prompt: Type.String({ description: "描述你想从页面提取什么信息" }),
});

type Input = Static<typeof webFetchParams>;

type Output = {
  url: string;
  content: string;
};

export function createWebFetchTool(): ToolDefinition<
  typeof webFetchParams,
  ToolDetails<Output>
> {
  return {
    name: "webFetch",
    label: "Web Fetch",
    description:
      "webFetch(url, prompt) - fetch and extract content from a URL",
    parameters: webFetchParams,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
      try {
        const result = await fetchUrl(params.url);

        return okResult(
          `Content fetched from ${params.url}`,
          { url: result.url, content: result.content },
        );
      } catch (error) {
        return errResult(`抓取失败: ${String(error)}`, {
          code: "INTERNAL_ERROR",
          message: String(error),
        });
      }
    },
  };
}
