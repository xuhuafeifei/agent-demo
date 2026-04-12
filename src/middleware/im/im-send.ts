import { sendQQDirectMessage } from "../qq/qq-layer.js";
import { sendWeixinDirectMessage } from "../weixin/weixin-layer.js";

export type IMSendChannel = "qq" | "weixin";

/**
 * 统一 IM 发送入口：channel 区分平台，tenantId 路由到对应 bot 账号。
 */
export async function sendIMDirectMessage(
  channel: IMSendChannel,
  content: string,
  tenantId: string,
): Promise<boolean> {
  if (channel === "qq") return sendQQDirectMessage(content, tenantId);
  return sendWeixinDirectMessage(content, tenantId);
}
