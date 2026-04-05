import {
  API_BASE,
  TOKEN_URL,
  nextMsgSeq,
  type QQGatewayResponse,
  type QQTokenResponse,
} from "./qq-utils.js";

// 访问令牌缓存
let tokenCache: { token: string; expiresAt: number } | null = null;

/**
 * 获取 QQ 机器人访问令牌
 * @param appId - 应用 ID
 * @param secret - 应用密钥
 * @returns 访问令牌字符串
 * @description 该函数会缓存令牌，避免频繁请求，在令牌过期前 60 秒会自动刷新
 */
export async function getAccessToken(
  appId: string,
  secret: string,
): Promise<string> {
  // 检查缓存的令牌是否有效（过期前 60 秒内刷新）
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  // 发起请求获取新的访问令牌
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

  // 计算令牌过期时间并更新缓存
  const expiresIn = Number(data.expires_in ?? 7200);
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return data.access_token;
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
