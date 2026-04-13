/** 搜索引擎供应商枚举，后续扩展 volcengine、google */
export type SearchProviderType = "duckduckgo";

/** 单条搜索结果 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 搜索请求 */
export interface SearchRequest {
  query: string;
  limit?: number; // 默认 10，最大 50
}

/** 搜索响应 */
export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

/** webSearch 配置（fgbg.json） */
export interface WebSearchConfig {
  provider: string;
  apiKey: string;
}
