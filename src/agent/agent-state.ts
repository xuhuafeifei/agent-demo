import type { AgentChannel } from "./channel-policy.js";
import type { RuntimeStreamEvent } from "./utils/events.js";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../logger/logger.js";
import { getEventBus, TOPPIC_HEART_BEAT } from "../event-bus/index.js";

const stateLogger = getSubsystemConsoleLogger("agent-state");
/**
 * 心跳超时判定阈值：
 * - model: 模型推理阶段通常应持续产生活动事件，超时较短用于快速发现“无响应”。
 * - tool: 工具调用可能是外部 I/O（网络/命令执行），允许更长静默窗口，避免误杀长任务。
 */
const MODEL_IDLE_ABORT_MS = 30_000;
const TOOL_IDLE_ABORT_MS = 5 * 60_000; // 5 minutes
/** 每个 agent 独立监控器的检查频率（越短越敏感，越长越省资源） */
const AGENT_HEALTH_CHECK_INTERVAL_MS = 10_000; // 10 seconds
/**
 * 兜底清理阈值（由全局 heartbeat 触发）：
 * 当某条运行记录在状态表中滞留过久，且未走正常 release 流程时，直接回收。
 * 该机制仅作为防泄漏兜底，不替代主监控。
 */
const HEARTBEAT_RELEASE_FALLBACK_MS = 30 * 60_000; // 30 minutes

export type AgentPhase = "init" | "model" | "tool";

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
  /** 运行阶段：模型生成 / 工具执行 */
  phase: AgentPhase;
  /** 最近一次活性心跳时间（ms） */
  lastHeartbeatAt: number;
  /** 当前重试 attempt（若未知为 0） */
  attempt: number;
  /** 最大重试次数（若未知为 0） */
  maxAttempts: number;
  /** 当前正在执行的工具名（phase=tool 时） */
  activeToolName?: string;
  /** 运行中的会话对象（用于超时监控触发 session.abort） */
  session?: AgentSession;
  /** 是否已触发过自动中断，避免重复 abort */
  abortTriggered: boolean;
  /** 每个 agent 独立的高频监控定时器 */
  monitorTimer?: NodeJS.Timeout;
};

/**
 * 全局运行中的 agent 状态表，key 为 agentId（格式 agent:{module}:{tenantId}）。
 * 不同 agentId 可以并发执行，互不干扰；
 * 同一 agentId 同时只允许一条记录（单飞锁）。
 */
const runningAgents = new Map<string, AgentState>();
const eventBus = getEventBus();
let heartbeatScannerBound = false;

function scanAndReleaseZombieAgents(): void {
  const now = Date.now();
  for (const [agentId, state] of runningAgents.entries()) {
    // 这里只按“总运行时长”做保守回收，不在 heartbeat 事件里做细粒度 phase 判挂，
    // 避免一分钟一次的节拍对实时中断产生误判。
    const runningMs = now - state.runningStartedAt;
    if (runningMs <= HEARTBEAT_RELEASE_FALLBACK_MS) continue;
    stateLogger.error(
      `[agent-state] heartbeat fallback release agentId=${agentId} runningMs=${runningMs}`,
    );
    releaseAgent(agentId);
  }
}

// watch-dog心跳监听，扫描僵尸agent
function ensureHeartbeatScannerBound(): void {
  if (heartbeatScannerBound) return;
  heartbeatScannerBound = true;
  eventBus.on(TOPPIC_HEART_BEAT, () => {
    // 全局心跳（分钟级）只做兜底清理，不承担主监控职责。
    // 主监控由每个 AgentState 自己的 monitorTimer 负责（秒级）。
    scanAndReleaseZombieAgents();
  });
}

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
 * 按 agentId 获取运行状态。
 */
