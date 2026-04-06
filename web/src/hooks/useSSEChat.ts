import { useCallback } from "react";
import { useChatStore } from "../store/chatStore";

/**
 * SSE 事件负载
 */
interface SSEPayload {
  type?: string;
  timestamp?: number;
  content?: string;
  delta?: string;
  thinkingDelta?: string;
  toolCallId?: string;
  id?: string;
  kind?: string;
  toolName?: string;
  title?: string;
  args?: Record<string, unknown>;
  status?: string;
  detail?: string;
  error?: string;
  contextWindow?: number;
  totalTokens?: number;
  model?: string;
  reason?: string;
  contextText?: string;
  // Permission request fields
  toolUseId?: string;
}

/**
 * 解析 SSE 数据块
 */
function parseSseBlocks(
  rawBuffer: string,
  onEvent: (type: string, payload: SSEPayload) => void,
): string {
  const blocks = rawBuffer.split("\n\n");
  const rest = blocks.pop() || "";

  blocks.forEach((block) => {
    if (!block.trim()) return;
    const lines = block.split("\n");
    let eventType = "";
    const dataLines: string[] = [];

    lines.forEach((line) => {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    });

    if (!dataLines.length) return;

    try {
      const payload = JSON.parse(dataLines.join("\n"));
      console.log("[SSE] Parsed event:", eventType, "payload:", payload);
      onEvent(eventType || payload.type, payload);
    } catch {
      // keep stream alive even with malformed blocks
    }
  });

  return rest;
}

/**
 * SSE Chat Hook - VSCode 方式处理流式事件
 */
export function useSSEChat() {
  const {
    startStreaming,
    endStreaming,
    appendStreamChunk,
    appendThinkingChunk,
    addToolCall,
    updateToolCall,
    addContextSnapshot,
    addContextUsed,
    breakAssistantSegment,
    addPermissionRequest,
  } = useChatStore();

  const handleEvent = useCallback(
    (type: string, payload: SSEPayload) => {
      console.log(
        "[SSE] Event received - type:",
        type,
        "payload.type:",
        payload?.type,
      );
      switch (type || payload?.type) {
        case "streamStart":
          startStreaming(payload?.timestamp);
          break;

        case "agent_message_chunk":
          appendStreamChunk(
            payload?.content || payload?.delta || "",
            payload?.timestamp,
          );
          break;

        case "agent_thought_chunk":
          appendThinkingChunk(
            payload?.content || payload?.thinkingDelta || "",
            payload?.timestamp,
          );
          break;

        case "tool_call":
          console.log("[SSE] tool_call event received:", payload);
          addToolCall({
            toolCallId: payload.toolCallId || payload.id || "",
            kind: payload.kind || payload.toolName || "",
            title: payload.title || `正在执行 ${payload.toolName || "工具"}`,
            input:
              payload.input ||
              (payload.args ? JSON.stringify(payload.args, null, 2) : "-"),
            status: payload.status || "running",
            detail: payload.detail || "进行中...",
            timestamp: payload.timestamp ?? Date.now(),
          });
          break;

        case "tool_call_update": {
          const id = payload.toolCallId || payload.id || "";
          console.log("[SSE] tool_call_update received:", payload);
          updateToolCall(id, {
            status: payload.status,
            detail: payload.detail,
            result: payload.content,
            ...(typeof payload.title === "string"
              ? { title: payload.title }
              : {}),
          });
          break;
        }

        case "assistant_break":
          breakAssistantSegment();
          break;

        case "context_snapshot":
          addContextSnapshot(payload);
          break;

        case "context_used":
          addContextUsed(payload);
          break;

        case "error":
          appendStreamChunk(`\n\n**错误**: ${payload?.error || "未知错误"}`);
          break;

        case "streamEnd":
          endStreaming();
          break;

        case "permission_request":
          addPermissionRequest({
            toolUseId: payload.toolUseId || "",
            toolName: (payload.toolName as string) || "未知工具",
            args: (payload.args as Record<string, unknown>) || {},
            timestamp: payload.timestamp ?? Date.now(),
          });
          break;

        default:
          break;
      }
    },
    [
      startStreaming,
      endStreaming,
      appendStreamChunk,
      appendThinkingChunk,
      addToolCall,
      updateToolCall,
      addContextSnapshot,
      addContextUsed,
      breakAssistantSegment,
      addPermissionRequest,
    ],
  );

  const sendMessage = useCallback(
    async (message: string) => {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseBlocks(buffer, handleEvent);
      }

      if (buffer.trim()) {
        parseSseBlocks(`${buffer}\n\n`, handleEvent);
      }
    },
    [handleEvent],
  );

  return { sendMessage, handleEvent };
}
