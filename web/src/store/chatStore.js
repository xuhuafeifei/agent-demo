import { create } from "zustand";

const uid = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

export const useChatStore = create((set, get) => ({
  messages: [],
  toolCalls: [],
  isStreaming: false,
  assistantMessageId: null,
  thinkingMessageId: null,
  // 记录上一个 assistant 消息的时间戳，用于在 toolcall 后继续输出
  lastAssistantTimestamp: null,

  addUserMessage: (text) => {
    set((state) => ({
      messages: [
        ...state.messages,
        { id: uid(), role: "user", content: text, timestamp: Date.now() },
      ],
      lastAssistantTimestamp: null, // 用户消息重置
    }));
  },

  startStream: () => {
    set({
      isStreaming: true,
      assistantMessageId: null,
      thinkingMessageId: null,
      lastAssistantTimestamp: null,
      toolCalls: [],
    });
  },

  endStream: () => {
    set({ 
      isStreaming: false, 
      assistantMessageId: null, 
      thinkingMessageId: null,
      lastAssistantTimestamp: null,
    });
  },

  appendAssistantChunk: (chunk, options) => {
    const { assistantMessageId, lastAssistantTimestamp } = get();
    if (!chunk) return;

    // 如果指定了 timestamp（toolcall 后继续输出），使用指定的时间戳
    const timestamp = options?.timestamp ?? Date.now();

    if (!assistantMessageId || assistantMessageId === null) {
      const id = uid();
      set((state) => ({
        assistantMessageId: id,
        lastAssistantTimestamp: timestamp,
        messages: [
          ...state.messages,
          { id, role: "assistant", content: chunk, timestamp },
        ],
      }));
      return;
    }

    // 如果当前 assistant 消息的时间戳和指定的不同，创建新的 assistant 消息
    if (options?.timestamp && lastAssistantTimestamp && Math.abs(timestamp - lastAssistantTimestamp) > 100) {
      const id = uid();
      set((state) => ({
        assistantMessageId: id,
        lastAssistantTimestamp: timestamp,
        messages: [
          ...state.messages,
          { id, role: "assistant", content: chunk, timestamp },
        ],
      }));
      return;
    }

    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === assistantMessageId
          ? { ...message, content: `${message.content}${chunk}` }
          : message,
      ),
    }));
  },

  appendThinkingChunk: (chunk) => {
    const { thinkingMessageId, assistantMessageId, messages } = get();
    if (!chunk) return;

    // 获取当前 assistant 消息的时间戳
    const assistantMsg = messages.find(m => m.id === assistantMessageId);
    const assistantTs = assistantMsg?.timestamp ?? Date.now();
    // Thinking 时间戳比 assistant 早 1ms，确保排序在前面
    const thinkingTimestamp = assistantTs - 1;

    if (!thinkingMessageId || thinkingMessageId === null) {
      const id = uid();
      set((state) => ({
        thinkingMessageId: id,
        messages: [
          ...state.messages,
          { id, role: "thinking", content: chunk, timestamp: thinkingTimestamp },
        ],
      }));
      return;
    }

    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === thinkingMessageId
          ? { ...message, content: `${message.content}${chunk}` }
          : message,
      ),
    }));
  },

  addOrUpdateToolCall: (payload) => {
    const id = payload.id || payload.toolCallId;
    if (!id) return;

    // 获取当前时间戳用于 toolcall 排序
    const timestamp = payload.timestamp ?? Date.now();

    set((state) => {
      const idx = state.toolCalls.findIndex((item) => item.id === id);
      if (idx === -1) {
        return {
          toolCalls: [
            ...state.toolCalls,
            {
              id,
              title: payload.title || `正在执行 ${payload.toolName || "工具"}`,
              content:
                payload.content ||
                (payload.args ? JSON.stringify(payload.args) : payload.toolName || "-"),
              status: payload.status || "running",
              detail: payload.detail || "进行中...",
              timestamp,
            },
          ],
        };
      }

      const next = [...state.toolCalls];
      next[idx] = {
        ...next[idx],
        ...payload,
        id,
        status: payload.status || next[idx].status,
        detail: payload.detail || next[idx].detail,
        timestamp: payload.timestamp ?? next[idx].timestamp,
      };
      return { toolCalls: next };
    });
  },

  appendError: (errorText) => {
    if (!errorText) return;
    const { assistantMessageId } = get();
    if (!assistantMessageId) {
      const id = uid();
      set((state) => ({
        assistantMessageId: id,
        messages: [
          ...state.messages,
          { id, role: "assistant", content: `错误：${errorText}`, timestamp: Date.now() },
        ],
      }));
      return;
    }

    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === assistantMessageId
          ? { ...message, content: `${message.content}\n\n错误：${errorText}` }
          : message,
      ),
    }));
  },

  /**
   * 获取所有消息（包括 toolCalls）并按时间戳排序
   */
  getAllMessages: () => {
    const { messages, toolCalls } = get();
    
    // 将 toolCalls 转换为消息格式
    const toolCallMessages = toolCalls.map((tool) => ({
      id: `tool_${tool.id}`,
      role: "tool_call",
      toolCall: tool,
      timestamp: tool.timestamp ?? Date.now(),
    }));

    // 合并并按时间戳排序
    return [...messages, ...toolCallMessages].sort(
      (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
    );
  },
}));
