import { getUserFgbgConfig } from "../utils/app-path.js";
import type { FgbgUserConfig } from "../types.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";

export type HeartbeatConfig = {
  enabled: boolean;
  intervalMs: number;
  concurrency: number;
  allowedScripts: string[];
};

const DEFAULT_CONFIG: HeartbeatConfig = {
  enabled: true,
  intervalMs: 1000,
  concurrency: 3,
  allowedScripts: [],
};

const CONCURRENCY_MIN = 1;
const CONCURRENCY_MAX = 20;
const INTERVAL_MIN_MS = 200;
const INTERVAL_MAX_MS = 60_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheState = {
  config: HeartbeatConfig;
  expireAt: number;
} | null;

let cache: CacheState = null;
const logger = getSubsystemConsoleLogger("watch-dog");

/**
 * 规范化允许的脚本列表
 * 去重、去除空白字符串、去除首尾空格
 * @param value - 原始配置值
 * @returns 规范化后的脚本列表，空列表表示不启用白名单
 */
function normalizeAllowedScripts(value: unknown): string[] {
  // 配置存在时做去重 + 去空白；默认空列表表示不启用 allowlist
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

/**
 * 规范化并发度配置
 * 将值夹紧到 [1, 20] 范围内，防止误配置
 * @param value - 原始配置值
 * @returns 规范化后的并发度
 */
function normalizeConcurrency(value: unknown): number {
  // 并发度从配置读取后夹紧到 [1,20] 防止误配
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : DEFAULT_CONFIG.concurrency;
  if (raw < CONCURRENCY_MIN) return CONCURRENCY_MIN;
  if (raw > CONCURRENCY_MAX) return CONCURRENCY_MAX;
  return raw;
}

/**
 * 规范化心跳间隔配置
 * 将值夹紧到 [200ms, 60s] 范围内，避免极端配置
 * @param value - 原始配置值
 * @returns 规范化后的心跳间隔（毫秒）
 */
function normalizeInterval(value: unknown): number {
  // interval 夹紧到 200ms~60s，避免极端配置
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : DEFAULT_CONFIG.intervalMs;
  if (raw < INTERVAL_MIN_MS) return INTERVAL_MIN_MS;
  if (raw > INTERVAL_MAX_MS) return INTERVAL_MAX_MS;
  return raw;
}

/**
 * 规范化完整的心跳配置
 * 对各个配置项进行规范化处理，并在必要时记录警告日志
 * @param raw - 用户配置中的 heartbeat 部分
 * @returns 规范化后的完整配置
 */
function normalizeConfig(raw: FgbgUserConfig["heartbeat"]): HeartbeatConfig {
  const enabled =
    typeof raw?.enabled === "boolean" ? raw.enabled : DEFAULT_CONFIG.enabled;
  const intervalMs = normalizeInterval(raw?.interval_ms);
  const concurrency = normalizeConcurrency(raw?.concurrency);
  const allowedScripts = normalizeAllowedScripts(raw?.allowedScripts);

  if (
    raw?.concurrency !== undefined &&
    (concurrency === CONCURRENCY_MIN || concurrency === CONCURRENCY_MAX) &&
    concurrency !== raw.concurrency
  ) {
    logger.warn(
      "[watch-dog] heartbeat.concurrency=%s 被夹紧到 [%s,%s]",
      String(raw.concurrency),
      CONCURRENCY_MIN,
      CONCURRENCY_MAX,
    );
  }

  if (
    raw?.interval_ms !== undefined &&
    (intervalMs === INTERVAL_MIN_MS || intervalMs === INTERVAL_MAX_MS) &&
    intervalMs !== raw.interval_ms
  ) {
    logger.warn(
      "[watch-dog] heartbeat.interval_ms=%s 被夹紧到 [%s,%s]",
      String(raw.interval_ms),
      INTERVAL_MIN_MS,
      INTERVAL_MAX_MS,
    );
  }

  return {
    enabled,
    intervalMs,
    concurrency,
    allowedScripts,
    };
}

/**
 * 获取心跳配置（带缓存）
 * 如果缓存未过期则返回缓存值，否则重新读取用户配置
 * @param now - 当前时间戳（毫秒），默认为 Date.now()
 * @returns 心跳配置对象
 */
export function getHeartbeatConfig(now: number = Date.now()): HeartbeatConfig {
  if (cache && cache.expireAt > now) {
    return cache.config;
  }
  const userCfg = getUserFgbgConfig();
  const cfg = normalizeConfig(userCfg.heartbeat);
  cache = { config: cfg, expireAt: now + CACHE_TTL_MS };
  return cfg;
}

/**
 * 清除心跳配置缓存
 * 用于配置更新后强制重新读取
 */
export function clearHeartbeatConfigCache(): void {
  cache = null;
}
