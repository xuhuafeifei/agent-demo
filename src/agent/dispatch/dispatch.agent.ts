import { runWithSingleFlight } from "../runtime/run.js";
import type { AgentRunResult } from "../runtime/run.js";
import type { DispatchAgentParams } from "./dispatch.types.js";
import { resolveLaneWithRouting } from "./dispatch.route.agent.js";
import { appendRouteDecisionLog, readLastRouteMode } from "./route-decision-log.js";

/**
 * 普通对话：路由 lane → 单飞执行 → 追加路由训练日志。
 */
export async function runDispatchedAgentConversation(
  params: DispatchAgentParams,
): Promise<AgentRunResult> {
  const started = Date.now();
  // 在 dispatch 开始时冻结“上一轮 lane”，后续统一透传，避免中途被当前轮写入影响判断。
  const previousLaneFromDispatch = await readLastRouteMode(
    params.tenantId,
    params.module,
  );
  const routing = await resolveLaneWithRouting({
    tenantId: params.tenantId,
    module: params.module,
    userInput: params.message,
    previousLaneFromDispatch,
  });
  // 记录决策 agent 的决策事件耗时
  const consumeTime = Date.now() - started;

  const lane = routing.lane;

  const result = await runWithSingleFlight({
    message: params.message,
    onEvent: params.onEvent,
    onAccepted: params.onAccepted,
    tenantId: params.tenantId,
    module: params.module,
    watchDogTaskId: params.watchDogTaskId,
    channel: params.channel,
    lane,
    previousLaneFromDispatch,
  });

  await appendRouteDecisionLog({
    tenantId: params.tenantId,
    module: params.module,
    record: {
      userInput: params.message,
      emotions: routing.emotions,
      emotionRate: routing.emotionRate,
      consumeTime,
      mode: lane,
      decisionSource: routing.decisionSource,
      routerReasoning: routing.reasoning,
    },
  });

  return result;
}
