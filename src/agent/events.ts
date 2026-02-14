export type RuntimeStreamEvent =
  | { type: "message_start"; message: unknown }
  | { type: "message_update"; message: unknown; delta?: string; text?: string }
  | { type: "message_end"; message: unknown; text?: string }
  | { type: "agent_end" }
  | { type: "done" }
  | { type: "error"; error: string };

