import type { AgentMessage } from "@mariozechner/pi-agent-core";

export type SessionMessage = AgentMessage;

export type SessionIndexEntry = {
  sessionId: string;
  updatedAt: number;
  sessionFile: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  modelProvider: string;
  model: string;
  contextTokens: number;
};

export type SessionIndex = Record<string, SessionIndexEntry>;
