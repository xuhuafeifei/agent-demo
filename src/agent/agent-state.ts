import type { AgentChannel } from "./channel-policy.js";

/**
 * 单个租户的 agent 运行时状态。
 * 同一租户同时只能有一个 agent 在执行（单飞锁）。
 */
export type AgentState = {
  /** 并发锁键，格式固定为 "agent:main:{tenantId}" */
  agentId: string;
  /** agent 开始执行的时间戳（ms） */
  runningStartedAt: number;
  /** 触发本次请求的渠道（web / qq / weixin） */
  channel: AgentChannel;
  /** 当前租户 ID，冗余存储方便快速访问 */
  tenantId: string;
};

/**
 * 全局运行中的 agent 状态表，key 为 agentId（格式 agent:{module}:{tenantId}）。
 * 不同 agentId 可以并发执行，互不干扰；
 * 同一 agentId 同时只允许一条记录（单飞锁）。
 */
const runningAgents = new Map<string, AgentState>();

/**
 * 获取指定租户当前的运行状态（按 tenantId 扫描，返回第一条匹配）。
 * 工具层只需 channel 信息，不需要精确匹配 module，故扫描即可。
 */
export function getAgentState(tenantId: string): AgentState | null {
  for (const state of runningAgents.values()) {
    if (state.tenantId === tenantId) return state;
  }
  return null;
}

/**
 * 获取所有正在运行的 agent 状态列表，供状态接口汇总展示。
 */
export function getAllRunningAgentStates(): AgentState[] {
  return Array.from(runningAgents.values());
}

/**
 * 尝试获取 agent 执行锁。锁 key 为 agentId，不同 module 的同租户 agent 可并发。
 * 同一 agentId 正在执行时返回 false（拒绝并发），成功则写入状态表。
 * @param agentId 格式 agent:{module}:{tenantId}
 */
export function tryAcquireAgent(
  agentId: string,
  tenantId: string,
  channel: AgentChannel,
): boolean {
  if (runningAgents.has(agentId)) return false;
  runningAgents.set(agentId, {
    agentId,
    runningStartedAt: Date.now(),
    channel,
    tenantId,
  });
  return true;
}

/**
 * 释放 agent 执行锁。
 * @param agentId 格式 agent:{module}:{tenantId}
 */
export function releaseAgent(agentId: string): void {
  runningAgents.delete(agentId);
}
