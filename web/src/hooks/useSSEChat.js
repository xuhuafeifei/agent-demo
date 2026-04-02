import { useCallback } from "react";
import { useChatStore } from "../store/chatStore";

/**
 * 解析 SSE 数据块
 * 支持标准的 SSE 格式：
 * event: agent_message_chunk
 * data: {"content": "..."}
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
 * SSE Chat Hook
 * 完全按照 VSCode 的方式处理流式事件
 */
export function useSSEChat() {
  const {
    startStreaming,
    endStreaming,
    appendStreamChunk,
    appendThinkingChunk,
    addToolCall,
    updateToolCall,
    breakAssistantSegment,
    breakThinkingSegment,
  } = useChatStore();

  /**
   * 处理 SSE 事件
   * 完全对应 VSCode 的事件处理逻辑
   */
  const handleEvent = useCallback(
    (type, payload) => {
      switch (type || payload?.type) {
        case "streamStart": {
          // 开始流式响应
          startStreaming(payload?.timestamp);
          return;
        }

        case "agent_message_chunk": {
          // AI 回复内容分块
          appendStreamChunk(
            payload?.content || payload?.delta || "",
            payload?.timestamp
          );
          return;
        }

        case "agent_thought_chunk": {
          // 思考内容分块
          appendThinkingChunk(payload?.content || payload?.thinkingDelta || "");
          return;
        }

        case "tool_call": {
          // 新工具调用 - 自动断开 assistant 流
          addToolCall({
            toolCallId: payload.toolCallId || payload.id,
            kind: payload.kind || payload.toolName,
            title: payload.title || `正在执行 ${payload.toolName || "工具"}`,
            content: payload.content || (payload.args ? JSON.stringify(payload.args) : "-"),
            status: payload.status || "running",
            detail: payload.detail || "进行中...",
            timestamp: payload.timestamp ?? Date.now(),
          });
          return;
        }

        case "tool_call_update": {
          // 工具调用状态更新
          updateToolCall(payload.toolCallId || payload.id, {
            status: payload.status,
            detail: payload.detail,
            content: payload.content,
          });
          return;
        }

        case "assistant_break": {
          // 显式断开 assistant 流（ToolCall 后继续输出时使用）
          breakAssistantSegment();
          return;
        }

        case "thinking_break": {
          // 显式断开 thinking 流
          breakThinkingSegment();
          return;
        }

        case "error": {
          // 错误处理
          appendStreamChunk(`\n\n**错误**: ${payload?.error || "未知错误"}`);
          return;
        }

        case "streamEnd": {
          // 流式结束
          endStreaming();
          return;
        }

        default:
          // 未知事件类型，忽略
          return;
      }
    },
    [
      startStreaming,
      endStreaming,
      appendStreamChunk,
      appendThinkingChunk,
      addToolCall,
      updateToolCall,
      breakAssistantSegment,
      breakThinkingSegment,
    ]
  );

  /**
   * 发送消息并处理流式响应
   */
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

      // 处理剩余数据
      if (buffer.trim()) {
        parseSseBlocks(`${buffer}\n\n`, handleEvent);
      }
    },
    [handleEvent]
  );

  return { sendMessage, handleEvent };
}
