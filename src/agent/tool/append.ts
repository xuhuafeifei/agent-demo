import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { exists, enforceTextSizeLimit } from "./file-utils.js";
import { resolvePathInWorkspace } from "./guards.js";
import { errResult, okResult, type ToolDetails } from "./types.js";

const toolLogger = getSubsystemConsoleLogger("tool");

const appendParameters = Type.Object({
  path: Type.String({ minLength: 1 }),
  content: Type.String(),
  ensureTrailingNewline: Type.Optional(Type.Boolean()),
  createIfNotExists: Type.Optional(Type.Boolean()),
});

type AppendInput = Static<typeof appendParameters>;

type AppendOutput = {
  path: string;
  appendedBytes: number;
};

export function createAppendTool(
  workspace: string,
): ToolDefinition<typeof appendParameters, ToolDetails<AppendOutput>> {
  return {
    name: "append",
    label: "Append",
    description: "Append text content to a file in current workspace.",
    parameters: appendParameters,
    execute: async (
      _toolCallId,
      params: AppendInput,
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
      let content = params.content;
      if (params.ensureTrailingNewline && !content.endsWith("\n")) {
        content += "\n";
      }

      if (!enforceTextSizeLimit(content)) {
        return errResult("追加内容过大，超过 1MB 限制", {
          code: "INVALID_ARGUMENT",
          message: "content 超过 1MB",
        });
      }

      const createIfNotExists = params.createIfNotExists ?? true;
      const fileExists = await exists(filePath);
      if (!fileExists && !createIfNotExists) {
        return errResult(`文件不存在: ${params.path}`, {
          code: "NOT_FOUND",
          message: `文件不存在: ${params.path}`,
        });
      }

      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
        await fs.appendFile(filePath, content, { encoding: "utf8", mode: 0o600 });
        const appendedBytes = Buffer.byteLength(content, "utf8");
        const durationMs = Date.now() - started;
        toolLogger.info(
          `tool=append path=${filePath} bytes=${appendedBytes} durationMs=${durationMs}`,
        );
        return okResult(`Appended ${appendedBytes} bytes to ${params.path}`, {
          path: filePath,
          appendedBytes,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.warn(`tool=append path=${filePath} error=${message}`);
        return errResult(`追加失败: ${message}`, {
          code: "IO_ERROR",
          message,
        });
      }
    },
  };
}
