import type { AgentChannel } from "./channel-policy.js";

let runningAgentId: string | null = null;
let runningStartedAt: number | null = null;
let currentChannel: AgentChannel = "web";
/** 当前一次 agent 运行对应的 QQ/微信 bot identify（由入口透传） */
let currentIdentify: string | null = null;

export function getAgentRuntimeState(): {
  isRunning: boolean;
  runningAgentId: string | null;
  startedAt: number | null;
  channel: AgentChannel;
  identify: string | null;
} {
  return {
    isRunning: runningAgentId !== null,
    runningAgentId,
    startedAt: runningStartedAt,
    channel: currentChannel,
    identify: currentIdentify,
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

export function setCurrentIdentify(identify: string | null): void {
  const t = identify?.trim();
  currentIdentify = t || null;
}

export function getCurrentIdentify(): string | null {
  return currentIdentify;
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
