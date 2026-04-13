import type { SearchProvider } from './provider.js';
import { createDuckDuckGoProvider } from './duckduckgo-provider.js';
import { readFgbgUserConfig } from '../config/index.js';

/**
 * 创建搜索 Provider
 * 读取 fgbg.json 的 webSearch 配置，返回对应 Provider 实例
 * 目前仅支持 duckduckgo，后续扩展 volcengine、google
 */
export function createSearchProvider(): SearchProvider {
  const config = readFgbgUserConfig();
  const providerType = config.webSearch?.provider ?? 'duckduckgo';
  const apiKey = config.webSearch?.apiKey ?? '';

  // 目前只支持 duckduckgo，其他类型 fallback
  if (providerType === 'duckduckgo') {
    return createDuckDuckGoProvider(apiKey);
  }

  return createDuckDuckGoProvider(apiKey);
}
