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
import type { ThinkingLevel, AgentMessage } from "@mariozechner/pi-agent-core";
import type { RuntimeStreamEvent } from "../utils/events.js";
import path from "node:path";
import type { RuntimeModel } from "../../types.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { createAgentToolBundle } from "../tool/index.js";
import { ToolRegister } from "../tool/tool-register.js";

const attemptLogger = getSubsystemConsoleLogger("attempt");

// 工具名称中文别名映射
const TOOL_NAME_ALIASES: Record<string, string> = {
  "bash_execute": "执行命令",
  "file_read": "读取文件",
  "file_write": "写入文件",
  "file_edit": "编辑文件",
  "web_search": "网络搜索",
  "web_fetch": "获取网页",
  "memory_search": "搜索记忆",
  "memory_append": "添加记忆",
  "code_interpreter": "代码执行",
  "directory_list": "列出目录",
  "directory_create": "创建目录",
  "file_delete": "删除文件",
  "file_move": "移动文件",
  "file_copy": "复制文件",
};

// 获取工具中文名称
function getToolDisplayName(toolName: string): string {
  return TOOL_NAME_ALIASES[toolName] || toolName;
}

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
 * 截断工具结果和 thinking 的内容，避免占用过多 token
 * 使用 toolRegister 中定义的 getFilterContextToolNames() 来决定截断哪些工具
 * @param messages - 原始消息列表
 * @param maxContentLength - 每个工具结果/思考保留的最大字符数（默认 500 字符）
 * @returns 截断后的消息列表
 */
