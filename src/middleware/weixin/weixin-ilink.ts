/**
 * 微信 iLink HTTP 通信模块
 *
 * 实现与微信 iLink 的 HTTP/JSON 通信（二维码登录、长轮询收消息、sendmessage 发消息）。
 * 请求体/头字段对齐腾讯官方 @tencent-weixin/openclaw-weixin 插件，而非公开协议文档里的示例值。
 *
 * 参考：
 * - https://www.wechatbot.dev/zh/protocol
 * - https://github.com/Tencent/openclaw-weixin
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
const logger = getSubsystemConsoleLogger("weixin-ilink");

/** iLink 服务的固定基础地址 */
export const ILINK_FIXED_ORIGIN = "https://ilinkai.weixin.qq.com";
/** 机器人类型，扫码登录 query 固定值 */
export const BOT_TYPE = "3";

/**
 * 向上查找 agent-demo 根目录 package.json，读取 name/version。
 * 编译后在 dist/ 下运行，需 walk-up 而非写死相对路径。
 */
function readAppPackageJson(): { name?: string; version?: string } {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    const { root } = path.parse(dir);
    while (dir && dir !== root) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf-8")) as {
          name?: string;
          version?: string;
        };
        if (parsed.name === "agent-demo") return parsed;
      }
      dir = path.dirname(dir);
    }
  } catch {
    /* ignore */
  }
  return { name: "agent-demo", version: "1.0.0" };
}

const APP_PKG = readAppPackageJson();
const APP_NAME = APP_PKG.name ?? "agent-demo";
const APP_VERSION = APP_PKG.version ?? "1.0.0";

/**
 * base_info.channel_version：客户端 semver（如 "1.0.0"）。
 * 公开文档示例 "2.0.0" 只是协议说明；服务端实际按插件版本校验，缺/错易 ret:-2。
 */
const CHANNEL_VERSION = APP_VERSION;

/** 请求头 iLink-App-Id，与 openclaw-weixin package.json 的 ilink_appid 一致 */
const ILINK_APP_ID = "bot";

/**
 * 请求头 iLink-App-ClientVersion：semver 编码为 uint32。
 * 算法与 openclaw-weixin buildClientVersion 相同：major<<16 | minor<<8 | patch。
 */
function buildClientVersion(version: string): number {
  const parts = version.split(".").map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

const ILINK_APP_CLIENT_VERSION = buildClientVersion(APP_VERSION);

/** base_info.bot_agent：客户端标识，格式 name/version，openclaw 默认为 OpenClaw */
const BOT_AGENT = `${APP_NAME}/${APP_VERSION}`;

/** 每个业务 POST 请求体末尾附加的 base_info（getupdates / sendmessage 等共用） */
function buildBaseInfo(): { channel_version: string; bot_agent: string } {
  return {
    channel_version: CHANNEL_VERSION,
    bot_agent: BOT_AGENT,
  };
}

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
 * GET/POST 共用请求头（iLink-App-Id、iLink-App-ClientVersion）。
 * POST 另加 AuthorizationType / Bearer token / X-WECHAT-UIN 等，见 postHeaders。
 */
function commonHeaders(): Record<string, string> {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
  };
}

/**
 * 获取 iLink API 的 POST 请求头
 *
 * @param token - 机器人令牌（可选）
 * @param body - 请求体字符串
 * @returns POST 请求头对象
 */
function postHeaders(
  token: string | undefined,
  body: string,
): Record<string, string> {
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
  const url = new URL(
    pathWithQuery,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: commonHeaders(),
      signal: c.signal,
    });
    const text = await res.text();
    logger.debug(
      `weixin-ilink GET response: path=${pathWithQuery} status=${res.status} body=${text}`,
    );
    if (!res.ok) throw new Error(`GET ${pathWithQuery}: ${res.status} ${text}`);
    return text;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 发送 iLink API 的 POST 请求。
 * 自动合并 buildBaseInfo()；HTTP 200 仅表示传输成功，业务 ret 由调用方解析（sendmessage 在 ilinkSendText 里校验）。
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
    base_info: buildBaseInfo(),
  });
  logger.debug("weixin-ilink POST request: endpoint=%s, body=%s", endpoint, raw);
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
    logger.debug(
      `weixin-ilink POST response: endpoint=${endpoint} status=${res.status} body=${text}`,
    );
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
  const parsed = JSON.parse(text) as {
    qrcode: string;
    qrcode_img_content: string;
  };
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
 * 发送文本消息（ilink/bot/sendmessage）。
 *
 * msg 字段对齐 openclaw-weixin：from_user_id 空串、message_type=2(BOT)、message_state=2(FINISH)、
 * context_token 来自入站消息缓存（主动推送也必须带，否则 ret:-2）。
 */
export async function ilinkSendText(params: {
  baseUrl: string;
  token: string;
  toUserId: string;
  text: string;
  contextToken?: string;
}): Promise<string> {
  // 生成唯一 client_id，服务端用于去重；每条消息必须不同
  const clientId = `ag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = {
    msg: {
      from_user_id: "", // 出站固定空串，由 token 标识 bot
      to_user_id: params.toUserId,
      client_id: clientId,
      message_type: 2, // BOT
      message_state: 2, // FINISH
      item_list: [{ type: 1, text_item: { text: params.text } }],
      // 无 token 时不写入 JSON；有 token 时必须原样回传
      context_token: params.contextToken ?? undefined,
    },
  };
  const text = await ilinkPost(
    params.baseUrl,
    "ilink/bot/sendmessage",
    body,
    params.token,
    15_000,
  );
  // HTTP 200 时 body 仍可能 ret:-2；getupdates 的 ret/errcode 由 weixin-layer 单独处理
  const endpoint = "ilink/bot/sendmessage";
  const resp = JSON.parse(text) as Record<string, unknown>;
  const ret = resp.ret;
  const errcode = resp.errcode;
  const errmsg = typeof resp.errmsg === "string" ? resp.errmsg : "";
  if (typeof ret === "number" && ret !== 0) {
    throw new Error(
      `POST ${endpoint} ret=${ret}${errmsg ? `: ${errmsg}` : ""}`,
    );
  }
  if (typeof errcode === "number" && errcode !== 0) {
    throw new Error(
      `POST ${endpoint} errcode=${errcode}${errmsg ? `: ${errmsg}` : ""}`,
    );
  }
  return text;
}
