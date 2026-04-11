import { Router } from "express";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { startWeixinQrSessionAsync, pollWeixinQrSession } from "../../weixin/weixin-login.js";
import {
  clearWeixinAccounts,
  loadWeixinAccounts,
  removeWeixinBot,
  setWeixinPrimary,
  isValidIdentify,
  maskUserId,
} from "../../weixin/weixin-account.js";
import { clearWeixinContextCache } from "../../weixin/weixin-layer.js";

const log = getSubsystemConsoleLogger("weixin-api");

export function createWeixinRouter() {
  const r = Router();

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

  r.post("/login/poll", async (req, res) => {
    const sessionKey = String(req.body?.sessionKey ?? "").trim();
    if (!sessionKey) {
      log.warn("[weixin/login/poll] missing sessionKey");
      return res.status(400).json({ success: false, error: "缺少 sessionKey" });
    }
    try {
      const out = await pollWeixinQrSession(sessionKey);
      if (out.phase === "done") {
        return res.json({
          success: true,
          phase: "done",
          linkedUserIdMasked: maskUserId(out.account.linkedUserId),
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

  r.get("/status", (_req, res) => {
    const store = loadWeixinAccounts();
    res.json({
      success: true,
      bound: store.bots.length > 0,
      primary: store.primary || "",
      bots: store.bots.map((b) => ({
        identify: b.identify,
        botId: b.botId,
        linkedUserIdMasked: maskUserId(b.linkedUserId),
        updatedAt: b.updatedAt,
      })),
    });
  });

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

  r.delete("/account/:identify", (req, res) => {
    const identify = String(req.params?.identify ?? "").trim();
    if (!identify) {
      return res.status(400).json({ success: false, error: "缺少 identify" });
    }
    const removed = removeWeixinBot(identify);
    clearWeixinContextCache();
    if (!removed) {
      return res.status(404).json({ success: false, error: "未找到对应 identify" });
    }
    res.json({ success: true });
  });

  r.delete("/account", (_req, res) => {
    clearWeixinAccounts();
    clearWeixinContextCache();
    res.json({ success: true });
  });

  return r;
}
