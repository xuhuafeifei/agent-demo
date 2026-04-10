/**
 * 微信 iLink HTTP 通信模块（精简自实现，行为对齐公开协议）
 *
 * 该模块实现了与微信 iLink 服务的 HTTP 通信，包括二维码获取、状态查询、
 * 消息发送和接收等核心功能。
 */
import crypto from "node:crypto";

// iLink 应用标识，固定值 "bot"
const ILINK_APP_ID = "bot";
// 通道版本号，固定值 "1.0.0"
const CHANNEL_VERSION = "1.0.0";
// 客户端版本号，以二进制位表示：主版本(1) << 16 | 次版本(0) << 8 | 修订版本(0)
const CLIENT_VER = ((1 & 0xff) << 16) | ((0 & 0xff) << 8) | (0 & 0xff);

/** iLink 服务的固定基础地址 */
export const ILINK_FIXED_ORIGIN = "https://ilinkai.weixin.qq.com";
/** 机器人类型，固定值 "3" */
export const BOT_TYPE = "3";

/**
 * 规范化二维码图片地址
 *
 * iLink `get_bot_qrcode` 的 `qrcode_img_content` 常为裸 base64 字符串（无 data: 前缀）。
 * 浏览器会把裸字符串当成相对路径，导致 <img src> 裂图，需规范成 data URL 格式。
 *
 * @param raw - 原始图片地址
 * @param originForRelative - 处理相对路径时使用的基准地址
 * @returns 规范化后的图片地址
 */
export function normalizeQrImageSrc(
  raw: string | undefined | null,
  originForRelative: string = ILINK_FIXED_ORIGIN,
): string {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";

  // 已是标准格式的地址直接返回
  if (/^(data:|https?:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) {
    return new URL(s, originForRelative).href;
  }

  // 处理裸 base64 字符串
  const b64 = s.replace(/\s+/g, "");
  return `data:image/png;base64,${b64}`;
}

/**
 * 生成随机的 X-WECHAT-UIN 请求头
 *
 * 该头用于 iLink 通信的身份标识，格式为随机 4 字节整数的 UTF-8 编码 base64 字符串。
 *
 * @returns 随机 UIN 头值
 */
function randomUinHeader(): string {
  const n = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(n), "utf-8").toString("base64");
}

/**
 * 获取 iLink API 的通用请求头
 *
 * @returns 通用请求头对象
 */
function commonHeaders(): Record<string, string> {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(CLIENT_VER),
  };
}

/**
 * 获取 iLink API 的 POST 请求头
 *
 * @param token - 机器人令牌（可选）
 * @param body - 请求体字符串
 * @returns POST 请求头对象
 */
function postHeaders(token: string | undefined, body: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(body, "utf-8")),
    "X-WECHAT-UIN": randomUinHeader(),
    ...commonHeaders(),
  };
  if (token?.trim()) h.Authorization = `Bearer ${token.trim()}`;
  return h;
}

/**
 * 发送 iLink API 的 GET 请求
 *
 * @param baseUrl - API 基础地址
 * @param pathWithQuery - 带查询参数的路径
 * @param timeoutMs - 请求超时时间（毫秒）
 * @returns 响应文本
 */
async function ilinkGet(
  baseUrl: string,
  pathWithQuery: string,
  timeoutMs: number,
): Promise<string> {
  const url = new URL(pathWithQuery, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: commonHeaders(),
      signal: c.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${pathWithQuery}: ${res.status} ${text}`);
    return text;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 发送 iLink API 的 POST 请求
 *
 * @param baseUrl - API 基础地址
 * @param endpoint - API 端点
 * @param body - 请求体对象
 * @param token - 机器人令牌（可选）
 * @param timeoutMs - 请求超时时间（毫秒）
 * @returns 响应文本
 */
async function ilinkPost(
  baseUrl: string,
  endpoint: string,
  body: object,
  token: string | undefined,
  timeoutMs: number,
): Promise<string> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const raw = JSON.stringify({
    ...body,
    base_info: { channel_version: CHANNEL_VERSION },
  });
  const url = new URL(endpoint, base);
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: postHeaders(token, raw),
      body: raw,
      signal: c.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`POST ${endpoint}: ${res.status} ${text}`);
    return text;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 获取机器人二维码
 *
 * 用于用户扫码登录绑定微信账号。
 *
 * @param apiBase - API 基础地址
 * @returns 包含二维码内容和图片地址的对象
 */
export async function fetchBotQrCode(apiBase = ILINK_FIXED_ORIGIN): Promise<{
  qrcode: string;
  qrcode_img_content: string;
}> {
  const text = await ilinkGet(
    apiBase,
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(BOT_TYPE)}`,
    15_000,
  );
  const parsed = JSON.parse(text) as { qrcode: string; qrcode_img_content: string };
  return {
    qrcode: parsed.qrcode,
    qrcode_img_content: normalizeQrImageSrc(parsed.qrcode_img_content, apiBase),
  };
}

/**
 * 查询二维码状态
 *
 * 轮询二维码的扫描状态，用于登录流程。
 *
 * @param apiBase - API 基础地址
 * @param qrcode - 二维码标识
 * @param timeoutMs - 请求超时时间（毫秒）
 * @returns 二维码状态信息
 */
export async function fetchQrStatus(
  apiBase: string,
  qrcode: string,
  timeoutMs: number,
): Promise<{
  status: string;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}> {
  const text = await ilinkGet(
    apiBase,
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    timeoutMs,
  );
  return JSON.parse(text) as {
    status: string;
    bot_token?: string;
    ilink_bot_id?: string;
    baseurl?: string;
    ilink_user_id?: string;
    redirect_host?: string;
  };
}

/** iLink getupdates API 的响应类型 */
export type GetUpdatesResp = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: Array<Record<string, unknown>>;
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
};

/**
 * 获取微信消息更新
 *
 * 使用长轮询方式获取用户发送的消息。
 *
 * @param params - 请求参数
 * @returns 消息更新响应
 */
export async function ilinkGetUpdates(params: {
  baseUrl: string;
  token: string;
  getUpdatesBuf: string;
  timeoutMs: number;
}): Promise<GetUpdatesResp> {
  try {
    const text = await ilinkPost(
      params.baseUrl,
      "ilink/bot/getupdates",
      { get_updates_buf: params.getUpdatesBuf },
      params.token,
      params.timeoutMs,
    );
    return JSON.parse(text) as GetUpdatesResp;
  } catch (e) {
    // 超时错误视为正常轮询结束（无新消息）
    if (e instanceof Error && e.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: params.getUpdatesBuf };
    }
    throw e;
  }
}

/**
 * 发送文本消息
 *
 * 向指定用户发送文本消息。
 *
 * @param params - 发送参数
 */
export async function ilinkSendText(params: {
  baseUrl: string;
  token: string;
  toUserId: string;
  text: string;
  contextToken?: string;
}): Promise<void> {
  // 生成唯一客户端 ID
  const clientId = `ag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = {
    msg: {
      from_user_id: "",
      to_user_id: params.toUserId,
      client_id: clientId,
      message_type: 2, // 2 表示机器人消息
      message_state: 2, // 消息状态：已发送
      item_list: [{ type: 1, text_item: { text: params.text } }],
      context_token: params.contextToken,
    },
  };
  await ilinkPost(params.baseUrl, "ilink/bot/sendmessage", body, params.token, 15_000);
}
