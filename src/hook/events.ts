import type { AgentChannel } from "../agent/channel-policy.js";
import type { RuntimeToolDefinition } from "../agent/tool/tool-catalog.js";

export type AgentLane = "light" | "heavy";

export const PROMPT_BUILD_KIND = "prompt.build" as const;

export const TOOL_HOOK_KIND = "tool.hook" as const;

export const LANE_HOOK_KIND = "lane.write" as const;

/**
 * Hook 事件公共字段；具体分支 `extends HookEvent` 并收窄 `kind`、补充独有字段。
 *
 * 说明：实际传入各 `onEvent` 时，类型应是下面的 `AgentHookEvent`（判别联合），
 * 这样 `if (event.kind === '…')` 才能缩窄到 `ToolHookEvent` / `PromptBuildEvent`。
 */
export interface HookEvent {
  kind: typeof PROMPT_BUILD_KIND | typeof TOOL_HOOK_KIND | typeof LANE_HOOK_KIND;
  lane: AgentLane;
  tenantId: string;
  channel: AgentChannel;
}

export interface ToolHookEvent extends HookEvent {
  kind: typeof TOOL_HOOK_KIND;
  cwd: string;
  agentId: string;
  /** Hook 写入：最终注入 Pi 的自定义工具 */
  tools: RuntimeToolDefinition[];
  /** 与 tools 对齐的说明文案，供 system prompt ## Toolings */
  toolings: string[];
}

export interface PromptBuildEvent extends HookEvent {
  kind: typeof PROMPT_BUILD_KIND;
  /** 主流程构建的 stem；各 Hook 自行 append */
  promptText: string;
  /** heavy 时 PromptHook 使用 */
  heavyPayload: {
    workspace: string;
    toolings: string[];
    skillsMeta: string;
  };
}

export interface LaneHookEvent extends HookEvent {
  kind: typeof LANE_HOOK_KIND;
  role: "user" | "assistant";
  content: string;
  agentId: string;
  sessionKey: string;
  laneKey: string;
  module: string;
}

/** 实际下发到 Hook 的联合类型（基形状见 `HookEvent`）。 */
export type AgentHookEvent = ToolHookEvent | PromptBuildEvent | LaneHookEvent;
