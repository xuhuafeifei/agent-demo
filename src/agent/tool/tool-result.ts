/**
 * 工具执行结果协议（与 Pi 对齐）
 *
 * 定义工具返回值的统一形状，与「安全策略」「工具清单」零耦合。
 * 所有 read/write/... 工具文件只 import 这里。
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";

export type ToolErrorCode =
  | "INVALID_ARGUMENT"
  | "PATH_OUT_OF_WORKSPACE"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "CONFLICT"
  | "IO_ERROR"
  | "INTERNAL_ERROR"
  /** 用户在前端拒绝工具审批（非抛错路径） */
  | "USER_REJECTED";

export type ToolError = {
  code: ToolErrorCode;
  message: string;
};

export type ToolDetails<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: ToolError;
};

export function okResult<T>(
  text: string,
  data: T,
): AgentToolResult<ToolDetails<T>> {
  return {
    content: [{ type: "text", text }],
    details: { ok: true, data },
  };
}

export function errResult<T = unknown>(
  text: string,
  error: ToolError,
): AgentToolResult<ToolDetails<T>> {
  return {
    content: [{ type: "text", text }],
    details: { ok: false, error } as ToolDetails<T>,
  };
}
