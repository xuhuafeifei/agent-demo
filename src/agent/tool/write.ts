import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { enforceTextSizeLimit } from "./utils/file-utils.js";
import { checkPathSafety } from "./security/path-checker.js";
import { errResult, okResult, type ToolDetails } from "./types.js";
import { readFgbgUserConfig } from "../../config/index.js";
import { ToolRegister } from "./tool-register.js";
import { requestApprovalWithDescription } from "./utils/approval-helpers.js";

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
    description: "writeFile(path, content) - write file content (safe, text-only)",
    parameters: writeParameters,
    execute: async (
      _toolCallId,
      params: WriteInput,
      _signal,
      _onUpdate,
      _ctx,
    ) => {
      const started = Date.now();
      
      // 1. 路径安全检查
      const config = readFgbgUserConfig().toolSecurity;
      const pathCheck = await checkPathSafety(params.path, workspace, config);
      if (!pathCheck.allowed) {
        return errResult(pathCheck.reason || '路径不允许访问', {
          code: "PATH_OUT_OF_WORKSPACE",
          message: pathCheck.reason || '路径不允许访问',
        });
      }

      const filePath = pathCheck.realPath;

      // 2. 审批检查（如果配置要求）
      const requiresApproval = ToolRegister.getInstance().requiresApproval("write");
      if (requiresApproval) {
        const approvalConfig = ToolRegister.getInstance().getApprovalConfig();
        const approved = await requestApprovalWithDescription(
          "write",
          { path: params.path, contentLength: params.content.length },
          `写入文件: ${params.path} (${params.content.length} 字符)`,
          { timeoutMs: approvalConfig.timeoutMs },
        );
        if (!approved) {
          return errResult("用户拒绝或超时", {
            code: "USER_REJECTED",
            message: "用户拒绝或超时",
          });
        }
      }

      // 3. 内容大小限制
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
