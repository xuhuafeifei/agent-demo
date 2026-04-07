import {
  API_BASE,
  TOKEN_URL,
  nextMsgSeq,
  type QQGatewayResponse,
  type QQTokenResponse,
} from "./qq-utils.js";

/**
 * 获取 QQ 机器人访问令牌
 * @param appId - 应用 ID
 * @param secret - 应用密钥
 * @returns access_token 与 expires_in（秒）
 * @description 纯 API 请求，不管理缓存与过期策略
 */
export async function getAccessToken(
  appId: string,
  secret: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret: secret }),
  });
  const data = (await response.json()) as QQTokenResponse;

  // 检查响应是否成功
  if (!response.ok || !data.access_token) {
    throw new Error(`获取 QQ access_token 失败: ${JSON.stringify(data)}`);
  }

  const expiresIn = Number(data.expires_in ?? 7200);
  return { accessToken: data.access_token, expiresIn };
}

/**
 * 获取 QQ 网关连接地址
 * @param accessToken - 访问令牌
 * @returns 网关连接地址
 */
export async function getGatewayUrl(accessToken: string): Promise<string> {
  const response = await fetch(`${API_BASE}/gateway`, {
    headers: { Authorization: `QQBot ${accessToken}` },
  });
  const data = (await response.json()) as QQGatewayResponse;

  if (!response.ok || !data.url) {
    throw new Error(`获取 QQ gateway 失败: ${JSON.stringify(data)}`);
  }

  return data.url;
}

/**
 * 发送私聊消息
 * @param params - 发送消息的参数
 * @param params.accessToken - 访问令牌
 * @param params.openid - 接收方的 openid
 * @param params.content - 消息内容
 * @param params.replyToMessageId - 回复的消息 ID（可选）
 */
export async function sendC2CMessage(params: {
  accessToken: string;
  openid: string;
  content: string;
  replyToMessageId?: string;
}): Promise<void> {
  const { accessToken, openid, content, replyToMessageId } = params;
  const response = await fetch(`${API_BASE}/v2/users/${openid}/messages`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: "",
      msg_type: 2,
      msg_seq: nextMsgSeq(),
      ...(replyToMessageId ? { msg_id: replyToMessageId } : {}),
      markdown: { content },
    }),
  });
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    const hint = errBody.trim() || "(empty body)";
    throw new Error(
      `发送私聊消息失败: HTTP ${response.status} ${response.statusText}; body: ${hint}`,
    );
  }
}
