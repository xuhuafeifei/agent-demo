import type { AgentLane } from "../hook/events.js";

export interface LaneEvent {
  id: string;
  timestamp: number;
  module: string;
  laneKey: string;
  laneMode: AgentLane;
  role: "user" | "assistant";
  content: string;
  agentId: string;
  sessionKey: string;
}

export interface LaneIndexEntry {
  laneId: string;
  laneFile: string;
  updatedAt: number;
}

export type LaneIndex = Record<string, LaneIndexEntry>;
