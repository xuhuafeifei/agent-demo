/**
 * 微信 API 路由模块：微信账号绑定管理相关接口
 */
import { Router } from "express";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { startWeixinQrSessionAsync, pollWeixinQrSession } from "../../weixin/weixin-login.js";
import {
  clearWeixinAccounts,
  loadWeixinAccounts,
  removeWeixinBot,
  setWeixinPrimary,
  isValidTenantId,
} from "../../weixin/weixin-account.js";

const log = getSubsystemConsoleLogger("weixin-api");

export function createWeixinRouter() {
  const r = Router();

  /**
   * POST /login/start
   * 启动微信登录会话，生成二维码。
   * Body: { tenantId: string }（tenantId 决定将 bot 绑定到哪个租户）
   */
  r.post("/login/start", async (req, res) => {
    const tenantId = String(req.body?.tenantId ?? "").trim();
    if (!isValidTenantId(tenantId)) {
      return res.status(400).json({
        success: false,
        error: "tenantId 仅允许英文、数字、下划线，且不能为空",
      });
    }
    try {
      const { sessionKey, qrcodeUrl } = await startWeixinQrSessionAsync(tenantId);
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
   * POST /login/poll
   * 轮询微信登录状态。
   * Body: { sessionKey: string }
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
        log.error("[weixin/login/poll] phase=error sessionKey=%s %s", sessionKey, out.message);
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
      res.status(500).json({ success: false, error: msg });
    }
  });

  /**
   * GET /status
   * 查询当前已绑定的微信 Bot 配置
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
          tenantId: b.tenantId,
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
   * POST /primary
   * 设置主微信 Bot。
   * Body: { tenantId: string }
   */
  r.post("/primary", (req, res) => {
    const tenantId = String(req.body?.tenantId ?? "").trim();
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "缺少 tenantId" });
    }
    const ok = setWeixinPrimary(tenantId);
    if (!ok) {
      return res.status(404).json({ success: false, error: "未找到对应 tenantId" });
    }
    res.json({ success: true });
  });

  /**
   * DELETE /account/:tenantId
   * 删除指定租户 ID 的微信 Bot
   */
  r.delete("/account/:tenantId", (req, res) => {
    const tenantId = String(req.params?.tenantId ?? "").trim();
    if (!tenantId) {
      return res.status(400).json({ success: false, error: "缺少 tenantId" });
    }
    const removed = removeWeixinBot(tenantId);
    if (!removed) {
      return res.status(404).json({ success: false, error: "未找到对应 tenantId" });
    }
    res.json({ success: true });
  });

  /**
   * DELETE /account
   * 清除所有微信账号配置
   */
  r.delete("/account", (_req, res) => {
    clearWeixinAccounts();
    res.json({ success: true });
  });

  return r;
}
