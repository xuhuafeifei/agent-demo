import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { errResult, okResult, type ToolDetails } from "../tool-result.js";
import {
  sendIMDirectMessage,
  type IMSendChannel,
} from "../../../middleware/im/im-send.js";
import { getQQBotByTenantId } from "../../../middleware/qq/qq-account.js";
import { getWeixinBotByTenantId } from "../../../middleware/weixin/weixin-account.js";
import type { AgentChannel } from "../../channel-policy.js";

const imSendParameters = Type.Object({
  currentChannel: Type.Union(
    [Type.Literal("web"), Type.Literal("qq"), Type.Literal("weixin")],
    {
      description:
        "Current runtime channel from system prompt 'Channel' section. Must exactly match runtime current channel.",
    },
  ),
  currentTenantId: Type.String({
    minLength: 1,
    description:
      "Current runtime tenantId from system prompt 'Channel' section. Must exactly match runtime current tenantId.",
  }),
  sendToChannel: Type.Union([Type.Literal("qq"), Type.Literal("weixin")], {
    description:
      "Target IM channel to send to: qq/weixin. If user specifies target channel, use it; otherwise use currentChannel.",
  }),
  sendToTenantId: Type.String({
    minLength: 1,
    description:
      "Target tenantId to send to. If user specifies target tenantId, use it; otherwise use currentTenantId.",
  }),
  content: Type.String({
    minLength: 1,
    description: "Text content to send to phone IM user.",
  }),
});

type IMSendInput = Static<typeof imSendParameters>;

type IMSendOutput = {
  channel: IMSendChannel;
  toUserId: string;
  sent: boolean;
};

/**
 * 创建 IM 发送工具。
 * 工厂闭包持有运行时 current tenant/channel，用于参数断言校验。
 *
 * @param tenantId 当前运行时 tenantId（用于校验 currentTenantId）
 * @param channel 当前运行时 channel（用于校验 currentChannel）
 */
export function createIMSendTool(
  tenantId: string,
  channel: AgentChannel,
): ToolDefinition<typeof imSendParameters, ToolDetails<IMSendOutput>> {
  return {
    name: "sendIMMessage",
    label: "IM Send Message",
    description:
      "Send message to user IM device. tenantId routes to the correct bot account.",
    parameters: imSendParameters,
    execute: async (_toolCallId, params: IMSendInput) => {
      const content = params.content.trim();
      const currentTenantId = params.currentTenantId.trim();
      const sendToTenantId = params.sendToTenantId.trim();
      const sendToChannel = params.sendToChannel;
      const runtimeTenantId = tenantId.trim();
      const runtimeChannel = channel;

      if (!content) {
        return errResult("content 不能为空", {
          code: "INVALID_ARGUMENT",
          message: "content 不能为空",
        });
      }
      if (!currentTenantId || !sendToTenantId) {
        return errResult(
          "tenantId 不能为空，请从 system prompt ## Channel 中获取",
          {
            code: "INVALID_ARGUMENT",
            message: "tenantId required",
          },
        );
      }
      if (params.currentChannel !== runtimeChannel) {
        return errResult(
          `当前 channel 应为 ${runtimeChannel}，模型错误理解为 ${params.currentChannel}。请重新阅读 system prompt 的 ## Channel 与用户最新指令，重新判断 sendToChannel/sendToTenantId 后再重试。`,
          {
            code: "INVALID_ARGUMENT",
            message:
              "currentChannel mismatch; re-check system prompt Channel and user intent before retry",
          },
        );
      }
      if (currentTenantId !== runtimeTenantId) {
        return errResult(
          `当前 tenantId 应为 ${runtimeTenantId}，模型错误理解为 ${currentTenantId}。请重新阅读 system prompt 的 ## Channel 与用户最新指令，重新判断 sendToChannel/sendToTenantId 后再重试。`,
          {
            code: "INVALID_ARGUMENT",
            message:
              "currentTenantId mismatch; re-check system prompt Channel and user intent before retry",
          },
        );
      }

      // 按 tenantId 查找目标用户 ID：QQ 读 targetOpenId，微信读 peerUserId
      const toUserId =
        sendToChannel === "qq"
          ? (getQQBotByTenantId(sendToTenantId)?.targetOpenId?.trim() ?? "")
          : (getWeixinBotByTenantId(sendToTenantId)?.peerUserId?.trim() ?? "");

      const sent = await sendIMDirectMessage(sendToChannel, content, sendToTenantId);
      if (!sent) {
        return errResult(
          `${sendToChannel} 消息发送失败（tenantId=${sendToTenantId}）`,
          {
            code: "INTERNAL_ERROR",
            message: `send ${sendToChannel} failed for tenantId=${sendToTenantId}`,
          },
        );
      }
      return okResult(
        `已向 ${toUserId || sendToTenantId} 发送 ${sendToChannel} 消息`,
        {
          channel: sendToChannel,
          toUserId,
          sent: true,
        },
      );
    },
  };
}
