export type RuntimeStreamEvent =
  | { type: "message_start"; message: unknown }
  | { type: "message_update"; message: unknown; delta?: string; text?: string }
  | { type: "message_end"; message: unknown; text?: string }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | { type: "agent_end" }
  | { type: "done" }
  | { type: "error"; error: string };
