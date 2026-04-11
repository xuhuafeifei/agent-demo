/**
 * 微信 API 路由模块
 *
 * 该模块提供了微信账号管理的 RESTful API 接口，包括：
 * - 登录流程（二维码生成、状态轮询）
 * - 账号绑定与管理
 * - 主 Bot 设置
 * - 微信配置查询
 *
 * 所有接口都遵循统一的响应格式：
 * { success: boolean, error?: string, ... }
 */
import { Router } from "express";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { startWeixinQrSessionAsync, pollWeixinQrSession } from "../../weixin/weixin-login.js";
import {
  clearWeixinAccounts,
  loadWeixinAccounts,
  removeWeixinBot,
  setWeixinPrimary,
  isValidIdentify,
} from "../../weixin/weixin-account.js";

const log = getSubsystemConsoleLogger("weixin-api");

/**
 * 创建微信 API 路由
 *
 * 初始化并配置所有微信相关的路由处理函数
 *
 * @returns Express Router 对象
 */
export function createWeixinRouter() {
  const r = Router();

  /**
   * 启动微信登录会话
   *
   * 生成微信登录二维码，用于用户扫码绑定微信账号
   *
   * @route POST /login/start
   * @param {string} req.body.identify - 可选的 Bot 标识符（用于区分不同 Bot）
   * @returns {Object} 响应对象，包含 sessionKey 和 qrcodeUrl
   * @example
   * 请求：{ identify: "myBot" }
   * 响应：{ success: true, sessionKey: "uuid", qrcodeUrl: "data:image/png;base64,..." }
   */
  r.post("/login/start", async (req, res) => {
    const identify = String(req.body?.identify ?? "").trim();
    if (!isValidIdentify(identify)) {
      return res.status(400).json({
        success: false,
        error: "identify 仅允许英文、数字、下划线，且不能为空",
      });
    }
    try {
      const { sessionKey, qrcodeUrl } = await startWeixinQrSessionAsync(identify);
      res.json({ success: true, sessionKey, qrcodeUrl });
    } catch (e) {
      log.error(String(e));
      res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  /**
   * 轮询微信登录状态
   *
   * 查询登录会话的状态，处理各种登录场景（等待扫码、扫码成功、二维码过期等）
   *
   * @route POST /login/poll
   * @param {string} req.body.sessionKey - 登录会话密钥（由 /login/start 返回）
   * @returns {Object} 轮询结果，包含 phase（pending/done/error）和相应信息
   * @example
   * 请求：{ sessionKey: "uuid" }
   * 响应：{ success: true, phase: "pending", hint: "已扫码，请在手机上确认" }
   */
  r.post("/login/poll", async (req, res) => {
    const sessionKey = String(req.body?.sessionKey ?? "").trim();
    if (!sessionKey) {
      log.warn("[weixin/login/poll] missing sessionKey");
      return res.status(400).json({ success: false, error: "缺少 sessionKey" });
    }
    try {
      const out = await pollWeixinQrSession(sessionKey);
      if (out.phase === "done") {
        const uid = out.account.linkedUserId ?? "";
        return res.json({
          success: true,
          phase: "done",
          linkedUserId: uid,
          linkedUserIdMasked: uid,
        });
      }
      if (out.phase === "error") {
        log.error(
          "[weixin/login/poll] phase=error sessionKey=%s %s",
          sessionKey,
          out.message,
        );
        return res.json({ success: false, phase: "error", error: out.message });
      }
      return res.json({
        success: true,
        phase: "pending",
        hint: out.hint,
        qrcodeUrl: out.qrcodeUrl,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("[weixin/login/poll] exception sessionKey=%s %s", sessionKey, msg);
      res.status(500).json({
        success: false,
        error: msg,
      });
    }
  });

  /**
   * 获取微信账号状态
   *
   * 查询当前已绑定的微信 Bot 配置信息
   *
   * @route GET /status
   * @returns {Object} 微信账号状态信息
   * @example
   * 响应：
   * {
   *   "success": true,
   *   "bound": true,
   *   "primary": "myBot",
   *   "bots": [
   *     {
   *       "identify": "myBot",
   *       "botId": "wx123456789",
   *       "linkedUserIdMasked": "wx1…345",
   *       "updatedAt": "2024-04-11T10:30:00Z"
   *     }
   *   ]
   * }
   */
  r.get("/status", (_req, res) => {
    const store = loadWeixinAccounts();
    res.json({
      success: true,
      bound: store.bots.length > 0,
      primary: store.primary || "",
      bots: store.bots.map((b) => {
        const uid = b.linkedUserId ?? "";
        return {
          identify: b.identify,
          botId: b.botId,
          baseUrl: b.baseUrl,
          token: b.token,
          linkedUserId: uid,
          peerUserId: b.peerUserId ?? "",
          linkedUserIdMasked: uid,
          updatedAt: b.updatedAt,
        };
      }),
    });
  });

  /**
   * 设置主微信 Bot
   *
   * 配置哪个 Bot 作为默认的微信消息处理者
   *
   * @route POST /primary
   * @param {string} req.body.identify - 要设置为主 Bot 的标识符
   * @returns {Object} 操作结果
   * @example
   * 请求：{ identify: "myBot" }
   * 响应：{ success: true }
   */
  r.post("/primary", (req, res) => {
    const identify = String(req.body?.identify ?? "").trim();
    if (!identify) {
      return res.status(400).json({ success: false, error: "缺少 identify" });
    }
    const ok = setWeixinPrimary(identify);
    if (!ok) {
      return res.status(404).json({ success: false, error: "未找到对应 identify" });
    }
    res.json({ success: true });
  });

  /**
   * 删除指定的微信 Bot
   *
   * 移除已绑定的微信 Bot 配置
   *
   * @route DELETE /account/:identify
   * @param {string} req.params.identify - 要删除的 Bot 标识符
   * @returns {Object} 操作结果
   * @example
   * 请求：DELETE /account/myBot
   * 响应：{ success: true }
   */
  r.delete("/account/:identify", (req, res) => {
    const identify = String(req.params?.identify ?? "").trim();
    if (!identify) {
      return res.status(400).json({ success: false, error: "缺少 identify" });
    }
    const removed = removeWeixinBot(identify);
    if (!removed) {
      return res.status(404).json({ success: false, error: "未找到对应 identify" });
    }
    res.json({ success: true });
  });

  /**
   * 清除所有微信账号配置
   *
   * 移除所有已绑定的微信 Bot 配置，恢复到初始状态
   *
   * @route DELETE /account
   * @returns {Object} 操作结果
   * @example
   * 请求：DELETE /account
   * 响应：{ success: true }
   */
  r.delete("/account", (_req, res) => {
    clearWeixinAccounts();
    res.json({ success: true });
  });

  return r;
}
