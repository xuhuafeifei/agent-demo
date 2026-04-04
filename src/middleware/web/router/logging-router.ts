import { Router } from "express";
import fs from "node:fs";
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

type LogEntry = {
  lineNum: number;
  level: string;
  subsystem?: string;
  message: string;
};

/**
 * 读取日志文件，按最低等级过滤后得到完整条目列表（文件内时间正序）
 */
function filterLogEntries(filePath: string, minLevel: string): LogEntry[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());

  const minWeight = LEVEL_WEIGHT[minLevel] || 0;
  const result: LogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLogLine(lines[i], i + 1);
    if (parsed && LEVEL_WEIGHT[parsed.level] >= minWeight) {
      result.push(parsed);
    }
  }

  return result;
}

/**
 * 在过滤后的列表上切片。
 * - tail=false：从前往后，与旧行为一致 slice(offset, offset+limit)
 * - tail=true：从末尾往前取，offset 表示从尾端再往前跳过多少条（0=最新一段）
 */
function sliceFilteredEntries(
  result: LogEntry[],
  offset: number,
  limit: number,
  tail: boolean,
): LogEntry[] {
  if (limit <= 0) return [];
  const n = result.length;
  if (n === 0) return [];

  if (!tail) {
    return result.slice(offset, offset + limit);
  }

  const endExclusive = n - offset;
  if (endExclusive <= 0) return [];
  const start = Math.max(0, endExclusive - limit);
  return result.slice(start, endExclusive);
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

  // GET /config/logging/entries - 分页读取（支持 tail=1 取过滤结果末尾一段，供日志查看页）
  router.get("/entries", (req, res) => {
    try {
      const level = (req.query.level as string) || "debug";
      const offset = parseInt(req.query.offset as string, 10) || 0;
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const tail =
        req.query.tail === "1" ||
        req.query.tail === "true" ||
        req.query.tail === "yes";

      const cfg = ensureLoggingSetting();
      const logPath = resolveLogPath(cfg.file, new Date());

      const filtered = filterLogEntries(logPath, level);
      const entries = sliceFilteredEntries(filtered, offset, limit, tail);

      res.json({
        success: true,
        entries,
        totalFiltered: filtered.length,
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

  // GET /config/logging/tail - 增量获取日志
  // 如果传入 lastLineNum，返回该行之后的所有日志（增量）
  // 如果不传或为 0，返回最新的 maxCount 条日志（初始化）
  router.get("/tail", (req, res) => {
    try {
      const level = (req.query.level as string) || "debug";
      // 前端传入的最后一条日志行号，如果没有则为 undefined 或 0
      const lastLineNumParam = req.query.lastLineNum;
      const lastLineNum = lastLineNumParam ? parseInt(lastLineNumParam as string, 10) : 0;
      const maxCount = parseInt(req.query.maxCount as string, 10) || 800;

      // 获取日志文件路径
      const cfg = ensureLoggingSetting();
      const logPath = resolveLogPath(cfg.file, new Date());

      webLogger.debug(
        `[config/logging/tail] Log: ${logPath}, Level: ${level}, LastLineNum: ${lastLineNum}, Max: ${maxCount}`,
      );

      const allFiltered = filterLogEntries(logPath, level);
      let resultEntries: LogEntry[] = [];
      /** 锚点行丢失时返回的是整段快照，前端应整表替换而非追加 */
      let replaced = false;

      if (lastLineNum <= 0) {
        // 初始化：取最后 maxCount 条
        resultEntries = allFiltered.slice(-maxCount);
      } else {
        // 增量获取：找到 lastLineNum 所在的位置
        const lastIndex = allFiltered.findIndex((e) => e.lineNum === lastLineNum);

        if (lastIndex !== -1) {
          // 找到了，返回之后的数据
          resultEntries = allFiltered.slice(lastIndex + 1);
        } else {
          // 没找到（可能被清理或轮转了），降级为返回最后 maxCount 条
          webLogger.warn(`[config/logging/tail] LastLineNum ${lastLineNum} not found, returning latest.`);
          replaced = true;
          resultEntries = allFiltered.slice(-maxCount);
        }
      }

      // 获取当前文件的最新行号（用于前端判断是否有新日志产生）
      const currentMaxLineNum = allFiltered.length > 0 ? allFiltered[allFiltered.length - 1].lineNum : 0;

      res.json({
        success: true,
        entries: resultEntries,
        count: resultEntries.length,
        currentMaxLineNum: currentMaxLineNum,
        replaced,
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[config/logging/tail] %s",
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
