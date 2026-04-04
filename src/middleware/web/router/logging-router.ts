import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { getSubsystemConsoleLogger, evictLoggingConfigCache, ensureLoggingSetting, resolveLogPath } from "../../../logger/logger.js";
import {
  readFgbgUserConfig,
  writeFgbgUserConfig,
  evicateFgbgUserConfigCache,
} from "../../../config/index.js";

const webLogger = getSubsystemConsoleLogger("web");

// 日志等级权重映射
const LEVEL_WEIGHT: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 70,
};

/**
 * 解析日志行，提取等级、模块和行号
 */
function parseLogLine(line: string, lineNum: number): { lineNum: number; level: string; subsystem?: string; message: string } | null {
  // 匹配格式: [2026-03-29 12:00:00.000] [INFO] [subsystem] message
  // 或: [2026-03-29 12:00:00.000] [INFO] message
  const match = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\](?:\s+\[([^\]]+)\])?\s+(.*)$/);
  if (!match) return null;

  return {
    lineNum,
    level: match[2].toLowerCase(),
    subsystem: match[3] || undefined,
    message: match[4],
  };
}

/**
 * 读取日志文件并返回符合条件的日志行
 */
function readLogLines(filePath: string, minLevel: string, offset: number, limit: number): { lineNum: number; level: string; subsystem?: string; message: string }[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());

  const minWeight = LEVEL_WEIGHT[minLevel] || 0;
  const result: { lineNum: number; level: string; subsystem?: string; message: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLogLine(lines[i], i + 1);
    if (parsed && LEVEL_WEIGHT[parsed.level] >= minWeight) {
      result.push(parsed);
    }
  }

  // 返回 offset 之后的 limit 条记录
  return result.slice(offset, offset + limit);
}

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

  // GET /config/logging/entries - 读取日志条目（支持分页和等级过滤）
  router.get("/entries", (req, res) => {
    try {
      const level = (req.query.level as string) || "debug";
      const offset = parseInt(req.query.offset as string, 10) || 0;
      const limit = parseInt(req.query.limit as string, 10) || 20;

      // 获取日志文件路径
      const cfg = ensureLoggingSetting();
      const logPath = resolveLogPath(cfg.file, new Date());
      
      webLogger.debug(`[config/logging/entries] Reading logs from: ${logPath}, level: ${level}, offset: ${offset}, limit: ${limit}`);

      const entries = readLogLines(logPath, level, offset, limit);

      webLogger.debug(`[config/logging/entries] Found ${entries.length} entries`);

      res.json({
        success: true,
        entries,
        total: entries.length,
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[config/logging/entries] %s",
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
