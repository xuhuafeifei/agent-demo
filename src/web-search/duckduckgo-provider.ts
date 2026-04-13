import type { SearchProvider } from './provider.js';
import type { SearchRequest, SearchResponse } from './types.js';

const ENDPOINT = 'https://html.duckduckgo.com/html/';
const TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 10;

/**
 * DuckDuckGo HTML 搜索 Provider
 * 无需 API key，通过 POST 表单查询，解析返回的 HTML 提取结果
 */
export function createDuckDuckGoProvider(_apiKey?: string): SearchProvider {
  return {
    async search({ query, limit }: SearchRequest): Promise<SearchResponse> {
      const count = Math.min(limit ?? DEFAULT_LIMIT, 50);

      // POST 表单请求，body 为 q=关键词
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ q: query }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const html = await response.text();

      return { query, results: parseResults(html, count) };
    },
  };
}

/** 从 DuckDuckGo HTML 中解析搜索结果 */
function parseResults(html: string, limit: number): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // 每条结果在 <div class="result"> 块中
  const resultBlocks = html.split('<div class="result');
  // 跳过第一个空块（split 产生的头部）
  for (let i = 1; i < resultBlocks.length && results.length < limit; i++) {
    const block = resultBlocks[i];

    // 提取标题：h2.result__title > a.result__a 的文本
    const titleMatch = block.match(/class="result__a"[^>]*>([^<]*)<\/a>/);
    if (!titleMatch) continue;
    const title = decodeHTMLEntity(titleMatch[1].trim());

    // 提取 URL：从 a.result__url 的 href 中提取 uddg 参数
    // href 格式: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F...
    const urlMatch = block.match(/class="result__url"[^>]*href="([^"]*)"/);
    if (!urlMatch) continue;
    const rawUrl = urlMatch[1];
    const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/);
    if (!uddgMatch) continue;
    const url = decodeURIComponent(uddgMatch[1]);

    // 提取摘要：a.result__snippet 的文本
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = snippetMatch ? decodeHTMLEntity(snippetMatch[1].trim().replace(/\s+/g, ' ')) : '';

    results.push({ title, url, snippet });
  }

  return results;
}

/** 解码 HTML 实体（&amp; &lt; &gt; 等） */
function decodeHTMLEntity(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
