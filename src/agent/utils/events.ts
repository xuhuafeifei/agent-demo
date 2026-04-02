export type RuntimeStreamEvent =
  | { type: "message_start"; message: unknown }
  | { type: "message_update"; message: unknown; delta?: string; text?: string }
  | { type: "message_end"; message: unknown; text?: string }
  | { type: "thinking_update"; thinkingDelta?: string; thinking?: string }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
      alias?: string; // 工具中文名别名
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
      alias?: string; // 工具中文名别名
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
      alias?: string; // 工具中文名别名
    }
  | { type: "agent_end" }
  | { type: "done" }
  | { type: "error"; error: string }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | {
      type: "auto_retry_end";
      success: boolean;
      attempt: number;
      finalError?: string;
    }
  | {
      type: "compaction_start";
    }
  | {
      type: "compaction_end";
      tokensBefore?: number;
      error?: string;
    }
  | {
      type: "context_snapshot";
      seq: number;
      reason: "before_prompt";
      contextText: string;
    }
  | {
      type: "context_used";
      totalTokens: number;
      threshold: number;
      contextWindow: number;
    };
