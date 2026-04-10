/**
 * 微信登录模块
 *
 * 该模块实现了微信账号绑定的二维码登录流程，包括：
 * - 生成登录二维码
 * - 轮询二维码状态
 * - 处理登录结果（成功/失败/过期）
 * - 账号绑定验证
 */
import { randomUUID } from "node:crypto";
import {
  ILINK_FIXED_ORIGIN,
  fetchBotQrCode,
  fetchQrStatus,
} from "./weixin-ilink.js";
import {
  loadWeixinAccount,
  saveWeixinAccount,
  type WeixinBoundAccount,
} from "./weixin-account.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";

const log = getSubsystemConsoleLogger("weixin-login");

/** 二维码有效期：5分钟 */
const QR_TTL_MS = 5 * 60_000;
/** 轮询超时时间：12秒 */
const POLL_TIMEOUT_MS = 12_000;

/** 登录会话信息类型 */
type Login = {
  qrcode: string; // 二维码内容
  qrcodeUrl: string; // 二维码图片地址（data URL 格式）
  currentApiBase: string; // 当前 API 基础地址
  startedAt: number; // 会话开始时间
};

/** 登录会话存储（sessionKey -> Login） */
// 只存在于扫码绑定流程
const sessions = new Map<string, Login>();

/**
 * 启动微信二维码登录会话
 *
 * 生成新的登录会话，获取二维码图片。
 *
 * @returns 包含会话密钥和二维码地址的对象
 */
export async function startWeixinQrSessionAsync(): Promise<{
  sessionKey: string;
  qrcodeUrl: string;
}> {
  const sessionKey = randomUUID();
  const qr = await fetchBotQrCode(ILINK_FIXED_ORIGIN);
  sessions.set(sessionKey, {
    qrcode: qr.qrcode,
    qrcodeUrl: qr.qrcode_img_content,
    currentApiBase: ILINK_FIXED_ORIGIN,
    startedAt: Date.now(),
  });

  // 定时清除过期的会话，避免内存泄漏
  setTimeout(() => sessions.delete(sessionKey), QR_TTL_MS);

  return { sessionKey, qrcodeUrl: qr.qrcode_img_content };
}

/** 轮询登录状态的结果类型 */
export type PollResult =
  | { phase: "pending"; hint?: string; qrcodeUrl?: string } // 等待中
  | { phase: "done"; account: WeixinBoundAccount } // 登录成功
  | { phase: "error"; message: string }; // 登录失败

/**
 * 轮询微信二维码登录状态
 *
 * 查询登录会话的状态，处理各种登录场景。
 *
 * @param sessionKey - 登录会话密钥
 * @returns 轮询结果
 */
export async function pollWeixinQrSession(
  sessionKey: string,
): Promise<PollResult> {
  const login = sessions.get(sessionKey);
  if (!login)
    return { phase: "error", message: "会话不存在或已结束，请重新获取二维码" };

  // 检查二维码是否过期
  if (Date.now() - login.startedAt > QR_TTL_MS) {
    sessions.delete(sessionKey);
    return { phase: "error", message: "二维码已过期，请重新获取" };
  }

  // 查询二维码状态
  const st = await fetchQrStatus(
    login.currentApiBase,
    login.qrcode,
    POLL_TIMEOUT_MS,
  );

  // 处理等待状态
  if (st.status === "wait" || st.status === "scaned") {
    return {
      phase: "pending",
      hint: st.status === "scaned" ? "已扫码，请在手机上确认" : undefined,
    };
  }

  // 处理重定向状态
  if (st.status === "scaned_but_redirect" && st.redirect_host) {
    login.currentApiBase = `https://${st.redirect_host}`;
    return { phase: "pending", hint: "连接中…" };
  }

  // 处理二维码失效
  if (st.status === "expired") {
    sessions.delete(sessionKey);
    return { phase: "error", message: "二维码已失效，请重新获取" };
  }

  // 验证登录成功状态
  if (st.status !== "confirmed" || !st.bot_token || !st.ilink_bot_id) {
    return { phase: "pending" };
  }

  // 验证用户标识
  const uid = st.ilink_user_id?.trim() || "";
  if (!uid) {
    sessions.delete(sessionKey);
    return { phase: "error", message: "未返回微信用户标识，绑定失败" };
  }

  // 检查是否已绑定其他微信账号
  const existing = loadWeixinAccount();
  if (existing && existing.linkedUserId !== uid) {
    sessions.delete(sessionKey);
    return {
      phase: "error",
      message: "已绑定其他微信账号，请先解绑后再扫码",
    };
  }

  // 保存绑定账号信息
  const baseUrl = (st.baseurl?.trim() || login.currentApiBase).replace(
    /\/$/,
    "",
  );
  const account: WeixinBoundAccount = {
    token: st.bot_token,
    baseUrl,
    botId: st.ilink_bot_id,
    linkedUserId: uid,
  };
  log.debug(`weixin login success: ${JSON.stringify(account)}`);

  saveWeixinAccount(account);
  sessions.delete(sessionKey);

  return { phase: "done", account };
}
