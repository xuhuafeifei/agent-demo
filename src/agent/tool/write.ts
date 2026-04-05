import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { enforceTextSizeLimit } from "./utils/file-utils.js";
import { resolvePathInWorkspace } from "./guards.js";
import { errResult, okResult, type ToolDetails } from "./types.js";

const toolLogger = getSubsystemConsoleLogger("tool");

const writeParameters = Type.Object({
  path: Type.String({ minLength: 1 }),
  content: Type.String(),
});

type WriteInput = Static<typeof writeParameters>;

type WriteOutput = {
  path: string;
  bytesWritten: number;
};

/** 写入文件内容，覆盖已有内容 */
export function createWriteTool(
  workspace: string,
): ToolDefinition<typeof writeParameters, ToolDetails<WriteOutput>> {
  return {
    name: "write",
    label: "Write",
    description: "write(path, content) - write file content",
    parameters: writeParameters,
    execute: async (
      _toolCallId,
      params: WriteInput,
      _signal,
      _onUpdate,
      _ctx,
    ) => {
      const started = Date.now();
      const resolved = resolvePathInWorkspace(workspace, params.path);
      if (!resolved.ok) {
        return errResult(resolved.error.message, resolved.error);
      }

      const filePath = resolved.value;

      if (!enforceTextSizeLimit(params.content)) {
        return errResult("写入内容过大，超过 1MB 限制", {
          code: "INVALID_ARGUMENT",
          message: "content 超过 1MB",
        });
      }

      try {
        // 确保目录存在
        await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
        await fs.writeFile(filePath, params.content, { encoding: "utf8", mode: 0o600 });
        const bytesWritten = Buffer.byteLength(params.content, "utf8");
        const durationMs = Date.now() - started;
        toolLogger.info(
          `tool=write path=${filePath} bytes=${bytesWritten} durationMs=${durationMs}`,
        );
        return okResult(
          `Wrote ${bytesWritten} bytes to ${params.path}`,
          {
            path: filePath,
            bytesWritten,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.warn(`tool=write path=${filePath} error=${message}`);
        return errResult(`写入失败: ${message}`, {
          code: "IO_ERROR",
          message,
        });
      }
    },
  };
}
