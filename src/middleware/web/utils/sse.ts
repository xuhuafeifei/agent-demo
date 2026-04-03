import type { Response } from "express";
import type { RuntimeStreamEvent } from "../../../agent/utils/events.js";

export type UiEventType =
  | "message"
  | "thinking"
  | "tool"
  | "context"
  | "status";

export type RuntimeUiEvent = RuntimeStreamEvent & {
  uiEventType?: UiEventType;
  uiPayload?: Record<string, unknown>;
};

/**
 * Write a named SSE event with event name and data.
 */
export function writeNamedSse(
  res: Response,
  eventName: string,
  data: Record<string, unknown>,
): void {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify({ ...data, type: eventName })}\n\n`);
}

/**
 * Write an unnamed SSE event (legacy format).
 */
export function writeSse(res: Response, data: RuntimeStreamEvent): void {
  const normalized = normalizeRuntimeEvent(data);
  res.write(`data: ${JSON.stringify(normalized)}\n\n`);
}

/**
 * Normalize a RuntimeStreamEvent into a frontend-friendly RuntimeUiEvent.
 */
export function normalizeRuntimeEvent(
  event: RuntimeStreamEvent,
): RuntimeUiEvent {
  switch (event.type) {
    case "context_snapshot": {
      const typedEvent = event as {
        type: "context_snapshot";
        seq: number;
        reason: "before_prompt";
        contextText: string;
      };
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
      const typedEvent = event as {
        type: "context_used";
        totalTokens: number;
        threshold: number;
        contextWindow: number;
      };
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
