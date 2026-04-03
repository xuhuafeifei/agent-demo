import { Router } from "express";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";

const webLogger = getSubsystemConsoleLogger("web");

/**
 * Logging config router: /config/logging
 */
export function createLoggingRouter() {
  const router = Router();

  // POST /config/logging/evict-cache - Invalidate logging config cache
  router.post("/evict-cache", async (_req, res) => {
    try {
      const { evictLoggingConfigCache } =
        await import("../../../logger/logger.js");
      evictLoggingConfigCache();
      res.json({
        success: true,
        message: "日志配置缓存已清除",
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[config/logging/evict] %s",
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
