import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { errResult, okResult, type ToolDetails } from "./types.js";
import { readFgbgUserConfig } from "../../config/index.js";

const qqSendParameters = Type.Object({
  content: Type.String({
    minLength: 1,
    description:
      "Text content to send to QQ. The target user is resolved automatically from config or recent session context.",
  }),
});

type QQSendInput = Static<typeof qqSendParameters>;

type QQSendOutput = {
  openid: string;
  sent: boolean;
};

export function createQQSendTool(): ToolDefinition<
  typeof qqSendParameters,
  ToolDetails<QQSendOutput>
>;
export function createQQSendTool(deps: {
  resolveLastSeenOpenid: () => string;
  sendQQDirectMessage: (openid: string, content: string) => Promise<boolean>;
}): ToolDefinition<typeof qqSendParameters, ToolDetails<QQSendOutput>>;
export function createQQSendTool(deps?: {
  resolveLastSeenOpenid: () => string;
  sendQQDirectMessage: (openid: string, content: string) => Promise<boolean>;
}): ToolDefinition<typeof qqSendParameters, ToolDetails<QQSendOutput>> {
  const resolveLastSeenOpenid = deps?.resolveLastSeenOpenid ?? (() => "");
  const sendQQDirectMessage = deps?.sendQQDirectMessage ?? (async () => false);

  return {
    name: "sendQQMessage",
    label: "Send QQ Message",
    description: "Send a direct QQ message to configured target user.",
    parameters: qqSendParameters,
    execute: async (_toolCallId, params: QQSendInput) => {
      const content = params.content.trim();
      if (!content) {
        return errResult("content 不能为空", {
          code: "INVALID_ARGUMENT",
          message: "content 不能为空",
        });
      }
      const cfgOpenid =
        readFgbgUserConfig().channels.qqbot.targetOpenid?.trim() || "";
      const openid = cfgOpenid || resolveLastSeenOpenid().trim();
      if (!openid) {
        return errResult(
          "未找到 QQ 目标用户，请先在 fgbg.json 配置 channels.qqbot.targetOpenid",
          {
            code: "NOT_FOUND",
            message: "qq target openid missing",
          },
        );
      }
      const sent = await sendQQDirectMessage(openid, content);
      if (!sent) {
        return errResult("QQ 消息发送失败", {
          code: "INTERNAL_ERROR",
          message: "sendQQDirectMessage failed",
        });
      }
      return okResult(`已向 ${openid} 发送 QQ 消息`, { openid, sent: true });
    },
  };
}
