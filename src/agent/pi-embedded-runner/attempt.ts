import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type {
  AgentSession,
  AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { RuntimeStreamEvent } from "../utils/events.js";
import path from "node:path";
import type { RuntimeModel } from "../../types.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { createAgentToolBundle } from "../tool/index.js";

const attemptLogger = getSubsystemConsoleLogger("attempt");

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

/** 从 partial.content 中拼接所有 type===thinking 的 thinking 字段，用于 thinking_start/thinking_delta/thinking_end 时推给前端 */
function extractAssistantThinking(content: unknown[] | undefined): string {
  if (!content || !Array.isArray(content)) return "";
  return (content as { type?: string; thinking?: string }[])
    .filter((item) => item.type === "thinking")
    .map((item) => item.thinking || "")
    .join("");
}

export async function createRuntimeAgentSession(params: {
  model: RuntimeModel;
  sessionDir: string;
  sessionFile: string;
  cwd: string;
  agentDir: string;
  provider: string;
  apiKey?: string;
  thinkingLevel?: ThinkingLevel;
}): Promise<AgentSession> {
  const {
    model,
    sessionDir,
    sessionFile,
    cwd,
    agentDir,
    provider,
    apiKey,
    thinkingLevel = "off",
  } = params;

  const sessionManager = SessionManager.open(sessionFile, sessionDir);
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const authStorage = new AuthStorage(path.join(agentDir, "auth.json"));
  if (apiKey) {
    authStorage.setRuntimeApiKey(provider, apiKey);
  }

  const modelRegistry = new ModelRegistry(
    authStorage,
    path.join(agentDir, "models.json"),
  );
  modelRegistry.refresh();
  const toolBundle = createAgentToolBundle(cwd);

  const { session } = await createAgentSession({
    model,
    sessionManager,
    settingsManager,
    authStorage,
    modelRegistry,
    cwd,
    agentDir,
    thinkingLevel,
    tools: toolBundle.tools as NonNullable<
      Parameters<typeof createAgentSession>[0]
    >["tools"],
    customTools: toolBundle.customTools as unknown as NonNullable<
      Parameters<typeof createAgentSession>[0]
    >["customTools"],
  });

  return session;
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

  const eventTrace: { type: string; at: number }[] = [];
  const wrappedOnEvent = (event: RuntimeStreamEvent) => {
    // if (eventTrace.length > 0 && eventTrace[eventTrace.length - 1].type === event.type) {
    //   return;
    // }
    eventTrace.push({ type: event.type, at: Date.now() });
    attemptLogger.info(`event.type=${event.type}`);
    onEvent(event);
  };

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    switch (event.type) {
      case "agent_end":
        console.log("[attempt] agent_end:", JSON.stringify(event));
        wrappedOnEvent({ type: "agent_end" });
        break;
      case "message_start":
        // 只把 assistant 消息推给上层，避免 user 事件干扰前端渲染。
        if (event.message?.role !== "assistant") break;
        console.log("[attempt] message_start:", JSON.stringify(event));
        wrappedOnEvent({ type: "message_start", message: event.message });
        break;
      case "message_update": {
        // 只处理 assistant 的增量文本事件。
        if (event.message?.role !== "assistant") break;

        const assistantEvent = event.assistantMessageEvent as
          | AssistantMessageEvent
          | undefined;
        if (!assistantEvent) break;

        if (assistantEvent.type === "text_delta") {
          const textDelta =
            assistantEvent.type === "text_delta" &&
            typeof assistantEvent.delta === "string"
              ? assistantEvent.delta
              : undefined;

          const fullText = extractAssistantText(
            assistantEvent.partial?.content,
          );

          wrappedOnEvent({
            type: "message_update",
            message: event.message,
            delta: textDelta,
            text: fullText || undefined,
          });
        }

        // thinking_delta：只发增量 delta，前端累积显示
        if (assistantEvent.type === "thinking_delta") {
          const thinkingDelta =
            typeof (assistantEvent as { delta?: string }).delta === "string"
              ? (assistantEvent as { delta: string }).delta
              : undefined;
          if (thinkingDelta !== undefined) {
            wrappedOnEvent({
              type: "thinking_update",
              thinkingDelta,
            });
          }
        }

        break;
      }
      case "message_end": {
        if (event.message?.role !== "assistant") break;
        const messageData = event.message as { content?: unknown[] };
        wrappedOnEvent({
          type: "message_end",
          message: event.message,
          text: extractAssistantText(messageData.content),
        });
        break;
      }
      case "tool_execution_start":
        console.log("[attempt] tool_execution_start:", JSON.stringify(event));
        wrappedOnEvent({
          type: "tool_execution_start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
        break;
      case "tool_execution_update":
        console.log("[attempt] tool_execution_update:", JSON.stringify(event));
        wrappedOnEvent({
          type: "tool_execution_update",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          partialResult: event.partialResult,
        });
        break;
      case "tool_execution_end":
        wrappedOnEvent({
          type: "tool_execution_end",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
        });
        break;
      default:
        break;
    }
  });

  const startedAt = Date.now();
  try {
    await session.prompt(message);
  } finally {
    unsubscribe();
    // todo fgbg: 暂时不打印 llm 调用链路日志
    // const trace = {
    //   run: "runEmbeddedPiAgent",
    //   startedAt,
    //   endedAt: Date.now(),
    //   durationMs: Date.now() - startedAt,
    //   eventCount: eventTrace.length,
    //   eventTypes: eventTrace.map((e) => e.type),
    // };
    // attemptLogger.info("trace=%o", trace);
  }
}
