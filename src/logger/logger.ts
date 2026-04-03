import fs from "node:fs";
import path from "node:path";
import { format } from "node:util";
import { readFgbgUserConfig } from "../config/index.js";

export type LoggingLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "silent";
export type ConsoleStyle = "pretty" | "common" | "json";

export type LoggingConfig = {
  cacheTime: number; // seconds
  level: LoggingLevel; // file level
  file: string; // template path: /tmp/fgbg/fgbg-YYYY-MM-DD.log
  consoleLevel: LoggingLevel;
  consoleStyle: ConsoleStyle;
  allowModule: string[]; // empty means allow all subsystem logs
};

export type Logger = {
  trace: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  fatal: (message: string, ...args: unknown[]) => void;
};

const MAX_LOG_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const LOG_RETENTION_DAYS = 7;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1h

const LEVEL_WEIGHT: Record<LoggingLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 70,
};

type CacheState = {
  config: LoggingConfig;
  expireAt: number;
} | null;

let loggingCache: CacheState = null;
let rootLogger: Logger | null = null;
var subsystemFileLoggers: Map<string, Logger> | undefined = new Map<
  string,
  Logger
>();
var subsystemConsoleLoggers: Map<string, Logger> | undefined = new Map<
  string,
  Logger
>();
let lastCleanupAt = 0;

function getCachedOrLoadConfig(): LoggingConfig {
  const now = Date.now();
  if (loggingCache && now < loggingCache.expireAt) {
    return loggingCache.config;
  }
  const cfg = ensureLoggingSetting();
  loggingCache = { config: cfg, expireAt: now + cfg.cacheTime * 1000 };
  return cfg;
}

/**
 * 清除日志配置缓存，强制下次读取时重新加载配置
 */
export function evictLoggingConfigCache(): void {
  loggingCache = null;
}

function toDateText(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toTimestampText(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}.${ms}`;
}

function resolveLogPath(template: string, now: Date): string {
  return template.replace(/YYYY-MM-DD/g, toDateText(now));
}

function shouldLog(level: LoggingLevel, minLevel: LoggingLevel): boolean {
  if (minLevel === "silent") return false;
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minLevel];
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function splitPath(filePath: string): {
  dir: string;
  name: string;
  ext: string;
} {
  return {
    dir: path.dirname(filePath),
    name: path.basename(filePath, path.extname(filePath)),
    ext: path.extname(filePath),
  };
}

function resolveWritableLogPath(basePath: string): string {
  const { dir, name, ext } = splitPath(basePath);
  let index = 0;
  while (true) {
    const candidate =
      index === 0
        ? path.join(dir, `${name}${ext}`)
        : path.join(dir, `${name}-${index}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    try {
      const stat = fs.statSync(candidate);
      if (stat.size < MAX_LOG_FILE_SIZE_BYTES) return candidate;
    } catch {
      return candidate;
    }
    index += 1;
  }
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maybeCleanupExpiredLogs(logTemplate: string, now: Date): void {
  const nowMs = now.getTime();
  if (nowMs - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = nowMs;

  try {
    const { dir } = splitPath(logTemplate);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const expireBefore = nowMs - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const baseTemplateName = path.basename(logTemplate);
    const regexText =
      "^" +
      escapeRegExp(baseTemplateName).replace(
        "YYYY-MM-DD",
        "(\\d{4}-\\d{2}-\\d{2})",
      ) +
      "(?:-\\d+)?" +
      "$";
    const familyRegex = new RegExp(regexText);

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const matched = entry.name.match(familyRegex);
      if (!matched) continue;
      const dateText = matched[1];
      if (!dateText) continue;
      const dayTime = new Date(`${dateText}T00:00:00.000Z`).getTime();
      if (Number.isNaN(dayTime)) continue;
      if (dayTime >= expireBefore) continue;
      const fullPath = path.join(dir, entry.name);
      fs.unlinkSync(fullPath);
    }
  } catch {
    // 清理失败不影响主链路写日志。
  }
}

function writeFileLog(
  basePath: string,
  line: string,
  now: Date,
  logTemplate: string,
): void {
  maybeCleanupExpiredLogs(logTemplate, now);
  const filePath = resolveWritableLogPath(basePath);
  ensureParentDir(filePath);
  fs.appendFileSync(filePath, `${line}\n`, { mode: 0o600 });
}

