import { Router } from "express";
import { getSubsystemConsoleLogger, evictLoggingConfigCache } from "../../../logger/logger.js";
import {
  readFgbgUserConfig,
  writeFgbgUserConfig,
  evicateFgbgUserConfigCache,
} from "../../../config/index.js";

const webLogger = getSubsystemConsoleLogger("web");

/**
 * Logging config router: /config/logging
 */
export function createLoggingRouter() {
  const router = Router();

  // GET /config/logging - 获取当前日志配置
  router.get("/", (_req, res) => {
    try {
      const cfg = readFgbgUserConfig();
      res.json({
        success: true,
        logging: cfg.logging || {},
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[config/logging/get] %s",
        runtimeError.message,
        runtimeError,
      );
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  // POST /config/logging/save - 保存日志配置
  router.post("/save", async (req, res) => {
    try {
      const loggingConfig = req.body && typeof req.body === "object" ? req.body : {};
      
      // 读取当前配置
      const currentConfig = readFgbgUserConfig();
      
      // 更新 logging 配置
      const updatedConfig = {
        ...currentConfig,
        logging: {
          ...currentConfig.logging,
          ...loggingConfig,
        },
      };
      
      // 写入配置文件
      writeFgbgUserConfig(updatedConfig);
      
      // 清除 fgbg 配置缓存
      evicateFgbgUserConfigCache();
      
      // 清除日志配置缓存
      evictLoggingConfigCache();
      
      res.json({
        success: true,
        message: "日志配置已保存",
        logging: updatedConfig.logging,
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[config/logging/save] %s",
        runtimeError.message,
        runtimeError,
      );
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  // POST /config/logging/evict-cache - 刷新日志配置缓存（重新加载配置）
  router.post("/evict-cache", async (_req, res) => {
    try {
      // 清除 fgbg 配置缓存
      evicateFgbgUserConfigCache();
      
      // 清除日志配置缓存
      evictLoggingConfigCache();
      
      // 重新读取配置
      const cfg = readFgbgUserConfig();
      
      res.json({
        success: true,
        message: "日志配置缓存已清除并重新加载",
        logging: cfg.logging || {},
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
