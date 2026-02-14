import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { RuntimeStreamEvent } from "../events";
import type { RuntimeModel } from "../types";
import type { SessionMessage } from "../session";

type AssistantMessageEvent = {
  type?: string;
  delta?: string;
  partial?: { content?: unknown[] };
};

function extractAssistantText(content: unknown[] | undefined): string {
  if (!content || !Array.isArray(content)) return "";

  // 仅拼接文本块，忽略 thinking/tool 等非文本内容。
  return (content as { type?: string; text?: string }[])
    .filter((item) => item.type === "text")
    .map((item) => item.text || "")
    .join("");
}

export async function runEmbeddedPiAgent(params: {
  agent: Agent;
  message: string;
  onEvent: (event: RuntimeStreamEvent) => void;
}): Promise<void> {
  const { agent, message, onEvent } = params;

  const unsubscribe = agent.subscribe((event) => {
    switch (event.type) {
      case "agent_end":
        onEvent({ type: "agent_end" });
        break;
      case "message_start":
        // 只把 assistant 消息推给上层，避免 user 事件干扰前端渲染。
        if (event.message?.role !== "assistant") break;
        onEvent({ type: "message_start", message: event.message });
        break;
      case "message_update": {
        // 只处理 assistant 的增量文本事件。
        if (event.message?.role !== "assistant") break;

        const assistantEvent = event.assistantMessageEvent as AssistantMessageEvent;
        const textDelta =
          assistantEvent.type === "text_delta" && typeof assistantEvent.delta === "string"
            ? assistantEvent.delta
            : undefined;
        const fullText = extractAssistantText(assistantEvent.partial?.content);

        onEvent({
          type: "message_update",
          message: event.message,
          delta: textDelta,
          text: fullText || undefined,
        });
        break;
      }
      case "message_end": {
        if (event.message?.role !== "assistant") break;
        const messageData = event.message as { content?: unknown[] };
        onEvent({
          type: "message_end",
          message: event.message,
          text: extractAssistantText(messageData.content),
        });
        break;
      }
      default:
        break;
    }
  });

  try {
    const userMessage = {
      role: "user" as const,
      content: [{ type: "text" as const, text: message }],
      timestamp: Date.now(),
    };

    // 先写入状态，再触发 prompt，保证上下文完整。
    agent.appendMessage(userMessage);
    await agent.prompt(message);
  } finally {
    unsubscribe();
  }
}

export function createAgentRuntime(params: {
  model: RuntimeModel;
  getApiKey: (provider: string) => string | undefined;
  messages?: SessionMessage[];
}): Agent {
  const { model, getApiKey, messages = [] } = params;

  // 每次请求创建轻量 Agent runtime，避免把 runtime 作为全局重对象长期持有。
  return new Agent({
    getApiKey,
    initialState: {
      model,
      systemPrompt: "你是一个友好的人,能快速回复别人信息",
      thinkingLevel: "off",
      tools: [],
      messages: messages as AgentMessage[],
      isStreaming: false,
      streamMessage: null,
      pendingToolCalls: new Set(),
    },
  });
}
