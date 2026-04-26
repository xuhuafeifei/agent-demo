import type { AgentLane } from "../../hook/events.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { selectModelForRuntime } from "../model-selection.js";
import { getRecentLaneDialogueForRouter } from "../runtime/run.js";
import { readLastRouteMode } from "./route-decision-log.js";
import { invokeLaneRouterModel } from "./routing-llm.js";

const dispatchRouteAgentLogger = getSubsystemConsoleLogger(
  "dispatch-route-agent",
);

export type RoutingDecisionSource =
  | "router"
  | "fallback_prev"
  | "fallback_heavy"
  | "non_main_module";

export type RoutingDecision = {
  lane: AgentLane;
  /** 与结构化 JSON 中的 reasoning 字段一致（模型对 lane 的简要说明） */
  reasoning: string;
  emotions: string[];
  emotionRate: number;
  decisionSource: RoutingDecisionSource;
};

/**
 * 路由决策：优先 LLM；失败则上一轮 mode；再失败固定 heavy。
 * 非 main 模块直接 heavy（避免无用户消息场景浪费路由调用）。
 */
export async function resolveLaneWithRouting(params: {
  tenantId: string;
  module: string;
  userInput: string;
}): Promise<RoutingDecision> {
  if (params.module !== "main") {
    return {
      lane: "heavy",
      reasoning: "",
      emotions: [],
      emotionRate: 0,
      decisionSource: "non_main_module",
    };
  }

  try {
    const selected = await selectModelForRuntime();
    if (!selected.model) throw new Error("no model");
    const recentLaneDialogue = getRecentLaneDialogueForRouter(params.tenantId);
    dispatchRouteAgentLogger.info("selected model: %s", selected.modelRef.model);
    const { parsed, rawText } = await invokeLaneRouterModel(
      selected.model,
      {
        currentUserInput: params.userInput,
        // 当前轮尚未写入 lane jsonl，用发起路由请求时的本地时间（与历史段的 jsonl timestamp 语义区分）
        currentAtMs: Date.now(),
        recentLaneDialogue,
      },
      {
        onStreamDelta: (delta) => {
          dispatchRouteAgentLogger.debug("router output chunk: %s", delta);
        },
      },
    );
    if (parsed.reasoning) {
      dispatchRouteAgentLogger.info("router reasoning: %s", parsed.reasoning);
    } else {
      dispatchRouteAgentLogger.info(
        "router reasoning: (empty — 检查模型是否按提示输出 reasoning 字段)",
      );
    }
    dispatchRouteAgentLogger.debug("router raw response: %s", rawText);
    return {
      lane: parsed.lane,
      reasoning: parsed.reasoning,
      emotions: parsed.emotions,
      emotionRate: parsed.emotionRate,
      decisionSource: "router",
    };
  } catch {
    const prev = await readLastRouteMode(params.tenantId, params.module);
    if (prev) {
      return {
        lane: prev,
        reasoning: "",
        emotions: [],
        emotionRate: 0,
        decisionSource: "fallback_prev",
      };
    }
    return {
      lane: "heavy",
      reasoning: "",
      emotions: [],
      emotionRate: 0,
      decisionSource: "fallback_heavy",
    };
  }
}
