import { create } from "zustand";

const uid = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

/**
 * 创建 Store - VSCode 方式：使用闭包变量追踪索引 + event 类型判断
 */
export const useChatStore = create((set, get) => {
  // 追踪当前流式消息的索引（类似 VSCode 的 useRef）
  let streamingMessageIndex = null;
  // 追踪当前 thinking 消息的索引（类似 VSCode 的 thinkingMessageIndexRef）
  let thinkingMessageIndex = null;
  // 追踪上一个 event 类型，用于判断是否创建新消息
  let lastEventType = null;

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
      
      // 用户消息也更新 event 类型
      lastEventType = 'user_message';
    },

    /**
     * 开始流式响应
     */
    startStreaming: (timestamp) => {
      const ts = timestamp ?? Date.now();

      set((state) => {
        const assistantIndex = state.messages.length;
        streamingMessageIndex = assistantIndex;

        // 重置 event 类型追踪
        lastEventType = null;
        thinkingMessageIndex = null;

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
     * 追加流式内容到 assistant 消息 - 根据上一个 event 类型判断
     */
    appendStreamChunk: (chunk, timestamp) => {
      const { isStreaming } = get();

      if (!isStreaming) return;

      set((state) => {
        let idx = streamingMessageIndex;
        const next = [...state.messages];

        // 关键逻辑：根据上一个 event 类型判断
        if (lastEventType === 'agent_message_chunk' && idx !== null && idx >= 0 && idx < next.length) {
          // 上一次也是 assistant，追加到当前消息
          const target = next[idx];
          next[idx] = {
            ...target,
            content: (target.content || '') + chunk,
          };
        } else {
          // 上一次不是 assistant（可能是 tool_call 或 thinking），创建新的 assistant 消息
          idx = next.length;
          streamingMessageIndex = idx;
          next.push({
            id: uid(),
            role: "assistant",
            content: chunk,
            timestamp: timestamp ?? Date.now(),
          });
        }

        // 更新上一个 event 类型
        lastEventType = 'agent_message_chunk';

        return { messages: next };
      });
    },

    /**
     * 追加思考内容 - 根据上一个 event 类型判断是否创建新消息
     */
    appendThinkingChunk: (chunk, baseTimestamp) => {
      const { isStreaming, messages } = get();

      if (!isStreaming) return;

      set((state) => {
        const next = [...state.messages];

        // 获取 assistant 消息的时间戳
        const assistantIdx = streamingMessageIndex;
        const assistantTs =
          assistantIdx !== null &&
          assistantIdx >= 0 &&
          assistantIdx < next.length
            ? next[assistantIdx].timestamp
            : (baseTimestamp ?? Date.now());

        // 关键逻辑：根据上一个 event 类型判断
        if (lastEventType === 'agent_thought_chunk' && thinkingMessageIndex !== null) {
          // 上一次也是 thinking，追加到当前消息
          const target = next[thinkingMessageIndex];
          next[thinkingMessageIndex] = {
            ...target,
            content: (target.content || '') + chunk,
          };
        } else {
          // 上一次不是 thinking（可能是 tool_call 或其他），创建新的 thinking 消息
          thinkingMessageIndex = next.length;
          next.push({
            id: uid(),
            role: "thinking",
            content: chunk,
            timestamp: assistantTs - 1,
          });
        }

        // 更新上一个 event 类型
        lastEventType = 'agent_thought_chunk';

        return { messages: next };
      });
    },

    /**
     * 结束流式
     */
    endStreaming: () => {
      streamingMessageIndex = null;
      thinkingMessageIndex = null;
      lastEventType = null;  // 重置 event 类型
      set({ isStreaming: false });
    },

    /**
     * 断开 assistant 流
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
      
      // 更新上一个 event 类型
      lastEventType = 'tool_call';
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
      
      // 更新上一个 event 类型
      lastEventType = 'tool_call_update';
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
      lastEventType = null;
    },
  };
});
