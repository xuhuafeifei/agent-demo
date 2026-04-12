import { Router } from "express";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import {
  maybeStartQQLayerIfEnabledAndIdle,
  stopQQLayer,
} from "../../qq/qq-layer.js";
import {
  isQQConnectingStatus,
  isQQReadyStatus,
} from "../../qq/qq-status.js";

const webLogger = getSubsystemConsoleLogger("web");

/** 挂载路径：/api/config/qq */
export function createQQConfigRouter() {
  const router = Router();

  router.post("/stop", (_req, res) => {
    try {
      stopQQLayer();
      res.json({
        success: true,
        ready: isQQReadyStatus(),
        connecting: isQQConnectingStatus(),
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/qq/stop] %s", runtimeError.message, runtimeError);
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  router.post("/start", async (_req, res) => {
    try {
      await maybeStartQQLayerIfEnabledAndIdle();
      res.json({
        success: true,
        ready: isQQReadyStatus(),
        connecting: isQQConnectingStatus(),
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/qq/start] %s", runtimeError.message, runtimeError);
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  return router;
}
