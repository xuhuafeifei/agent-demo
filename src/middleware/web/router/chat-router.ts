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
} from "../../../agent/tool/utils/tool-result-ui.js";
import { sanitizeToolArgs } from "../../../agent/tool/security/param-sanitizer.js";
import { readFgbgUserConfig } from "../../../config/index.js";

const webLogger = getSubsystemConsoleLogger("web");

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

function formatToolInputForDisplay(args: unknown): string {
  if (args === undefined || args === null) return "-";
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/**
 * Chat router: POST /chat (SSE 流式响应)
 *
 * Web 端当前为单租户：tenantId 由配置文件 channels.web.tenantId 决定（默认 "default"）。
 */
export function createChatRouter() {
  const router = Router();

  router.post("/", async (req, res) => {
    const { message } = req.body as { message?: string };
    if (!message) {
      return res.status(400).json({ error: "缺少消息内容" });
    }

    // 初始化响应头：设置为 SSE 流式响应
    // Content-Type 为 text/event-stream，禁用缓存，保持长连接
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // 将当前响应对象注册到审批管理器，供工具调用需要用户确认时使用
    approvalManager.setActiveRes(res);
    // 发送流开始信号和用户消息回显
    writeNamedSse(res, "streamStart", { startedAt: Date.now() });
    writeNamedSse(res, "user_message_chunk", { content: message });

    let assistantTextSoFar = "";
    let thinkingTextSoFar = "";
    const toolStartedAt = new Map<string, number>();

    // 从配置文件 (fgbg.json) 中读取 web 渠道对应的租户 ID
    // 当前 Web 端为单租户模式，tenantId 由 channels.web.tenantId 决定（默认 "default"）
    const tenantId = readFgbgUserConfig().channels.web.tenantId;

    // 调用 runWithSingleFlight 执行 Agent 逻辑：
    // - module: "main" 表示主对话模块
    // - tenantId: 用于隔离不同租户的会话状态和上下文
    // - sessionKey: 未显式传入时由 runWithSingleFlight 内部根据 channel + tenantId 派生
    // - singleFlight 机制确保同一会话同一时间只有一个请求在执行，避免并发冲突
    try {
      await runWithSingleFlight({
        message,
        channel: "web",
        tenantId,
        module: "main",
        // onEvent：Agent 运行时产生流式事件时的回调，负责将不同类型的事件转换为 SSE 推送
        onEvent: (event: RuntimeStreamEvent) => {
          // 文本消息增量更新
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
            const sanitizedArgs = sanitizeToolArgs(event.args);
            const inputDisplay = formatToolInputForDisplay(sanitizedArgs);
            writeNamedSse(res, "tool_call", {
              id: event.toolCallId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              title: `正在执行 ${displayName}`,
              input: inputDisplay,
              args: sanitizedArgs,
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
            const elapsedMs = typeof startedAt === "number" ? Date.now() - startedAt : 0;
            const displayName = getToolDisplayName(event.toolName, event.alias);
            const failed = event.isError || toolReturnedFailure(event.result);
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
        // onBusy：singleFlight 检测到当前会话已有请求在执行时触发，返回忙状态提示
        onBusy: () => {
          writeSse(res, { type: "error", error: "指令正在运行中，请稍后" });
        },
      });
    } catch (error) {
      // 异常处理：统一记录日志，区分模型不可用错误和其他运行时错误
      const runtimeError = error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(`[chat] ${runtimeError.message}`, error);
      if (error instanceof ModelUnavailableError) {
        // 模型服务不可用时，发送结构化错误事件（包含 provider/model 信息）
        writeNamedSse(res, "error", {
          error: error.message,
          provider: error.provider,
          model: error.model,
          detail: error.detail,
        });
        return;
      }
      // 其他错误发送通用 error 事件
      writeSse(res, { type: "error", error: runtimeError.message });
    } finally {
      // 清理：注销当前活跃响应，取消所有待审批，发送流结束标记并关闭连接
      approvalManager.clearActiveRes();
      approvalManager.cancelAll();
      writeNamedSse(res, "streamEnd", { endedAt: Date.now() });
      res.end();
    }
  });

  return router;
}
