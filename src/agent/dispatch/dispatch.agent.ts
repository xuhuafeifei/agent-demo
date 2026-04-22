import { runWithSingleFlight } from "../runtime/run.js";
import type { AgentRunResult } from "../runtime/run.js";
import type { DispatchAgentParams } from "./dispatch.types.js";
import { resolveLaneWithRouting } from "./dispatch.route.agent.js";
import { appendRouteDecisionLog } from "./route-decision-log.js";

/**
 * 普通对话：路由 lane → 单飞执行 → 追加路由训练日志。
 */
export async function runDispatchedAgentConversation(
  params: DispatchAgentParams,
): Promise<AgentRunResult> {
  const started = Date.now();
  const routing = await resolveLaneWithRouting({
    tenantId: params.tenantId,
    module: params.module,
    userInput: params.message,
  });

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
  });

  const consumeTime = Date.now() - started;
  const llmTotalResponse =
    result.status === "success" ? (result.finalText ?? "") : "";

  await appendRouteDecisionLog({
    tenantId: params.tenantId,
    module: params.module,
    record: {
      userInput: params.message,
      llmTotalResponse,
      emotions: routing.emotions,
      emotionRate: routing.emotionRate,
      consumeTime,
      mode: lane,
      decisionSource: routing.decisionSource,
      routerRawResponse: routing.rawResponse,
    },
  });

  return result;
}
