import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { exists, atomicWriteText, enforceTextSizeLimit } from "./file-utils.js";
import { resolvePathInWorkspace } from "./guards.js";
import { errResult, okResult, type ToolDetails } from "./types.js";

const toolLogger = getSubsystemConsoleLogger("tool");

const persistMemoryParameters = Type.Object({
  filename: Type.String({ minLength: 1 }),
  content: Type.String(),
});

type PersistMemoryInput = Static<typeof persistMemoryParameters>;

type PersistMemoryOutput = {
  path: string;
  action: "created" | "appended";
  bytesWritten: number;
};

/**
 * 总结记忆并持久化：在 workspace 下写入 .md 文件。
 * - filename: 相对路径，如 "memory/xxx.md"、"USER.md"、"MEMORY.md"
 * - 若文件已存在则追加 content；否则新建并写入 content
 */
export function createPersistMemoryTool(
  workspace: string,
): ToolDefinition<typeof persistMemoryParameters, ToolDetails<PersistMemoryOutput>> {
  return {
    name: "persistMemory",
    label: "Persist memory",
    description:
      "Persist info as a markdown file under workspace. Choose filename: USER.md for user profile (name, preferences, working style); memory/xxx.md for topic/project summaries; MEMORY.md for other long-term memory. Append if file exists, else create.",
    parameters: persistMemoryParameters,
    execute: async (
      _toolCallId,
      params: PersistMemoryInput,
      _signal,
      _onUpdate,
      _ctx,
    ) => {
      const started = Date.now();
      const resolved = resolvePathInWorkspace(workspace, params.filename);
      if (!resolved.ok) {
        return errResult(resolved.error.message, resolved.error);
      }

      const filePath = resolved.value;

      if (!enforceTextSizeLimit(params.content)) {
        return errResult("content 超过 1MB 限制", {
          code: "INVALID_ARGUMENT",
          message: "content 超过 1MB",
        });
      }

      const fileExists = await exists(filePath);

      try {
        if (fileExists) {
          const toAppend = params.content.endsWith("\n")
            ? params.content
            : params.content + "\n";
          await fs.mkdir(path.dirname(filePath), {
            recursive: true,
            mode: 0o700,
          });
          await fs.appendFile(filePath, toAppend, {
            encoding: "utf8",
            mode: 0o600,
          });
          const bytesWritten = Buffer.byteLength(toAppend, "utf8");
          const durationMs = Date.now() - started;
          toolLogger.info(
            `tool=persistMemory path=${filePath} action=appended bytes=${bytesWritten} durationMs=${durationMs}`,
          );
          return okResult(
            `已追加 ${bytesWritten} 字节到 ${params.filename}`,
            { path: filePath, action: "appended", bytesWritten },
          );
        } else {
          await atomicWriteText(filePath, params.content);
          const bytesWritten = Buffer.byteLength(params.content, "utf8");
          const durationMs = Date.now() - started;
          toolLogger.info(
            `tool=persistMemory path=${filePath} action=created bytes=${bytesWritten} durationMs=${durationMs}`,
          );
          return okResult(
            `已创建 ${params.filename} 并写入 ${bytesWritten} 字节`,
            { path: filePath, action: "created", bytesWritten },
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.warn(`tool=persistMemory path=${filePath} error=${message}`);
        return errResult(`写入失败: ${message}`, {
          code: "IO_ERROR",
          message,
        });
      }
    },
  };
}
