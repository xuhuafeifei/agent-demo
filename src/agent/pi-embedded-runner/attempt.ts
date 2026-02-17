import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { RuntimeStreamEvent } from "../utils/events.js";

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

/**
 * 运行嵌入式 Pi Agent
 * @param params - 参数
 * @param params.session - Agent Session 实例
 * @param params.message - 消息
 * @param params.onEvent - 事件回调
 * @returns
 */
export async function runEmbeddedPiAgent(params: {
  session: AgentSession;
  message: string;
  onEvent: (event: RuntimeStreamEvent) => void;
}): Promise<void> {
  const { session, message, onEvent } = params;

  const unsubscribe = session.subscribe((event) => {
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

        const assistantEvent =
          event.assistantMessageEvent as AssistantMessageEvent | undefined;
        if (!assistantEvent) break;
        const textDelta =
          assistantEvent.type === "text_delta" &&
          typeof assistantEvent.delta === "string"
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
    await session.prompt(message);
  } finally {
    unsubscribe();
  }
}
