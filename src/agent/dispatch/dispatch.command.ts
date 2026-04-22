import type { AgentRunResult } from "../runtime/run.js";
import { handleStopForAgent } from "./stop-command.js";

/**
 * 解析并处理管理类指令；非指令返回 null，由主流程继续。
 */
export function tryHandleAgentCommand(
  message: string,
  agentId: string,
): AgentRunResult | null {
  if (message.trim() === "-stop") {
    return handleStopForAgent(agentId);
  }
  // todo: 未来支持-stop输入参数
  return null;
}
