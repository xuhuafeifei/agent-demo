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
import { imSendChannelParamProperties } from "../utils/channel-tool-params.schema.js";

const imSendParameters = Type.Object({
  ...imSendChannelParamProperties,
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
 * 工厂闭包持有运行时 tenant/channel；currentChannel/currentTenantId 与运行时一致性在 tool-bundle 装配时统一校验。
 *
 * @param tenantId 当前运行时 tenantId（sendToTenantId 省略时默认）
 * @param channel 当前运行时 channel（sendToChannel 省略时默认；为 web 时须显式指定 qq/weixin）
 */
export function createIMSendTool(
  tenantId: string,
  channel: AgentChannel,
): ToolDefinition<typeof imSendParameters, ToolDetails<IMSendOutput>> {
  return {
    name: "sendIMMessage",
    label: "IM Send Message",
    description:
      "Send text to the user's QQ or Weixin (phone IM). currentChannel and currentTenantId must match system prompt ## Channel (enforced when registering tools). sendToChannel and sendToTenantId are optional; when omitted, the server uses the runtime channel and runtime tenantId. If the runtime channel is web, sendToChannel must be qq or weixin (explicit).",
    parameters: imSendParameters,
    execute: async (_toolCallId, params: IMSendInput) => {
      const content = params.content.trim();
      const runtimeTenantId = tenantId.trim();
      const runtimeChannel = channel;

      if (!content) {
        return errResult("content 不能为空", {
          code: "INVALID_ARGUMENT",
          message: "content 不能为空",
        });
      }

      const sendToChannelResolved = params.sendToChannel ?? runtimeChannel;
      if (sendToChannelResolved !== "qq" && sendToChannelResolved !== "weixin") {
        return errResult(
          "sendToChannel 省略时默认使用运行时 channel；当前为 web，请显式指定 sendToChannel 为 qq 或 weixin",
          {
            code: "INVALID_ARGUMENT",
            message:
              "sendToChannel required (qq|weixin) when runtime channel is web",
          },
        );
      }
      const sendToChannel = sendToChannelResolved;

      const sendToTenantId =
        params.sendToTenantId?.trim() || runtimeTenantId;

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
