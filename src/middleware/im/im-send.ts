import { sendQQDirectMessage } from "../qq/qq-layer.js";
import { QQ_DEFAULT_IDENTIFY } from "../qq/qq-account.js";
import { sendWeixinDirectMessage } from "../weixin/weixin-layer.js";

export type IMSendChannel = "qq" | "weixin";

export async function sendIMDirectMessage(
  channel: IMSendChannel,
  content: string,
  qqIdentify: string = QQ_DEFAULT_IDENTIFY,
): Promise<boolean> {
  if (channel === "qq") return sendQQDirectMessage(content, qqIdentify);
  return sendWeixinDirectMessage(content);
}
