import { useCallback } from "react";
import { useChatStore } from "../store/chatStore";

/**
 * 解析 SSE 数据块
 */
function parseSseBlocks(rawBuffer, onEvent) {
  const blocks = rawBuffer.split("\n\n");
  const rest = blocks.pop() || "";

  blocks.forEach((block) => {
    if (!block.trim()) return;
    const lines = block.split("\n");
    let eventType = "";
    const dataLines = [];

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
  } = useChatStore();

  const handleEvent = useCallback(
    (type, payload) => {
      switch (type || payload?.type) {
        case "streamStart":
          startStreaming(payload?.timestamp);
          break;

        case "agent_message_chunk":
          appendStreamChunk(
            payload?.content || payload?.delta || "",
            payload?.timestamp
          );
          break;

        case "agent_thought_chunk":
          appendThinkingChunk(
            payload?.content || payload?.thinkingDelta || "",
            payload?.timestamp
          );
          break;

        case "tool_call":
          addToolCall({
            toolCallId: payload.toolCallId || payload.id,
            kind: payload.kind || payload.toolName,
            title: payload.title || `正在执行 ${payload.toolName || "工具"}`,
            content:
              payload.content ||
              (payload.args ? JSON.stringify(payload.args) : "-"),
            status: payload.status || "running",
            detail: payload.detail || "进行中...",
            timestamp: payload.timestamp ?? Date.now(),
          });
          break;

        case "tool_call_update":
          updateToolCall(payload.toolCallId || payload.id, {
            status: payload.status,
            detail: payload.detail,
            content: payload.content,
          });
          break;

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
    ]
  );

  const sendMessage = useCallback(
    async (message) => {
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
    [handleEvent]
  );

  return { sendMessage, handleEvent };
}
