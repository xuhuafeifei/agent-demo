import { Router } from "express";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { startWeixinQrSessionAsync, pollWeixinQrSession } from "../../weixin/weixin-login.js";
import {
  loadWeixinAccount,
  clearWeixinAccount,
  maskUserId,
} from "../../weixin/weixin-account.js";
import { clearWeixinContextCache } from "../../weixin/weixin-layer.js";

const log = getSubsystemConsoleLogger("weixin-api");

export function createWeixinRouter() {
  const r = Router();

  r.post("/login/start", async (_req, res) => {
    try {
      const { sessionKey, qrcodeUrl } = await startWeixinQrSessionAsync();
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
    const acc = loadWeixinAccount();
    res.json({
      success: true,
      bound: Boolean(acc),
      linkedUserIdMasked: acc ? maskUserId(acc.linkedUserId) : null,
    });
  });

  r.delete("/account", (_req, res) => {
    clearWeixinAccount();
    clearWeixinContextCache();
    res.json({ success: true });
  });

  return r;
}
