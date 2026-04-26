import {
  crossLaneBridgePromptBlock,
  joinPromptBlocks,
  memoryPersistencePromptBlock,
  memoryRecallPromptBlock,
  skillsPromptBlock,
  toolingsPromptBlock,
  workspacePromptBlock,
} from "../agent/system-prompt.js";
import { readLastRouteMode } from "../agent/dispatch/route-decision-log.js";
import { loadLane } from "../lane/lane-store.js";
import type { AgentLane } from "./events.js";
import { BaseHook } from "./base-hook.js";
import { PROMPT_BUILD_KIND, type AgentHookEvent } from "./events.js";

const BRIDGE_TURN_COUNT = 5;
const BRIDGE_LINE_MAX_CHARS = 220;

function normalizeBridgeText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > BRIDGE_LINE_MAX_CHARS
    ? `${normalized.slice(0, BRIDGE_LINE_MAX_CHARS)}...`
    : normalized;
}

function buildBridgeLines(
  tenantId: string,
  module: string,
  mode: AgentLane,
): Array<{ time: string; role: "user" | "assistant"; text: string }> {
  const laneKey = `lane:${module}:${tenantId}`;
  const events = loadLane(tenantId, laneKey)
    .filter((e) => e.role === "user" || e.role === "assistant")
    .filter((e) => e.laneMode === mode)
    .slice(-BRIDGE_TURN_COUNT);
  return events.map((e) => ({
    time: new Date(e.timestamp).toISOString(),
    role: e.role,
    text: normalizeBridgeText(e.content),
  }));
}

/**
 * heavy：在此 Hook 内用 system-prompt 的 block 组装追加；light 不追加。
 */
export class PromptHook extends BaseHook<AgentHookEvent> {
  readonly name = "prompt";

  priority(): number {
    return 50;
  }

  async onEvent(event: AgentHookEvent): Promise<void> {
    if (event.kind !== PROMPT_BUILD_KIND) return;
    const previousLane = await readLastRouteMode(event.tenantId, event.module);
    if (previousLane && previousLane !== event.lane) {
      const previousTurns = buildBridgeLines(
        event.tenantId,
        event.module,
        previousLane,
      );
      const bridgeBlock = crossLaneBridgePromptBlock({
        previousLane,
        currentLane: event.lane,
        previousTurns,
        turnCount: BRIDGE_TURN_COUNT,
      });
      event.promptText += `\n\n${bridgeBlock}`;
    }
    if (event.lane !== "heavy") return;
    const p = event.heavyPayload;
    const heavy = joinPromptBlocks(
      toolingsPromptBlock(p.toolings),
      skillsPromptBlock(p.skillsMeta),
      workspacePromptBlock(p.workspace),
      memoryRecallPromptBlock(),
      memoryPersistencePromptBlock(),
    );
    event.promptText += `\n\n${heavy}`;
  }
}
