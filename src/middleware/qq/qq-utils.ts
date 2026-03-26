// QQ 机器人 API 相关的常量

/** 获取访问令牌的接口地址 */
export const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";

/** QQ 机器人 API 的基础地址 */
export const API_BASE = "https://api.sgroup.qq.com";

/**
 * QQ 访问令牌响应类型
 * @property access_token - 访问令牌
 * @property expires_in - 令牌过期时间（秒）
 */
export type QQTokenResponse = { access_token?: string; expires_in?: number };

/**
 * QQ 网关响应类型
 * @property url - 网关连接地址
 */
export type QQGatewayResponse = { url: string };

/**
 * QQ WebSocket 消息负载类型
 * @property op - 操作码，用于区分消息类型
 * @property d - 消息数据
 * @property s - 消息序列号
 * @property t - 事件类型
 */
export type QQWSPayload = {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
};

/**
 * QQ 私聊事件类型
 * @property id - 消息 ID
 * @property timestamp - 消息时间戳
 * @property content - 消息内容
 * @property author - 消息发送者信息
 * @property author.user_openid - 发送者的 openid
 */
export type QQC2CEvent = {
  id: string;
  timestamp: string;
  content: string;
  author: {
    user_openid: string;
  };
};

/**
 * 生成随机消息序列号
 * @returns 0-65535 之间的随机整数
 */
export function nextMsgSeq(): number {
  return Math.floor(Math.random() * 65535);
}

/**
 * 解析 QQ 私聊事件
 * @param payload - WebSocket 消息负载
 * @returns 解析后的私聊事件，失败返回 null
 */
export function parseC2CEvent(payload: QQWSPayload): QQC2CEvent | null {
  // 检查是否是私聊消息事件
  if (payload.op !== 0 || payload.t !== "C2C_MESSAGE_CREATE") return null;

  const data = payload.d as QQC2CEvent | undefined;

  // 验证事件数据的完整性
  if (!data?.author?.user_openid || typeof data.content !== "string")
    return null;

  return data;
}
