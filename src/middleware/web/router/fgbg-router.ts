import { Router } from "express";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import {
  readConfigWithMetadata,
  patchConfig,
  resetConfig,
  hasProtectedPath,
} from "../services/service.js";
import { validateRequest, qqbotChannelSchema, heartbeatConfigSchema } from "../validators.js";

const webLogger = getSubsystemConsoleLogger("web");

/**
 * Fgbg config router: /config/fgbg
 */
export function createFgbgRouter() {
  const router = Router();

  // GET /config/fgbg - Read full FgbgUserConfig
  router.get("/", (_req, res) => {
    try {
      const result = readConfigWithMetadata();
      res.json({
        success: true,
        config: result.config,
        metadata: result.metadata,
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/get] %s", runtimeError.message, runtimeError);
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  // PATCH /config/fgbg - Patch config
  router.patch("/", async (req, res) => {
    const patchRaw = req.body && typeof req.body === "object" ? req.body : {};

    if (hasProtectedPath(patchRaw as Record<string, unknown>)) {
      return res.status(403).json({
        success: false,
        error: "尝试修改受保护字段（例如 qwen API Key），操作被拒绝。",
      });
    }

    try {
      // 校验特定字段
      if (patchRaw.channels?.qqbot) {
        const qqbotValidation = validateRequest(qqbotChannelSchema, patchRaw.channels.qqbot);
        if (!qqbotValidation.success) {
          return res.status(400).json({
            success: false,
            error: `QQBot 配置校验失败: ${qqbotValidation.error}`,
          });
        }
      }

      if (patchRaw.heartbeat) {
        const heartbeatValidation = validateRequest(heartbeatConfigSchema, patchRaw.heartbeat);
        if (!heartbeatValidation.success) {
          return res.status(400).json({
            success: false,
            error: `心跳配置校验失败: ${heartbeatValidation.error}`,
          });
        }
      }

      const result = patchConfig(patchRaw);
      res.json({
        success: true,
        config: result.config,
        metadata: result.metadata,
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/patch] %s", runtimeError.message, runtimeError);
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  // POST /config/fgbg/reset - Reset config to defaults
  router.post("/reset", (_req, res) => {
    try {
      const result = resetConfig();
      res.json({
        success: true,
        config: result.config,
        metadata: result.metadata,
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/reset] %s", runtimeError.message, runtimeError);
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  return router;
}
