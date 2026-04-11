import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { errResult, okResult, type ToolDetails } from "../tool-result.js";
import {
  sendIMDirectMessage,
  type IMSendChannel,
} from "../../../middleware/im/im-send.js";
import { loadLastIMTarget } from "../../../middleware/im/im-target.js";
import { getCurrentIdentify } from "../../agent-state.js";
import {
  getQQBotByIdentify,
  QQ_DEFAULT_IDENTIFY,
} from "../../../middleware/qq/qq-account.js";

const imSendParameters = Type.Object({
  channel: Type.Union([Type.Literal("qq"), Type.Literal("weixin")], {
    description: "IM channel to send message through: qq or weixin.",
  }),
  content: Type.String({
    minLength: 1,
    description: "Text content to send to phone IM user.",
  }),
  identify: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "When channel=qq: bot identify; omit to use the current agent session identify (see system prompt ## Channel).",
    }),
  ),
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
      const qqIdentify =
        params.identify?.trim() ||
        getCurrentIdentify()?.trim() ||
        QQ_DEFAULT_IDENTIFY;

      const toUserId =
        channel === "qq"
          ? (getQQBotByIdentify(qqIdentify)?.targetOpenId?.trim() ?? "")
          : loadLastIMTarget("weixin");
      if (!toUserId) {
        return errResult(`未找到 ${channel} 最近用户，请先让用户给你发一条消息`, {
          code: "NOT_FOUND",
          message: `${channel} target user missing`,
        });
      }
      const sent =
        channel === "qq"
          ? await sendIMDirectMessage(channel, content, qqIdentify)
          : await sendIMDirectMessage(channel, content);
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