export function getAgentStateById(agentId: string): AgentState | null {
  return runningAgents.get(agentId) ?? null;
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
  // 首次进入时绑定全局 heartbeat 监听（幂等）。
  ensureHeartbeatScannerBound();
  if (runningAgents.has(agentId)) return false;
  const now = Date.now();
  const state: AgentState = {
    agentId,
    runningStartedAt: now,
    channel,
    tenantId,
    phase: "init",
    lastHeartbeatAt: now,
    attempt: 0,
    maxAttempts: 0,
    abortTriggered: false,
  };
  // 主监控：每个 agent 一个 timer，按 phase 判定空闲时长并触发 abort。
  // 这里不直接删除状态，只发出中断；状态清理由 runWithSingleFlight finally 统一 release。
  state.monitorTimer = setInterval(() => {
    const current = runningAgents.get(agentId);
    if (!current || current.abortTriggered) return;
    // session 未绑定时（初始化窗口）不做判挂，避免启动过程误触发中断。
    if (!current.session) return;
    const idleMs = Date.now() - current.lastHeartbeatAt;
    // tool 阶段允许更长静默，model 阶段更严格。
    const maxIdleMs =
      current.phase === "tool" ? TOOL_IDLE_ABORT_MS : MODEL_IDLE_ABORT_MS;
    if (idleMs <= maxIdleMs) return;
    const reason =
      current.phase === "tool"
        ? `agent idle too long in tool phase (${idleMs}ms, tool=${current.activeToolName ?? "unknown"})`
        : `agent idle too long in model phase (${idleMs}ms, attempt=${current.attempt}/${current.maxAttempts || "unknown"})`;
    stateLogger.error(`[agent-state] auto abort: ${reason}`);
    abortAgentRun(agentId, reason);
  }, AGENT_HEALTH_CHECK_INTERVAL_MS);
  runningAgents.set(agentId, state);
  return true;
}

/**
 * 释放 agent 执行锁。
 * @param agentId 格式 agent:{module}:{tenantId}
 */
export function releaseAgent(agentId: string): void {
  const state = runningAgents.get(agentId);
  if (state?.monitorTimer) {
    // release 是 monitorTimer 的唯一回收入口，必须先 clear 再删状态。
    clearInterval(state.monitorTimer);
    state.monitorTimer = undefined;
  }
  runningAgents.delete(agentId);
}

// event 更新 heartbeat
export function updateAgentHeartbeatFromEvent(
  agentId: string,
  event: RuntimeStreamEvent,
): void {
  const state = runningAgents.get(agentId);
  if (!state) return;
  // 任何事件先刷新活性时间戳。
  state.lastHeartbeatAt = Date.now();
  // 统一把运行时事件映射成 phase/attempt 心跳，避免在调用方散落同样逻辑。
  // 约定：
  // - tool start/end 显式切 phase
  // - retry start 同步 attempt 信息
  // - 其余事件默认视为 model 活性
  switch (event.type) {
    case "tool_execution_start":
      state.phase = "tool";
      state.activeToolName = event.toolName;
      return;
    case "tool_execution_end":
      state.phase = "model";
      state.activeToolName = undefined;
      return;
    case "auto_retry_start":
      state.phase = "model";
      state.activeToolName = undefined;
      state.attempt = event.attempt;
      state.maxAttempts = event.maxAttempts;
      return;
    default:
      state.phase = "model";
      state.activeToolName = undefined;
      return;
  }
}

export function bindAgentSession(agentId: string, session: AgentSession): void {
  const state = runningAgents.get(agentId);
  if (!state) return;
  // 绑定后监控器才能通过 session.abort 真正中断执行。
  state.session = session;
}

// 终止agent-runner
export function abortAgentRun(agentId: string, reason: string): void {
  const state = runningAgents.get(agentId);
  if (!state) return;
  // 标记已中断，防止同一条运行在后续扫描里重复 abort。
  state.abortTriggered = true;
  state.lastHeartbeatAt = Date.now();
  const session = state.session;
  if (session) {
    stateLogger.info(`[agent-state] abort agentId=${agentId} reason=${reason}`);
    session.abort();
    return;
  }
  stateLogger.error(
    `[agent-state] session.abort unavailable agentId=${agentId} reason=${reason}`,
  );
}
