import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { AgentChannel } from "../../channel-policy.js";
import { errResult, type ToolDetails } from "../tool-result.js";
/** createReminderTask：与 sendToChannel/sendToTenantId 省略时的默认语义一致 */
export const CHANNEL_RUNTIME_MISMATCH_HINT_REMINDER =
  "请检查：1) currentChannel/currentTenantId 必须与 system prompt「## Channel」一致；2) 未指定 sendToChannel/sendToTenantId 时，运行时分别默认 currentChannel、currentTenantId。";

/** sendIMMessage：sendToChannel / sendToTenantId 均可省略，分别默认运行时 channel / tenantId */
export const CHANNEL_RUNTIME_MISMATCH_HINT_IM_SEND =
  "请检查：1) currentChannel/currentTenantId 必须与 system prompt「## Channel」一致；2) 未指定 sendToChannel/sendToTenantId 时服务端分别使用运行时 channel、tenantId。";

/**
 * 校验模型传入的 currentChannel / currentTenantId 是否与进程运行时一致。
 * 一致返回 null；不一致返回可直接 `return` 给前端的 errResult。
 *
 * @typeParam TSuccess — 与外层工具 `okResult` 的 details.data 类型一致即可（错误分支仅占位）。
 */
export function assertRuntimeChannelTenantMatch<TSuccess>(params: {
  declaredChannel: AgentChannel;
  declaredTenantId: string;
  runtimeChannel: AgentChannel;
  runtimeTenantId: string;
  mismatchHint: string;
}): AgentToolResult<ToolDetails<TSuccess>> | null {
  const {
    declaredChannel,
    declaredTenantId,
    runtimeChannel,
    runtimeTenantId,
    mismatchHint,
  } = params;

  if (declaredChannel !== runtimeChannel) {
    return errResult<TSuccess>(
      `currentChannel 不匹配：expected=${runtimeChannel}, got=${declaredChannel}。${mismatchHint}`,
      {
        code: "INVALID_ARGUMENT",
        message:
          "currentChannel mismatch; re-check system prompt Channel and user intent before retry",
      },
    );
  }
  if (declaredTenantId !== runtimeTenantId) {
    return errResult<TSuccess>(
      `currentTenantId 不匹配：expected=${runtimeTenantId}, got=${declaredTenantId}。${mismatchHint}`,
      {
        code: "INVALID_ARGUMENT",
        message:
          "currentTenantId mismatch; re-check system prompt Channel and user intent before retry",
      },
    );
  }
  return null;
}
