import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { enforceTextSizeLimit } from "../utils/file-utils.js";
import { errResult, okResult, type ToolDetails } from "../tool-result.js";
import type { AgentChannel } from "../../channel-policy.js";

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

/**
 * 将路径展开为实际文件系统路径。
 * Node.js 不原生支持 ~ 展开，这里手动处理。
 */
function expandPath(inputPath: string): string {
  if (inputPath.startsWith("~")) {
    return path.resolve(os.homedir(), inputPath.slice(inputPath.startsWith("~/") || inputPath.startsWith("~\\") ? 2 : 1));
  }
  return path.resolve(inputPath);
}

/**
 * 创建文件写入工具。
 * 安全检查（路径校验 + 审批）由 createToolBundle 的 security wrapper 自动织入。
 * 本工具只负责写入文件（含内容大小限制）。
 */
export function createWriteTool(
  _workspace: string,
  tenantId: string,
  channel: AgentChannel,
  _agentId: string,
): ToolDefinition<typeof writeParameters, ToolDetails<WriteOutput>> {
  void _agentId;
  void tenantId;
  void channel;

  return {
    name: "write",
    label: "Write",
    description:
      "writeFile(path, content) - write file content (safe, text-only)",
    parameters: writeParameters,
    execute: async (_toolCallId, params: WriteInput, _signal, _onUpdate) => {
      const started = Date.now();

      // 内容大小限制（工具特有的业务逻辑）
      if (!enforceTextSizeLimit(params.content)) {
        return errResult("写入内容过大，超过 1MB 限制", {
          code: "INVALID_ARGUMENT",
          message: "content 超过 1MB",
        });
      }

      try {
        // 路径已在 wrapper 中校验过，这里只做 ~ 展开和 resolve
        const filePath = expandPath(params.path);

        // 确保目录存在
        await fs.mkdir(path.dirname(filePath), {
          recursive: true,
          mode: 0o700,
        });
        await fs.writeFile(filePath, params.content, {
          encoding: "utf8",
          mode: 0o600,
        });
        const bytesWritten = Buffer.byteLength(params.content, "utf8");
        const durationMs = Date.now() - started;
        toolLogger.info(
          `tool=write path=${filePath} bytes=${bytesWritten} durationMs=${durationMs}`,
        );
        return okResult(`Wrote ${bytesWritten} bytes to ${params.path}`, {
          path: filePath,
          bytesWritten,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.warn(`tool=write path=${params.path} error=${message}`);
        return errResult(`写入失败: ${message}`, {
          code: "IO_ERROR",
          message,
        });
      }
    },
  };
}
