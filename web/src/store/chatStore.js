import { create } from "zustand";

const uid = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

/**
 * @typedef {Object} TextMessage
 * @property {string} id
 * @property {'user' | 'assistant' | 'thinking'} role
 * @property {string} content
 * @property {number} timestamp
 */

/**
 * @typedef {Object} ToolCallData
 * @property {string} id
 * @property {string} toolCallId
 * @property {string} [kind]
 * @property {string} [title]
 * @property {string} [content]
 * @property {'pending' | 'running' | 'completed' | 'error'} status
 * @property {string} [detail]
 * @property {number} timestamp
 */

/**
 * 创建 Store - VSCode 方式：使用闭包变量追踪索引
 */
export const useChatStore = create((set, get) => {
  // 追踪当前流式消息的索引（类似 VSCode 的 useRef）
  let streamingMessageIndex = null;
  // 追踪当前 thinking 消息的索引（类似 VSCode 的 thinkingMessageIndexRef）
  let thinkingMessageIndex = null;

  return {
    messages: [],
    toolCalls: [],
    isStreaming: false,

    /**
     * 添加用户消息
     */
    addUserMessage: (text) => {
      set((state) => ({
        messages: [
          ...state.messages,
          {
            id: uid(),
            role: "user",
            content: text,
            timestamp: Date.now(),
          },
        ],
      }));
    },

    /**
     * 开始流式响应 - VSCode 方式
     */
    startStreaming: (timestamp) => {
      const ts = timestamp ?? Date.now();

      set((state) => {
        const assistantIndex = state.messages.length;
        streamingMessageIndex = assistantIndex;

        return {
          isStreaming: true,
          messages: [
            ...state.messages,
            {
              id: uid(),
              role: "assistant",
              content: "",
              timestamp: ts,
            },
          ],
        };
      });
    },

    /**
     * 追加流式内容到 assistant 消息 - VSCode 方式
     */
    appendStreamChunk: (chunk, timestamp) => {
      const { isStreaming } = get();

      if (!isStreaming) return;

      set((state) => {
        let idx = streamingMessageIndex;
        const next = [...state.messages];

        // 如果没有活跃的占位消息，创建新的
        if (idx === null || idx < 0 || idx >= next.length) {
          idx = next.length;
          streamingMessageIndex = idx;
          next.push({
            id: uid(),
            role: "assistant",
            content: "",
            timestamp: timestamp ?? Date.now(),
          });
        }

        // 追加 chunk
        const target = next[idx];
        next[idx] = {
          ...target,
          content: (target.content || "") + chunk,
        };

        return { messages: next };
      });
    },

    /**
     * 追加思考内容 - VSCode 方式（独立索引追踪）
     */
    appendThinkingChunk: (chunk) => {
      const { isStreaming, messages } = get();

      if (!isStreaming) return;

      set((state) => {
        let idx = thinkingMessageIndex;
        const next = [...state.messages];

        // 如果没有活跃的 thinking 消息，创建新的
        if (idx === null || idx < 0 || idx >= next.length) {
          idx = next.length;
          thinkingMessageIndex = idx;

          // 获取 assistant 消息的时间戳
          const assistantIdx = streamingMessageIndex;
          const assistantTs =
            assistantIdx !== null &&
            assistantIdx >= 0 &&
            assistantIdx < next.length
              ? next[assistantIdx].timestamp
              : Date.now();

          // Thinking 时间戳比 assistant 早 1ms，确保排序在前面
          next.push({
            id: uid(),
            role: "thinking",
            content: "",
            timestamp: assistantTs - 1,
          });
        }

        // 追加 chunk
        const target = next[idx];
        next[idx] = {
          ...target,
          content: (target.content || "") + chunk,
        };

        return { messages: next };
      });
    },

    /**
     * 结束流式
     */
    endStreaming: () => {
      streamingMessageIndex = null;
      thinkingMessageIndex = null;
      set({ isStreaming: false });
    },

    /**
     * 断开 assistant 流 - VSCode 显式断开机制
     */
    breakAssistantSegment: () => {
      streamingMessageIndex = null;
    },

    /**
     * 断开 thinking 流
     */
    breakThinkingSegment: () => {
      thinkingMessageIndex = null;
    },

    /**
     * 添加 ToolCall - 自动断开 assistant 流
     */
    addToolCall: (toolCall) => {
      set((state) => ({
        toolCalls: [
          ...state.toolCalls,
          {
            ...toolCall,
            id: uid(),
          },
        ],
      }));

      // ToolCall 添加后，断开 assistant 流
      get().breakAssistantSegment();
    },

    /**
     * 更新 ToolCall
     */
    updateToolCall: (toolCallId, update) => {
      set((state) => ({
        toolCalls: state.toolCalls.map((tool) =>
          tool.toolCallId === toolCallId ? { ...tool, ...update } : tool
        ),
      }));
    },

    /**
     * 获取所有消息（包括 ToolCall）并按时间戳排序 - VSCode 方式
     */
    getAllMessages: () => {
      const { messages, toolCalls } = get();

      // 普通消息
      const regularMessages = messages.map((msg) => ({
        type: "message",
        data: msg,
        timestamp: msg.timestamp,
      }));

      // ToolCall 消息
      const toolCallMessages = toolCalls.map((tool) => ({
        type: "tool_call",
        data: tool,
        timestamp: tool.timestamp,
      }));

      // 合并并按时间戳排序
      return [...regularMessages, ...toolCallMessages].sort(
        (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
      );
    },

    /**
     * 清空消息
     */
    clearMessages: () => {
      set({ messages: [], toolCalls: [] });
      streamingMessageIndex = null;
      thinkingMessageIndex = null;
    },
  };
});
