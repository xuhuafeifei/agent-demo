import { type Response, Router } from "express";
import {
  clearHistory,
  getHistory,
  getAgentRuntimeState,
  runWithSingleFlight,
  ModelUnavailableError,
} from "../../agent/run.js";
import type { RuntimeStreamEvent } from "../../agent/utils/events.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";

const webLogger = getSubsystemConsoleLogger("web");

type UiEventType = "message" | "thinking" | "tool" | "context" | "status";

type RuntimeUiEvent = RuntimeStreamEvent & {
  uiEventType?: UiEventType;
  uiPayload?: Record<string, unknown>;
};

function normalizeRuntimeEvent(event: RuntimeStreamEvent): RuntimeUiEvent {
  switch (event.type) {
    case "context_snapshot": {
      const typedEvent = event as { type: "context_snapshot"; seq: number; reason: "before_prompt"; contextText: string };
      return {
        ...typedEvent,
        uiEventType: "context",
        uiPayload: {
          phase: typedEvent.type,
          seq: typedEvent.seq,
          reason: typedEvent.reason,
          contextText: typedEvent.contextText,
        },
      };
    }
    case "context_used": {
      const typedEvent = event as { type: "context_used"; totalTokens: number; threshold: number; contextWindow: number };
      return {
        ...typedEvent,
        uiEventType: "context",
        uiPayload: {
          phase: typedEvent.type,
          totalTokens: typedEvent.totalTokens,
          threshold: typedEvent.threshold,
          contextWindow: typedEvent.contextWindow,
        },
      };
    }
    case "message_start":
    case "message_update":
    case "message_end":
      return {
        ...event,
        uiEventType: "message",
        uiPayload: { phase: event.type },
      };
    case "thinking_update":
      return {
        ...event,
        uiEventType: "thinking",
        uiPayload: {
          thinking: event.thinking,
          thinkingDelta: event.thinkingDelta,
        },
      };
    case "tool_execution_start":
      return {
        ...event,
        uiEventType: "tool",
        uiPayload: {
          phase: "start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        },
      };
    case "tool_execution_update":
      return {
        ...event,
        uiEventType: "tool",
        uiPayload: {
          phase: "update",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          partialResult: event.partialResult,
        },
      };
    case "tool_execution_end":
      return {
        ...event,
        uiEventType: "tool",
        uiPayload: {
          phase: "end",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
        },
      };
    case "auto_retry_start":
    case "auto_retry_end":
    case "error":
      return {
        ...event,
        uiEventType: "context",
        uiPayload: { phase: event.type },
      };
    case "agent_end":
    case "done":
      return {
        ...event,
        uiEventType: "status",
        uiPayload: { phase: event.type },
      };
    default:
      return event;
  }
}

function writeSse(res: Response, data: RuntimeStreamEvent): void {
  const normalized = normalizeRuntimeEvent(data);
  res.write(`data: ${JSON.stringify(normalized)}\n\n`);
}

export function createWebLayer() {
  const router = Router();

  // API 路由：与 Agent 对话（流式输出）
  router.post("/chat", async (req, res) => {
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

    try {
      await runWithSingleFlight({
        message,
        channel: "web",
        onEvent: (event: RuntimeStreamEvent) => {
          writeSse(res, event);
        },
        onBusy: () => {
          writeSse(res, { type: "error", error: "指令正在运行中，请稍后" });
        },
      });
    } catch (error) {
      const runtimeError = error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(`[chat] ${runtimeError.message}`, error);
      if (error instanceof ModelUnavailableError) {
        return res.status(503).json({
          error: error.message,
          provider: error.provider,
          model: error.model,
          detail: error.detail,
        });
      }

      writeSse(res, {
        type: "error",
        error: runtimeError.message,
      });
    } finally {
      res.end();
    }
  });

  // API 路由：获取对话历史
  router.get("/history", async (_req, res) => {
    try {
      const history = getHistory();
      res.json({ success: true, history });
    } catch (error: unknown) {
      const runtimeError = error instanceof Error ? error : new Error("服务器内部错误");
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  // API 路由：清除对话历史
  router.post("/clear", async (_req, res) => {
    try {
      clearHistory();
      res.json({ success: true, message: "对话历史已清除" });
    } catch (error: unknown) {
      const runtimeError = error instanceof Error ? error : new Error("服务器内部错误");
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  // API 路由：获取 Agent 运行状态
  router.get("/status", (_req, res) => {
    const runtimeState = getAgentRuntimeState();
    res.json({
      success: true,
      runtime: runtimeState,
    });
  });

  return router;
}
