import type { AgentChannel } from "./channel-policy.js";

let runningAgentId: string | null = null;
let runningStartedAt: number | null = null;
let currentChannel: AgentChannel = "web";

export function getAgentRuntimeState(): {
  isRunning: boolean;
  runningAgentId: string | null;
  startedAt: number | null;
  channel: AgentChannel;
} {
  return {
    isRunning: runningAgentId !== null,
    runningAgentId,
    startedAt: runningStartedAt,
    channel: currentChannel,
  };
}

export function getRunningAgentId(): string | null {
  return runningAgentId;
}

export function setCurrentChannel(channel: AgentChannel): void {
  currentChannel = channel;
}

export function getCurrentChannel(): AgentChannel {
  return currentChannel;
}

export function tryAcquireAgent(agentId: string): boolean {
  if (runningAgentId !== null) return false;
  runningAgentId = agentId;
  runningStartedAt = Date.now();
  return true;
}

export function releaseAgent(agentId?: string): void {
  if (agentId && runningAgentId !== agentId) return;
  runningAgentId = null;
  runningStartedAt = null;
}
