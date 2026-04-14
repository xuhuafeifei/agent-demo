import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { exists } from "../utils/file-utils.js";
import {
  isTextFile,
  getFileTypeRejectReason,
} from "../security/file-type-checker.js";
import { errResult, okResult, type ToolDetails } from "../tool-result.js";
import { resolveTenantWorkspaceDir } from "../../../utils/app-path.js";
import type { AgentChannel } from "../../channel-policy.js";

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

/**
 * 创建文件读取工具。
 * 安全检查（路径校验 + 审批）由 createToolBundle 的 security wrapper 自动织入。
 * 本工具只负责读取文件内容（含文本文件门控）。
 */
export function createReadTool(
  tenantId: string,
  channel: AgentChannel,
  _agentId: string,
): ToolDefinition<typeof readParameters, ToolDetails<ReadOutput>> {
  void _agentId;
  void channel;
  // 租户 workspace 目录，作为路径安全检查的根目录
  const workspace = resolveTenantWorkspaceDir(tenantId);

  return {
    name: "read",
    label: "Read",
    description:
      "readFile(path, offset?, limit?) - read text from file (safe, text-only)",
    parameters: readParameters,
    execute: async (_toolCallId, params: ReadInput, _signal, _onUpdate) => {
      const started = Date.now();

      // 路径已在 wrapper 中校验过，这里只做 ~ 展开和 resolve
      const filePath = params.path.startsWith("~")
        ? path.resolve(os.homedir(), params.path.slice(2))
        : path.resolve(params.path);

      if (!(await exists(filePath))) {
        return errResult(`文件不存在: ${params.path}`, {
          code: "NOT_FOUND",
          message: `文件不存在: ${params.path}`,
        });
      }

      // 文本文件门控：仅允许读取文本文件
      const isText = await isTextFile(filePath);
      if (!isText) {
        const reason = getFileTypeRejectReason(filePath);
        return errResult(reason, {
          code: "INVALID_ARGUMENT",
          message: reason,
        });
      }

      try {
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split("\n");
        const totalLines = lines.length;

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
          { path: filePath, content: slicedContent, totalLines },
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
