let runningAgentId: string | null = null;
let runningStartedAt: number | null = null;

export function getAgentRuntimeState(): {
  isRunning: boolean;
  runningAgentId: string | null;
  startedAt: number | null;
} {
  return {
    isRunning: runningAgentId !== null,
    runningAgentId,
    startedAt: runningStartedAt,
  };
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
