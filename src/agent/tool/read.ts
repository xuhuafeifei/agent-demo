import fs from "node:fs/promises";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { exists } from "./utils/file-utils.js";
import { resolvePathInWorkspace } from "./guards.js";
import { errResult, okResult, type ToolDetails } from "./types.js";

const toolLogger = getSubsystemConsoleLogger("tool");

const readParameters = Type.Object({
  path: Type.String({ minLength: 1 }),
  offset: Type.Optional(Type.Number({ minimum: 0 })),
  limit: Type.Optional(Type.Number({ minimum: 1 })),
});

type ReadInput = Static<typeof readParameters>;

type ReadOutput = {
  path: string;
  content: string;
  totalLines: number;
};

/** 读取文件内容，支持按行分页 */
export function createReadTool(
  workspace: string,
): ToolDefinition<typeof readParameters, ToolDetails<ReadOutput>> {
  return {
    name: "read",
    label: "Read",
    description: "read(path, offset?, limit?) - read text from file",
    parameters: readParameters,
    execute: async (_toolCallId, params: ReadInput, _signal, _onUpdate, _ctx) => {
      const started = Date.now();
      const resolved = resolvePathInWorkspace(workspace, params.path);
      if (!resolved.ok) {
        return errResult(resolved.error.message, resolved.error);
      }

      const filePath = resolved.value;

      if (!(await exists(filePath))) {
        return errResult(`文件不存在: ${params.path}`, {
          code: "NOT_FOUND",
          message: `文件不存在: ${params.path}`,
        });
      }

      try {
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split("\n");
        const totalLines = lines.length;

        // 处理分页
        const offset = params.offset ?? 0;
        const limit = params.limit ?? totalLines;
        const slicedLines = lines.slice(offset, offset + limit);
        const slicedContent = slicedLines.join("\n");

        const durationMs = Date.now() - started;
        toolLogger.info(
          `tool=read path=${filePath} lines=${totalLines} offset=${offset} limit=${limit} durationMs=${durationMs}`,
        );

        return okResult(
          `Read ${slicedLines.length}/${totalLines} lines from ${params.path}`,
          {
            path: filePath,
            content: slicedContent,
            totalLines,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.warn(`tool=read path=${filePath} error=${message}`);
        return errResult(`读取失败: ${message}`, {
          code: "IO_ERROR",
          message,
        });
      }
    },
  };
}