function truncateToolResults(
  messages: AgentMessage[],
  maxContentLength = 500,
): AgentMessage[] {
  const filterToolNames =
    ToolRegister.getInstance().getFilterContextToolNames();

  if (filterToolNames.length === 0) {
    return messages;
  }

  return messages.map((msg) => {
    const message = msg as {
      role?: string;
      toolName?: string;
      content?: string | unknown[];
    };

    // 1. 处理 toolResult 类型的消息
    if (message.role === "toolResult" && message.toolName) {
      if (filterToolNames.includes(message.toolName)) {
        const truncatedMsg = { ...message };

        if (typeof message.content === "string") {
          if (message.content.length > maxContentLength) {
            truncatedMsg.content =
              message.content.slice(0, maxContentLength) +
              "\n\n... [Content truncated]";
          }
        } else if (Array.isArray(message.content)) {
          truncatedMsg.content = message.content.map((block) => {
            const b = block as { type?: string; text?: string };
            if (
              b.type === "text" &&
              b.text &&
              b.text.length > maxContentLength
            ) {
              return {
                ...b,
                text:
                  b.text.slice(0, maxContentLength) +
                  "\n\n... [Content truncated]",
              };
            }
            return block;
          });
        }

        return truncatedMsg as AgentMessage;
      }
    }

    // 2. 处理 assistant 消息中的 thinking 和 toolCall 块
    if (message.role === "assistant" && Array.isArray(message.content)) {
      const truncatedMsg = { ...message };
      truncatedMsg.content = message.content.map((block) => {
        const b = block as {
          type?: string;
          thinking?: string;
          text?: string;
          name?: string;
          arguments?: Record<string, unknown>;
        };

        // 截断 thinking 块
        if (
          b.type === "thinking" &&
          b.thinking &&
          b.thinking.length > maxContentLength
        ) {
          return {
            ...b,
            thinking:
              b.thinking.slice(0, maxContentLength) +
              "\n\n... [Thinking truncated]",
          };
        }

        // 截断 toolCall 的 arguments
        if (b.type === "toolCall" && b.arguments) {
          const truncatedArgs: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(b.arguments)) {
            if (typeof value === "string" && value.length > maxContentLength) {
              // 字符串值超过阈值，截断
              truncatedArgs[key] =
                value.slice(0, maxContentLength) + "\n... [Argument truncated]";
            } else {
              // 其他类型（数字、布尔值、对象等）保持不变
              truncatedArgs[key] = value;
            }
          }
          return {
            ...b,
            arguments: truncatedArgs,
          };
        }

        return block;
      });

      return truncatedMsg as AgentMessage;
    }

    return msg;
  });
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
    thinkingLevel,
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
    thinkingLevel: thinkingLevel,
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
  needsCompression?: boolean; // 是否需要压缩会话的标记
}): Promise<{ finalText: string }> {
  const { session, message, onEvent, needsCompression = false } = params;
  let latestAssistantText = "";

  // 打印当前 Session 文件路径
  attemptLogger.info(
    `当前 Session 文件：${session.sessionManager.getSessionFile()}`,
  );

  // 如果需要压缩会话，使用内置的 compact 方法
  if (needsCompression) {
    attemptLogger.warn("会话需要压缩，正在执行内置压缩功能");
    onEvent({ type: "compaction_start" });
    try {
      // 压缩前截断不重要的工具结果（如 memorySearch、persistMemory 等）
      // 避免这些工具的大量返回内容占用压缩后的 token 配额
      // 每个工具结果保留前 500 字符，这样既保留上下文又节省 token
      const messages = session.agent.state.messages;
      const truncatedMessages = truncateToolResults(messages, 500);

      if (truncatedMessages.length !== messages.length) {
        attemptLogger.info(`工具结果截断：${messages.length} 条消息`);
        session.agent.replaceMessages(truncatedMessages);
      }

      // 需要注意的是，本次压缩不会影响本次对话的上下文，只会影响未来的对话。
      const compactionResult = await session.compact(
        "会话过长，需要压缩以适应上下文窗口限制",
      );
      attemptLogger.info(
        `压缩完成：原 Token 数 ${compactionResult.tokensBefore}，保留内容从 ${compactionResult.firstKeptEntryId} 开始`,
      );
      onEvent({ type: "compaction_end", tokensBefore: compactionResult.tokensBefore });
    } catch (error) {
      // 忽略 "Already compacted" 错误，这表示会话已经压缩过
      if (
        error instanceof Error &&
        error.message.includes("Already compacted")
      ) {
        attemptLogger.warn("会话已经压缩过，跳过压缩");
        onEvent({ type: "compaction_end" });
      } else {
        attemptLogger.error(
          `压缩会话失败：${error instanceof Error ? error.message : error}`,
        );
        onEvent({ type: "compaction_end", error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
  }

  const wrappedOnEvent = (event: RuntimeStreamEvent) => {
    attemptLogger.debug(`event.type=${event.type}`);
    onEvent(event);
  };

  type AssistantSessionEvent = AgentSessionEvent & {
    message: { role?: string; content?: unknown[] };
  };

  const isAssistantMessageEvent = (
    e: AgentSessionEvent,
  ): e is AssistantSessionEvent =>
    "message" in e &&
    !!(e as { message?: { role?: string } }).message &&
    (e as { message?: { role?: string } }).message?.role === "assistant";

  const handleTextDelta = (
    assistantEvent: AssistantMessageEvent,
    agentEvent: AssistantSessionEvent,
  ) => {
    const textDelta =
      assistantEvent.type === "text_delta" &&
      typeof assistantEvent.delta === "string"
        ? assistantEvent.delta
        : undefined;

    const fullText = extractAssistantText(assistantEvent.partial?.content);
    if (fullText) latestAssistantText = fullText;

    wrappedOnEvent({
      type: "message_update",
      message: agentEvent.message,
      delta: textDelta,
      text: fullText || undefined,
    });
  };

  const handleThinkingDelta = (assistantEvent: AssistantMessageEvent) => {
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
  };

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    // 统一的错误检测：检查所有带 message 字段的事件
    const messageWithStopReason =
      "message" in event
        ? (
            event as {
              message?: {
                stopReason?: string;
                errorMessage?: string;
                provider?: string;
                model?: string;
                api?: string;
              };
            }
          ).message
        : undefined;
    if (
      messageWithStopReason?.stopReason === "error" &&
      messageWithStopReason.errorMessage
    ) {
      // 打印错误日志
      attemptLogger.error(
        `模型调用失败：provider=${messageWithStopReason.provider ?? "unknown"}, ` +
          `model=${messageWithStopReason.model ?? "unknown"}, ` +
          `api=${messageWithStopReason.api ?? "unknown"}, ` +
          `error=${messageWithStopReason.errorMessage}`,
      );
      // 发送 error 事件给前端
      wrappedOnEvent({
        type: "error",
        error: messageWithStopReason.errorMessage,
      });
    }

    switch (event.type) {
      case "agent_end":
        wrappedOnEvent({ type: "agent_end" });
        break;
      case "message_start":
        // 只把 assistant 消息推给上层，避免 user 事件干扰前端渲染。
        if (!isAssistantMessageEvent(event)) break;
        wrappedOnEvent({ type: "message_start", message: event.message });
        break;
      case "message_update": {
        if (!isAssistantMessageEvent(event)) break;

        const assistantEvent = event.assistantMessageEvent as
          | AssistantMessageEvent
          | undefined;
        if (!assistantEvent) break;

        if (assistantEvent.type === "text_delta") {
          handleTextDelta(assistantEvent, event);
        } else if (assistantEvent.type === "thinking_delta") {
          // thinking_delta：只发增量 delta，前端累积显示
          handleThinkingDelta(assistantEvent);
        }

        break;
      }
      case "message_end": {
        if (!isAssistantMessageEvent(event)) break;
        const messageData = event.message as { content?: unknown[] };
        const finalText = extractAssistantText(messageData.content);
        if (finalText) latestAssistantText = finalText;
        wrappedOnEvent({
          type: "message_end",
          message: event.message,
          text: finalText,
        });
        break;
      }
      case "tool_execution_start":
        wrappedOnEvent({
          type: "tool_execution_start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          alias: getToolDisplayName(event.toolName),
        });
        break;
      case "tool_execution_update":
        wrappedOnEvent({
          type: "tool_execution_update",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          partialResult: event.partialResult,
          alias: getToolDisplayName(event.toolName),
        });
        break;
      case "tool_execution_end":
        wrappedOnEvent({
          type: "tool_execution_end",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
          alias: getToolDisplayName(event.toolName),
        });
        break;
      case "auto_retry_start": {
        // 打印自动重试日志
        const retryData = event as {
          attempt?: number;
          maxAttempts?: number;
          delayMs?: number;
          errorMessage?: string;
        };
        attemptLogger.error(
          `自动重试开始：attempt=${retryData.attempt ?? "unknown"}, ` +
            `maxAttempts=${retryData.maxAttempts ?? "unknown"}, ` +
            `delayMs=${retryData.delayMs ?? "unknown"}, ` +
            `error=${retryData.errorMessage ?? "unknown"}`,
        );
        // 转发事件给前端
        wrappedOnEvent({
          type: "auto_retry_start",
          attempt: retryData.attempt ?? 0,
          maxAttempts: retryData.maxAttempts ?? 3,
          delayMs: retryData.delayMs ?? 0,
          errorMessage: retryData.errorMessage ?? "",
        });
        break;
      }
      default:
        break;
    }
  });

  try {
    await session.prompt(message);
    return { finalText: latestAssistantText };
  } finally {
    unsubscribe();
  }
}
