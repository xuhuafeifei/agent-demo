import {
  abortAgentRun,
  getAgentStateById,
} from "../agent-state.js";
import type { AgentRunResult } from "../runtime/run.js";

/**
 * 处理 `-stop`：中断当前 agentId 对应的运行（不占用单飞锁）。
 */
export function handleStopForAgent(agentId: string): AgentRunResult {
  const state = getAgentStateById(agentId);
  if (!state) {
    return {
      status: "success",
      finalText: "",
      message: "当前没有正在运行的任务",
      systemError: false,
    };
  }
  abortAgentRun(agentId, "stopped by -stop command");
  return {
    status: "success",
    finalText: "",
    message: "已发送停止指令",
    systemError: false,
  };
}
