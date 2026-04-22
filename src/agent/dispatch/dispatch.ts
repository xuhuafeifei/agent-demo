import type { AgentRunResult } from "../runtime/run.js";
import { tryHandleAgentCommand } from "./dispatch.command.js";
import { runDispatchedAgentConversation } from "./dispatch.agent.js";
import type { DispatchAgentParams } from "./dispatch.types.js";

/**
 * 渠道统一入口：管理指令短路 → 路由 + 单飞执行。
 */
export async function dispatchAgentRequest(
  params: DispatchAgentParams,
): Promise<AgentRunResult> {
  const agentId = `agent:${params.module}:${params.tenantId}`;
  const handled = tryHandleAgentCommand(params.message, agentId);
  if (handled) return handled;
  return runDispatchedAgentConversation(params);
}

export type { DispatchAgentParams } from "./dispatch.types.js";
