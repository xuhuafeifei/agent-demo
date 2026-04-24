import { randomUUID } from "node:crypto";
import { BaseHook } from "./base-hook.js";
import type { AgentHookEvent, LaneHookEvent } from "./events.js";
import { LANE_HOOK_KIND } from "./events.js";
import { appendLane } from "../lane/lane-store.js";
import { getEventBus } from "../event-bus/index.js";

export class LaneHook extends BaseHook<AgentHookEvent> {
  readonly name = "LaneHook";

  async onEvent(event: AgentHookEvent): Promise<void> {
    if (event.kind !== LANE_HOOK_KIND) return;
    const e = event as LaneHookEvent;
    const laneEvent = {
      id: randomUUID(),
      timestamp: Date.now(),
      module: e.module,
      laneKey: e.laneKey,
      laneMode: e.lane,
      role: e.role,
      content: e.content,
      agentId: e.agentId,
      sessionKey: e.sessionKey,
    };
    const { laneFile } = appendLane(e.tenantId, laneEvent);

    getEventBus().emit("lane:appended", {
      tenantId: e.tenantId,
      laneFile,
      event: laneEvent,
    });
  }
}
