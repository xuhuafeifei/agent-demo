import { Router } from "express";
import {
  runWithSingleFlight,
  ModelUnavailableError,
} from "../../../agent/run.js";
import type { RuntimeStreamEvent } from "../../../agent/utils/events.js";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { writeNamedSse, writeSse } from "../utils/sse.js";
import { approvalManager } from "../../../agent/approval-manager.js";
import {
  toolReturnedFailure,
  toolUserRejected,
} from "../../../agent/tool/tool-result-ui.js";

const webLogger = getSubsystemConsoleLogger("web");

// 获取工具显示名称（优先使用 alias，否则使用 toolName）
function getToolDisplayName(toolName: string, alias?: string): string {
  return alias || toolName || "未知工具";
}

function stringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Chat router: POST /chat (SSE streaming)
 */
export function createChatRouter() {
  const router = Router();

  router.post("/", async (req, res) => {
    const { message } = req.body as { message?: string };
    if (!message) {
      return res.status(400).json({ error: "缺少消息内容" });
    }

    // 模型不可用时直接返回，避免进入 prompt 后才报 provider/auth 错误。
    // 设置 SSE 响应头。
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // 注册当前 SSE response 到 approvalManager
    approvalManager.setActiveRes(res);
    writeNamedSse(res, "streamStart", { startedAt: Date.now() });
    writeNamedSse(res, "user_message_chunk", { content: message });

    let assistantTextSoFar = "";
    let thinkingTextSoFar = "";
    const toolStartedAt = new Map<string, number>();

    try {
      await runWithSingleFlight({
        message,
        channel: "web",
        onEvent: (event: RuntimeStreamEvent) => {
          if (event.type === "message_update") {
            const delta =
              typeof event.delta === "string"
                ? event.delta
                : typeof event.text === "string"
                  ? event.text.slice(assistantTextSoFar.length)
                  : "";
            if (delta) {
              assistantTextSoFar += delta;
              writeNamedSse(res, "agent_message_chunk", { content: delta });
            }
          }

          if (event.type === "message_end" && typeof event.text === "string") {
            assistantTextSoFar = event.text;
          }

          if (event.type === "thinking_update") {
            const chunk =
              typeof event.thinkingDelta === "string"
                ? event.thinkingDelta
                : typeof event.thinking === "string"
                  ? event.thinking.slice(thinkingTextSoFar.length)
                  : "";
            if (chunk) {
              thinkingTextSoFar += chunk;
              writeNamedSse(res, "agent_thought_chunk", { content: chunk });
            }
          }

          if (event.type === "tool_execution_start") {
            toolStartedAt.set(event.toolCallId, Date.now());
            const displayName = getToolDisplayName(event.toolName, event.alias);
            writeNamedSse(res, "tool_call", {
              id: event.toolCallId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              title: `正在执行 ${displayName}`,
              content: stringifySafe(event.args),
            });
          }

          if (event.type === "tool_execution_update") {
            const displayName = getToolDisplayName(event.toolName, event.alias);
            writeNamedSse(res, "tool_call_update", {
              id: event.toolCallId,
              toolCallId: event.toolCallId,
              status: "running",
              detail: `${displayName}执行中...`,
              content: stringifySafe(event.partialResult),
            });
          }

          if (event.type === "tool_execution_end") {
            const startedAt = toolStartedAt.get(event.toolCallId);
            const elapsedMs =
              typeof startedAt === "number" ? Date.now() - startedAt : 0;
            const displayName = getToolDisplayName(event.toolName, event.alias);
            const failed =
              event.isError || toolReturnedFailure(event.result);
            const rejected = toolUserRejected(event.result);

            let title: string;
            let detail: string;
            let status: string;
            if (rejected) {
              status = "error";
              title = `已拒绝执行 ${displayName}`;
              detail = `${displayName}已拒绝执行 (${elapsedMs}ms)`;
            } else if (failed) {
              status = "error";
              title = `${displayName}执行失败`;
              detail = `${displayName}执行失败 (${elapsedMs}ms)`;
            } else {
              status = "completed";
              title = `${displayName}已完成`;
              detail = `${displayName}完成 (${elapsedMs}ms)`;
            }

            writeNamedSse(res, "tool_call_update", {
              id: event.toolCallId,
              toolCallId: event.toolCallId,
              title,
              status,
              detail,
              content: stringifySafe(event.result),
            });
          }

          writeSse(res, event);
        },
        onBusy: () => {
          writeSse(res, { type: "error", error: "指令正在运行中，请稍后" });
        },
      });
    } catch (error) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(`[chat] ${runtimeError.message}`, error);
      if (error instanceof ModelUnavailableError) {
        writeNamedSse(res, "error", {
          error: error.message,
          provider: error.provider,
          model: error.model,
          detail: error.detail,
        });
        return;
      }

      writeSse(res, {
        type: "error",
        error: runtimeError.message,
      });
    } finally {
      // 清理 approvalManager 中的 SSE response 引用
      approvalManager.clearActiveRes();
      // 取消所有未完成的审批（用户断开/请求结束时）
      approvalManager.cancelAll();
      writeNamedSse(res, "streamEnd", { endedAt: Date.now() });
      res.end();
    }
  });

  return router;
}
