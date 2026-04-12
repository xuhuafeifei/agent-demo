import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { errResult, okResult, type ToolDetails } from "../tool-result.js";
import {
  sendIMDirectMessage,
  type IMSendChannel,
} from "../../../middleware/im/im-send.js";
import { getQQBotByTenantId } from "../../../middleware/qq/qq-account.js";
import { getWeixinBotByTenantId } from "../../../middleware/weixin/weixin-account.js";

const imSendParameters = Type.Object({
  channel: Type.Union([Type.Literal("qq"), Type.Literal("weixin")], {
    description: "IM channel to send message through: qq or weixin.",
  }),
  content: Type.String({
    minLength: 1,
    description: "Text content to send to phone IM user.",
  }),
  tenantId: Type.String({
    minLength: 1,
    description:
      "Tenant ID that identifies which bot account to use. Read from your system prompt ## Channel section. If not found, use 'default'.",
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
 * 工厂闭包持有 tenantId，作为发送目标的默认路由依据。
 *
 * @param tenantId 当前 agent 所属租户 ID（工具参数 tenantId 可覆盖此值）
 */
export function createIMSendTool(tenantId: string): ToolDefinition<
  typeof imSendParameters,
  ToolDetails<IMSendOutput>
> {
  return {
    name: "sendIMMessage",
    label: "IM Send Message",
    description:
      "Send message to QQ/Weixin user. tenantId routes to the correct bot account.",
    parameters: imSendParameters,
    execute: async (_toolCallId, params: IMSendInput) => {
      const content = params.content.trim();
      const channel = params.channel;
      // 工具参数 tenantId 由大模型传入；若大模型漏填，回落到工厂闭包中的当前租户
      const targetTenantId = params.tenantId?.trim() || tenantId;

      if (!content) {
        return errResult("content 不能为空", {
          code: "INVALID_ARGUMENT",
          message: "content 不能为空",
        });
      }
      if (!targetTenantId) {
        return errResult("tenantId 不能为空，请从 system prompt ## Channel 中获取", {
          code: "INVALID_ARGUMENT",
          message: "tenantId required",
        });
      }

      // 按 tenantId 查找目标用户 ID：QQ 读 targetOpenId，微信读 peerUserId
      const toUserId =
        channel === "qq"
          ? (getQQBotByTenantId(targetTenantId)?.targetOpenId?.trim() ?? "")
          : (getWeixinBotByTenantId(targetTenantId)?.peerUserId?.trim() ?? "");

      const sent = await sendIMDirectMessage(channel, content, targetTenantId);
      if (!sent) {
        return errResult(`${channel} 消息发送失败（tenantId=${targetTenantId}）`, {
          code: "INTERNAL_ERROR",
          message: `send ${channel} failed for tenantId=${targetTenantId}`,
        });
      }
      return okResult(`已向 ${toUserId || targetTenantId} 发送 ${channel} 消息`, {
        channel,
        toUserId,
        sent: true,
      });
    },
  };
}
