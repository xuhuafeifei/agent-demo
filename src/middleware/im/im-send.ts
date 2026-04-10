import { sendQQDirectMessage } from "../qq/qq-layer.js";
import { sendWeixinDirectMessage } from "../weixin/weixin-layer.js";

export type IMSendChannel = "qq" | "weixin";

export async function sendIMDirectMessage(
  channel: IMSendChannel,
  content: string,
): Promise<boolean> {
  if (channel === "qq") return sendQQDirectMessage(content);
  return sendWeixinDirectMessage(content);
}
