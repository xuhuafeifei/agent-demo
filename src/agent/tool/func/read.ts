import fs from "node:fs/promises";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { exists } from "../utils/file-utils.js";
import { checkPathSafety } from "../security/path-checker.js";
import {
  isTextFile,
  getFileTypeRejectReason,
} from "../security/file-type-checker.js";
import { errResult, okResult, type ToolDetails } from "../tool-result.js";
import { readFgbgUserConfig } from "../../../config/index.js";
import { resolveToolSecurityConfig } from "../security/tool-security.resolve.js";
import { requiresApproval } from "../tool-approval.js";
import { requestApprovalWithDescription } from "../utils/approval-helpers.js";
import { resolveTenantWorkspaceDir } from "../../../utils/app-path.js";
import { getAgentState } from "../../agent-state.js";

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
 * @param tenantId 租户 ID，用于解析工作区路径和获取当前渠道（审批用）
 */
export function createReadTool(tenantId: string): ToolDefinition<
  typeof readParameters,
  ToolDetails<ReadOutput>
> {
  // 租户 workspace 目录，作为路径安全检查的根目录
  const workspace = resolveTenantWorkspaceDir(tenantId);

  return {
    name: "read",
    label: "Read",
    description:
      "readFile(path, offset?, limit?) - read text from file (safe, text-only)",
    parameters: readParameters,
    execute: async (
      _toolCallId,
      params: ReadInput,
      _signal,
      _onUpdate,
      _ctx,
    ) => {
      const started = Date.now();

      // 1. 路径安全检查
      const pathCheck = await checkPathSafety(
        params.path,
        workspace,
        readFgbgUserConfig().toolSecurity,
      );
      if (!pathCheck.allowed) {
        return errResult(pathCheck.reason || "路径不允许访问", {
          code: "PATH_OUT_OF_WORKSPACE",
          message: pathCheck.reason || "路径不允许访问",
        });
      }

      const filePath = pathCheck.realPath;

      // 2. 审批检查（如果配置要求）
      const config = readFgbgUserConfig();
      const securityConfig = resolveToolSecurityConfig(config.toolSecurity);
      if (requiresApproval("read", securityConfig.approval)) {
        // 从当前租户的 agent 状态中获取渠道信息
        const channel = getAgentState(tenantId)?.channel ?? "web";
        const approved = await requestApprovalWithDescription(
          "read",
          { path: params.path },
          `读取文件: ${params.path}`,
          {
            channel,
            unapprovableStrategy: securityConfig.unapprovableStrategy,
            timeoutMs: securityConfig.approval.timeoutMs,
          },
        );
        if (!approved) {
          return errResult("用户拒绝或超时", {
            code: "USER_REJECTED",
            message: "用户拒绝或超时",
          });
        }
      }

      // 3. 文件存在性检查
      if (!(await exists(filePath))) {
        return errResult(`文件不存在: ${params.path}`, {
          code: "NOT_FOUND",
          message: `文件不存在: ${params.path}`,
        });
      }

      // 4. 文本文件门控：仅允许读取文本文件
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
