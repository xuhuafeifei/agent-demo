import type { SearchRequest, SearchResponse } from './types.js';

/** 搜索 Provider 统一接口 */
export interface SearchProvider {
  search(request: SearchRequest): Promise<SearchResponse>;
}
