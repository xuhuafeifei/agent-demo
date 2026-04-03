import { Router } from "express";
import { saveQwenPortalCredentials } from "../../../agent/auth/oauth-path.js";
import { evicateFgbgUserConfigCache } from "../../../config/index.js";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import {
  createOAuthSession,
  oauthSessionStore,
} from "../services/oauth-session.js";

const webLogger = getSubsystemConsoleLogger("web");

/**
 * OAuth router: /config/qwen-portal/oauth
 */
export function createOAuthRouter() {
  const router = Router();

  // POST /config/qwen-portal/oauth/start - Start OAuth device flow
  router.post("/start", async (_req, res) => {
    try {
      const { createQwenPortalDeviceSession } =
        await import("../../../agent/auth/qwen-portal-oauth.js");
      const session = await createQwenPortalDeviceSession();

      const oauthSessionId = createOAuthSession(
        session.verifier,
        session.deviceCode,
        session.expiresIn,
        session.intervalSec ?? 2,
      );

      res.json({
        success: true,
        oauthSessionId,
        verificationUrl: session.verificationUrl,
        userCode: session.userCode,
        expiresIn: session.expiresIn,
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[qwen-oauth/start] %s",
        runtimeError.message,
        runtimeError,
      );
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  // POST /config/qwen-portal/oauth/poll - Poll OAuth token status
  router.post("/poll", async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const oauthSessionId =
      typeof (body as { oauthSessionId?: unknown }).oauthSessionId === "string"
        ? (body as { oauthSessionId: string }).oauthSessionId.trim()
        : "";
    if (!oauthSessionId) {
      return res.status(400).json({
        success: false,
        error: "缺少 oauthSessionId",
      });
    }

    const pending = oauthSessionStore.get(oauthSessionId);
    if (!pending || Date.now() > pending.expiresAt) {
      oauthSessionStore.delete(oauthSessionId);
      return res.status(400).json({
        success: false,
        error: "授权会话已过期或无效，请重新点击「Qwen 授权」。",
      });
    }

    try {
      const { pollQwenPortalDeviceToken } =
        await import("../../../agent/auth/qwen-portal-oauth.js");
      const result = await pollQwenPortalDeviceToken(
        pending.deviceCode,
        pending.verifier,
        60000, // 60秒超时
      );

      if (result.status === "success") {
        saveQwenPortalCredentials(result.token);
        oauthSessionStore.delete(oauthSessionId);
        evicateFgbgUserConfigCache();
        return res.json({
          success: true,
          status: "success" as const,
        });
      }
      if (result.status === "pending") {
        return res.json({
          success: true,
          status: "pending" as const,
          slowDown: Boolean(result.slowDown),
        });
      }
      oauthSessionStore.delete(oauthSessionId);
      return res.json({
        success: false,
        status: "error" as const,
        error: result.message,
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[qwen-oauth/poll] %s",
        runtimeError.message,
        runtimeError,
      );
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  return router;
}
