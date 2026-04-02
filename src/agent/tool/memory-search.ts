import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getMemoryIndexManager } from "../../memory/index.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { errResult, okResult, type ToolDetails } from "./types.js";

const toolLogger = getSubsystemConsoleLogger("tool");

const memorySearchParameters = Type.Object({
  query: Type.String({ minLength: 1 }),
  topKFts: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  topKVector: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  topN: Type.Optional(Type.Number({ minimum: 1, maximum: 30 })),
});

type MemorySearchInput = Static<typeof memorySearchParameters>;

type MemorySearchOutput = {
  hits: Array<{ content: string; score: number }>;
};

export function createMemorySearchTool(): ToolDefinition<
  typeof memorySearchParameters,
  ToolDetails<MemorySearchOutput>
> {
  return {
    name: "memorySearch",
    label: "Memory Search",
    description:
      "Search relevant memory chunks from indexed workspace/session.",
    parameters: memorySearchParameters,
    execute: async (
      _toolCallId,
      params: MemorySearchInput,
      _signal,
      _onUpdate,
      _ctx,
    ) => {
      const started = Date.now();
      const query = params.query.trim();
      if (!query) {
        return errResult("query 不能为空", {
          code: "INVALID_ARGUMENT",
          message: "query 不能为空",
        });
      }

      try {
        const hits = await getMemoryIndexManager().search(query, {
          topKFts: params.topKFts,
          topKVector: params.topKVector,
          topN: params.topN,
        });
        const durationMs = Date.now() - started;
        toolLogger.info(
          `tool=memorySearch query="${query.slice(0, 80)}${query.length > 80 ? "..." : ""}" hits=${hits.length} durationMs=${durationMs}`,
        );

        const summary =
          hits.length === 0
            ? "Found 0 memory hits."
            : hits
                .map(
                  (hit, i) =>
                    `[${i + 1}] score=${hit.score}\nfile_path=${hit.path} L${hit.lineStart}-${hit.lineEnd}\n${hit.content}`,
                )
                .join("\n\n---\n\n");

        return okResult(summary, {
          hits: hits.map((hit) => ({ content: hit.content, score: hit.score })),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.warn(`tool=memorySearch error=${message}`);
        return errResult(`memorySearch 失败: ${message}`, {
          code: "INTERNAL_ERROR",
          message,
        });
      }
    },
  };
}
