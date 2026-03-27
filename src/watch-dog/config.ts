import { readFgbgUserConfig } from "../config/index.js";

export type HeartbeatConfig = {
  enabled: boolean;
  intervalMs: number;
  concurrency: number;
  allowedScripts: string[];
};

type CacheState = {
  config: HeartbeatConfig;
  expireAt: number;
} | null;

let cache: CacheState = null;

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
  const userCfg = readFgbgUserConfig();
  const heartbeatCfg = userCfg.heartbeat as unknown as HeartbeatConfig;
  cache = { config: heartbeatCfg, expireAt: now + 5 * 60_000 }; // 5分钟缓存
  return heartbeatCfg;
}

/**
 * 清除心跳配置缓存
 * 用于配置更新后强制重新读取
 */
export function clearHeartbeatConfigCache(): void {
  cache = null;
}
