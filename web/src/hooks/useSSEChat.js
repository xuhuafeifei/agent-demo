import { useCallback } from "react";
import { useChatStore } from "../store/chatStore";

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

export function useSSEChat() {
  const {
    startStream,
    endStream,
    appendAssistantChunk,
    appendThinkingChunk,
    addOrUpdateToolCall,
    appendError,
  } = useChatStore();

  const handleEvent = useCallback(
    (type, payload) => {
      switch (type || payload?.type) {
        case "streamStart":
          startStream();
          return;
        case "agent_message_chunk":
          appendAssistantChunk(payload?.content || payload?.delta || "");
          return;
        case "agent_thought_chunk":
          appendThinkingChunk(payload?.content || payload?.thinkingDelta || "");
          return;
        case "tool_call":
        case "tool_call_update":
          addOrUpdateToolCall(payload || {});
          return;
        case "error":
          appendError(payload?.error || "未知错误");
          return;
        case "streamEnd":
          endStream();
          return;
        default:
          return;
      }
    },
    [
      addOrUpdateToolCall,
      appendAssistantChunk,
      appendError,
      appendThinkingChunk,
      endStream,
      startStream,
    ],
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
    [handleEvent],
  );

  return { sendMessage, handleEvent };
}
