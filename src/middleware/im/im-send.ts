import { sendQQDirectMessage } from "../qq/qq-layer.js";
import { QQ_DEFAULT_IDENTIFY } from "../qq/qq-account.js";
import { sendWeixinDirectMessage } from "../weixin/weixin-layer.js";

export type IMSendChannel = "qq" | "weixin";

/**
 * channel 区分平台，identify 区分同平台账号。
 * 因此只需一个 identify 参数，配合 channel 即可定位到具体 bot。
 */
export async function sendIMDirectMessage(
  channel: IMSendChannel,
  content: string,
  identify?: string,
): Promise<boolean> {
  if (channel === "qq") return sendQQDirectMessage(content, identify);
  return sendWeixinDirectMessage(content, identify);
}
