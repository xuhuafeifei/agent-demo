import { create } from 'zustand';
import type {
  Message,
  ToolCall,
  ContextEvent,
  SSEEventType,
} from '@/types';

interface WrappedMessage {
  type: 'message' | 'tool_call';
  data: Message | ToolCall;
  timestamp: number;
}

interface ChatStore {
  // State
  messages: Message[];
  toolCalls: ToolCall[];
  contextEvents: ContextEvent[];
  isStreaming: boolean;
  isThinking: boolean;

  // Actions
  addUserMessage: (text: string, timestamp?: number) => void;
  startStreaming: (timestamp?: number) => void;
  appendStreamChunk: (chunk: string, timestamp?: number) => void;
  appendThinkingChunk: (chunk: string, baseTimestamp?: number) => void;
  endStreaming: () => void;
  breakAssistantSegment: () => void;
  breakThinkingSegment: () => void;
  addToolCall: (toolCall: Omit<ToolCall, 'id'>) => void;
  updateToolCall: (toolCallId: string, update: Partial<ToolCall>) => void;
  addContextSnapshot: (payload?: {
    reason?: string;
    contextText?: string;
    timestamp?: number;
  }) => void;
  addContextUsed: (payload?: {
    contextWindow?: number;
    model?: string;
    timestamp?: number;
  }) => void;
  getAllMessages: () => WrappedMessage[];
  clearMessages: () => void;
}

const uid = (): string =>
  `${Date.now()}_${Math.random().toString(16).slice(2)}`;

/**
 * 创建 Store - VSCode 方式：使用闭包变量追踪索引 + event 类型判断
 */
export const useChatStore = create<ChatStore>((set, get) => {
  // 追踪当前流式消息的索引（类似 VSCode 的 useRef）
  let streamingMessageIndex: number | null = null;
  // 追踪当前 thinking 消息的索引（类似 VSCode 的 thinkingMessageIndexRef）
  let thinkingMessageIndex: number | null = null;
  // 追踪上一个 event 类型，用于判断是否创建新消息
  let lastEventType: SSEEventType | 'user_message' | null = null;

  return {
    messages: [],
    toolCalls: [],
    contextEvents: [],
    isStreaming: false,
    isThinking: false,

    /**
     * 添加用户消息
     */
    addUserMessage: (text: string, timestamp?: number) => {
      const ts = timestamp ?? Date.now();
      set((state) => ({
        messages: [
          ...state.messages,
          {
            id: uid(),
            role: 'user',
            content: text,
            timestamp: ts,
          },
        ],
      }));

      // 用户消息也更新 event 类型
      lastEventType = 'user_message';
    },

    /**
     * 开始流式响应
     */
    startStreaming: (timestamp?: number) => {
      const ts = timestamp ?? Date.now();

      set((state) => {
        const assistantIndex = state.messages.length;
        streamingMessageIndex = assistantIndex;

        // 重置 event 类型追踪
        lastEventType = null;
        thinkingMessageIndex = null;

        return {
          isStreaming: true,
          isThinking: false,
          contextEvents: [],
          messages: [
            ...state.messages,
            {
              id: uid(),
              role: 'assistant',
              content: '',
              timestamp: ts,
            },
          ],
        };
      });
    },

    /**
     * 追加流式内容到 assistant 消息 - 根据上一个 event 类型判断
     */
    appendStreamChunk: (chunk: string, timestamp?: number) => {
      const { isStreaming } = get();

      if (!isStreaming) return;

      set((state) => {
        let idx = streamingMessageIndex;
        const next = [...state.messages];

        // 关键逻辑：根据上一个 event 类型判断
        if (
          lastEventType === 'agent_message_chunk' &&
          idx !== null &&
          idx >= 0 &&
          idx < next.length
        ) {
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
            role: 'assistant',
            content: chunk,
            timestamp: timestamp ?? Date.now(),
          });
        }

        // 更新上一个 event 类型
        lastEventType = 'agent_message_chunk';

        return { messages: next, isThinking: false };
      });
    },

    /**
     * 追加思考内容 - 根据上一个 event 类型判断是否创建新消息
     */
    appendThinkingChunk: (chunk: string, baseTimestamp?: number) => {
      const { isStreaming } = get();

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
        if (
          lastEventType === 'agent_thought_chunk' &&
          thinkingMessageIndex !== null
        ) {
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
            role: 'thinking',
            content: chunk,
            timestamp: assistantTs - 1,
          });
        }

        // 更新上一个 event 类型
        lastEventType = 'agent_thought_chunk';

        return { messages: next, isThinking: true };
      });
    },

    /**
     * 结束流式
     */
    endStreaming: () => {
      streamingMessageIndex = null;
      thinkingMessageIndex = null;
      lastEventType = null; // 重置 event 类型
      set({ isStreaming: false, isThinking: false });
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
    addToolCall: (toolCall: Omit<ToolCall, 'id'>) => {
      set((state) => ({
        toolCalls: [
          ...state.toolCalls,
          {
            ...toolCall,
            id: uid(),
          },
        ],
        isThinking: false,
      }));

      // ToolCall 添加后，断开 assistant 流
      get().breakAssistantSegment();

      // 更新上一个 event 类型
      lastEventType = 'tool_call';
    },

    /**
     * 更新 ToolCall
     */
    updateToolCall: (toolCallId: string, update: Partial<ToolCall>) => {
      set((state) => ({
        toolCalls: state.toolCalls.map((tool) =>
          tool.toolCallId === toolCallId ? { ...tool, ...update } : tool
        ),
        isThinking: false,
      }));

      // 更新上一个 event 类型
      lastEventType = 'tool_call_update';
    },

    addContextSnapshot: (payload?: {
      reason?: string;
      contextText?: string;
      timestamp?: number;
    }) => {
      set((state) => ({
        contextEvents: [
          ...state.contextEvents,
          {
            id: uid(),
            kind: 'snapshot' as const,
            reason: payload?.reason || '',
            contextText: payload?.contextText || '',
            timestamp: payload?.timestamp ?? Date.now(),
          },
        ].slice(-20),
      }));
    },

    addContextUsed: (payload?: {
      contextWindow?: number;
      model?: string;
      timestamp?: number;
    }) => {
      set((state) => ({
        contextEvents: [
          ...state.contextEvents,
          {
            id: uid(),
            kind: 'used' as const,
            contextWindow: payload?.contextWindow,
            model: payload?.model || '',
            timestamp: payload?.timestamp ?? Date.now(),
          },
        ].slice(-20),
      }));
    },

    /**
     * 获取所有消息（包括 ToolCall）并按时间戳排序 - VSCode 方式
     */
    getAllMessages: (): WrappedMessage[] => {
      const { messages, toolCalls } = get();

      // 普通消息
      const regularMessages: WrappedMessage[] = messages.map((msg) => ({
        type: 'message',
        data: msg,
        timestamp: msg.timestamp,
      }));

      // ToolCall 消息
      const toolCallMessages: WrappedMessage[] = toolCalls.map((tool) => ({
        type: 'tool_call',
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
      set({
        messages: [],
        toolCalls: [],
        contextEvents: [],
        isThinking: false,
      });
      streamingMessageIndex = null;
      thinkingMessageIndex = null;
      lastEventType = null;
    },
  };
});
