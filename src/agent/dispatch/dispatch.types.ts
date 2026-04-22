import type { RuntimeStreamEvent } from "../utils/events.js";
import type { AgentChannel } from "../channel-policy.js";
import type { AgentLane } from "../../hook/events.js";

/** 渠道层调用 dispatch 的入参（与单飞执行一致） */
export type DispatchAgentParams = {
  message: string;
  onEvent?: (event: RuntimeStreamEvent) => void;
  onAccepted?: () => void | Promise<void>;
  tenantId: string;
  module: string;
  watchDogTaskId?: string;
  channel: AgentChannel;
  lane?: AgentLane;
};
