import { create } from "zustand";

const uid = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

export const useChatStore = create((set, get) => ({
  messages: [],
  toolCalls: [],
  isStreaming: false,
  assistantMessageId: null,
  thinkingMessageId: null,

  addUserMessage: (text) => {
    set((state) => ({
      messages: [
        ...state.messages,
        { id: uid(), role: "user", content: text, timestamp: Date.now() },
      ],
    }));
  },

  startStream: () => {
    set({
      isStreaming: true,
      assistantMessageId: null,
      thinkingMessageId: null,
      toolCalls: [],
    });
  },

  endStream: () => {
    set({ isStreaming: false, assistantMessageId: null, thinkingMessageId: null });
  },

  appendAssistantChunk: (chunk) => {
    const { assistantMessageId } = get();
    if (!chunk) return;

    if (!assistantMessageId) {
      const id = uid();
      set((state) => ({
        assistantMessageId: id,
        messages: [
          ...state.messages,
          { id, role: "assistant", content: chunk, timestamp: Date.now() },
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
    const { thinkingMessageId } = get();
    if (!chunk) return;

    if (!thinkingMessageId) {
      const id = uid();
      set((state) => ({
        thinkingMessageId: id,
        messages: [
          ...state.messages,
          { id, role: "thinking", content: chunk, timestamp: Date.now() - 1 },
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
}));
