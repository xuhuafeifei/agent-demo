import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { errResult, okResult, type ToolDetails } from "../tool-result.js";
import {
  sendIMDirectMessage,
  type IMSendChannel,
} from "../../../middleware/im/im-send.js";
import { loadLastIMTarget } from "../../../middleware/im/im-target.js";

const imSendParameters = Type.Object({
  channel: Type.Union([Type.Literal("qq"), Type.Literal("weixin")], {
    description: "IM channel to send message through: qq or weixin.",
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

export function createIMSendTool(): ToolDefinition<
  typeof imSendParameters,
  ToolDetails<IMSendOutput>
> {
  return {
    name: "sendIMMessage",
    label: "IM Send Message",
    description:
      "Send message to recent QQ/Weixin user by channel. Target user ID is loaded internally.",
    parameters: imSendParameters,
    execute: async (_toolCallId, params: IMSendInput) => {
      const content = params.content.trim();
      const channel = params.channel;
      if (!content) {
        return errResult("content 不能为空", {
          code: "INVALID_ARGUMENT",
          message: "content 不能为空",
        });
      }
      const toUserId = loadLastIMTarget(channel);
      if (!toUserId) {
        return errResult(`未找到 ${channel} 最近用户，请先让用户给你发一条消息`, {
          code: "NOT_FOUND",
          message: `${channel} target user missing`,
        });
      }
      const sent = await sendIMDirectMessage(channel, content);
      if (!sent) {
        return errResult(`${channel} 消息发送失败`, {
          code: "INTERNAL_ERROR",
          message: `send ${channel} failed`,
        });
      }
      return okResult(`已向 ${toUserId} 发送 ${channel} 消息`, {
        channel,
        toUserId,
        sent: true,
      });
    },
  };
}
