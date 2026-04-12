/**
 * 微信登录模块：实现二维码扫码绑定微信账号的完整流程
 */
import { randomUUID } from "node:crypto";
import {
  ILINK_FIXED_ORIGIN,
  fetchBotQrCode,
  fetchQrStatus,
} from "./weixin-ilink.js";
import {
  isValidTenantId,
  type WeixinBoundBot,
  upsertWeixinBot,
} from "./weixin-account.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";

const log = getSubsystemConsoleLogger("weixin-login");

const QR_TTL_MS = 5 * 60_000;
const POLL_TIMEOUT_MS = 12_000;

/** 登录会话信息（内存临时存储，只存在于扫码绑定流程中） */
type Login = {
  tenantId: string;        // 要绑定的租户 ID
  qrcode: string;          // 二维码内容
  qrcodeUrl: string;       // 二维码图片（data URL）
  currentApiBase: string;  // 当前 API 基础地址
  startedAt: number;       // 会话开始时间
};

const sessions = new Map<string, Login>();

/**
 * 启动微信二维码登录会话，生成新二维码。
 *
 * @param tenantId 要绑定的租户 ID（对应 accounts.json 中 bot.tenantId）
 */
export async function startWeixinQrSessionAsync(): Promise<{
  sessionKey: string;
  qrcodeUrl: string;
}>;
export async function startWeixinQrSessionAsync(tenantId: string): Promise<{
  sessionKey: string;
  qrcodeUrl: string;
}>;
export async function startWeixinQrSessionAsync(tenantId?: string): Promise<{
  sessionKey: string;
  qrcodeUrl: string;
}> {
  const id = String(tenantId ?? "").trim();
  if (!isValidTenantId(id)) {
    throw new Error("tenantId 仅允许英文、数字、下划线，且不能为空");
  }
  const sessionKey = randomUUID();
  const qr = await fetchBotQrCode(ILINK_FIXED_ORIGIN);
  sessions.set(sessionKey, {
    tenantId: id,
    qrcode: qr.qrcode,
    qrcodeUrl: qr.qrcode_img_content,
    currentApiBase: ILINK_FIXED_ORIGIN,
    startedAt: Date.now(),
  });

  // 定时清除过期会话，避免内存泄漏
  setTimeout(() => sessions.delete(sessionKey), QR_TTL_MS);

  return { sessionKey, qrcodeUrl: qr.qrcode_img_content };
}

export type PollResult =
  | { phase: "pending"; hint?: string; qrcodeUrl?: string }
  | { phase: "done"; account: WeixinBoundBot }
  | { phase: "error"; message: string };

function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * 轮询微信二维码登录状态。
 *
 * @param sessionKey 登录会话密钥（由 startWeixinQrSessionAsync 返回）
 */
export async function pollWeixinQrSession(sessionKey: string): Promise<PollResult> {
  const login = sessions.get(sessionKey);
  if (!login) return { phase: "error", message: "会话不存在或已结束，请重新获取二维码" };

  if (Date.now() - login.startedAt > QR_TTL_MS) {
    sessions.delete(sessionKey);
    return { phase: "error", message: "二维码已过期，请重新获取" };
  }

  let st: Awaited<ReturnType<typeof fetchQrStatus>>;
  try {
    st = await fetchQrStatus(login.currentApiBase, login.qrcode, POLL_TIMEOUT_MS);
  } catch (error) {
    if (isAbortLikeError(error)) return { phase: "pending" };
    throw error;
  }

  if (st.status === "wait" || st.status === "scaned") {
    return {
      phase: "pending",
      hint: st.status === "scaned" ? "已扫码，请在手机上确认" : undefined,
    };
  }

  if (st.status === "scaned_but_redirect" && st.redirect_host) {
    login.currentApiBase = `https://${st.redirect_host}`;
    return { phase: "pending", hint: "连接中…" };
  }

  if (st.status === "expired") {
    sessions.delete(sessionKey);
    return { phase: "error", message: "二维码已失效，请重新获取" };
  }

  if (st.status !== "confirmed" || !st.bot_token || !st.ilink_bot_id) {
    return { phase: "pending" };
  }

  const uid = st.ilink_user_id?.trim() || "";
  if (!uid) {
    sessions.delete(sessionKey);
    return { phase: "error", message: "未返回微信用户标识，绑定失败" };
  }

  const baseUrl = (st.baseurl?.trim() || login.currentApiBase).replace(/\/$/, "");
  const saved = upsertWeixinBot({
    tenantId: login.tenantId,
    token: st.bot_token,
    baseUrl,
    botId: st.ilink_bot_id,
    linkedUserId: uid,
  });
  if (!saved.ok) {
    sessions.delete(sessionKey);
    return { phase: "error", message: saved.error };
  }
  log.debug(
    `weixin login success tenantId=${login.tenantId} botId=${saved.bot.botId} linkedUserId=${saved.bot.linkedUserId}`,
  );
  sessions.delete(sessionKey);

  return { phase: "done", account: saved.bot };
}