function withAnsi(colorCode: number, text: string): string {
  return `\u001b[${colorCode}m${text}\u001b[0m`;
}

function formatConsoleLine(params: {
  style: ConsoleStyle;
  ts: string;
  level: LoggingLevel;
  subsystem?: string;
  message: string;
}): string {
  const { style, ts, level, subsystem, message } = params;

  if (style === "json") {
    return JSON.stringify({
      time: ts,
      level,
      ...(subsystem ? { subsystem } : {}),
      message,
    });
  }

  const base = subsystem
    ? `[${ts}] [${level.toUpperCase()}] [${subsystem}] ${message}`
    : `[${ts}] [${level.toUpperCase()}] ${message}`;
  if (style === "common") return base;

  const colorMap: Record<LoggingLevel, number> = {
    trace: 90,
    debug: 36,
    info: 32,
    warn: 33,
    error: 31,
    fatal: 35,
    silent: 37,
  };
  return withAnsi(colorMap[level], base);
}

export function ensureLoggingSetting(): LoggingConfig {
  const cfg = readFgbgUserConfig();
  return {
    cacheTime: cfg.logging.cacheTimeSecond,
    level: cfg.logging.level,
    file: cfg.logging.file,
    consoleLevel: cfg.logging.consoleLevel,
    consoleStyle: cfg.logging.consoleStyle,
    allowModule: cfg.logging.allowModule,
  };
}

function createLogger(params: {
  subsystem?: string;
  withConsole: boolean;
}): Logger {
  const { subsystem, withConsole } = params;

  const emit = (level: LoggingLevel, message: string, ...args: unknown[]) => {
    const cfg = getCachedOrLoadConfig();
    const now = new Date();
    const text = args.length > 0 ? format(message, ...args) : message;
    const ts = toTimestampText(now);
    const normalizedSubsystem = subsystem?.trim().toLowerCase();

    // allowModule 只作用于子系统日志；主 logger 不受限制。
    if (normalizedSubsystem) {
      const allowed = cfg.allowModule;
      if (
        allowed.length > 0 &&
        !allowed.includes("*") &&
        !allowed.includes(normalizedSubsystem)
      ) {
        return;
      }
    }

    const fileLine = subsystem
      ? `[${ts}] [${level.toUpperCase()}] [${subsystem}] ${text}`
      : `[${ts}] [${level.toUpperCase()}] ${text}`;

    if (shouldLog(level, cfg.level)) {
      try {
        writeFileLog(resolveLogPath(cfg.file, now), fileLine, now, cfg.file);
      } catch {
        // 日志系统错误不影响业务主链路。
      }
    }

    if (withConsole && shouldLog(level, cfg.consoleLevel)) {
      const line = formatConsoleLine({
        style: cfg.consoleStyle,
        ts,
        level,
        subsystem,
        message: text,
      });
      if (level === "warn") console.warn(line);
      else if (level === "error" || level === "fatal") console.error(line);
      else console.log(line);
    }
  };

  return {
    trace: (message, ...args) => emit("trace", message, ...args),
    debug: (message, ...args) => emit("debug", message, ...args),
    info: (message, ...args) => emit("info", message, ...args),
    warn: (message, ...args) => emit("warn", message, ...args),
    error: (message, ...args) => emit("error", message, ...args),
    fatal: (message, ...args) => emit("fatal", message, ...args),
  };
}

export function getLogger(): Logger {
  if (!rootLogger) {
    rootLogger = createLogger({ withConsole: false });
  }
  return rootLogger;
}

export function getSubsystemLogger(subsystem: string): Logger {
  subsystemFileLoggers ??= new Map<string, Logger>();
  const key = subsystem.trim() || "app";
  const hit = subsystemFileLoggers.get(key);
  if (hit) return hit;
  const logger = createLogger({ subsystem: key, withConsole: false });
  subsystemFileLoggers.set(key, logger);
  return logger;
}

export function getSubsystemConsoleLogger(subsystem: string): Logger {
  subsystemConsoleLoggers ??= new Map<string, Logger>();
  const key = subsystem.trim() || "app";
  const hit = subsystemConsoleLoggers.get(key);
  if (hit) return hit;
  const logger = createLogger({ subsystem: key, withConsole: true });
  subsystemConsoleLoggers.set(key, logger);
  return logger;
}
