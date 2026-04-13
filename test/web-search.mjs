/**
 * 快速测试：webSearch 返回数据
 * 运行：node test/web-search.mjs
 */

const ENDPOINT = 'https://html.duckduckgo.com/html/';

const query = '上海张江天气';
const limit = 5;

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ q: query }),
  signal: AbortSignal.timeout(15_000),
}).catch(err => {
  console.error(`请求失败: ${err.message}`);
  process.exit(1);
});

if (!response.ok) {
  console.error(`HTTP ${response.status}: ${response.statusText}`);
  process.exit(1);
}

const html = await response.text();

// 解析 HTML 提取结果
const results = [];
const blocks = html.split('<div class="result');
for (let i = 1; i < blocks.length && results.length < limit; i++) {
  const block = blocks[i];
  const title = block.match(/class="result__a"[^>]*>([^<]*)<\/a>/)?.[1]?.trim() ?? '';
  const rawUrl = block.match(/class="result__url"[^>]*href="([^"]*)"/)?.[1] ?? '';
  const uddg = rawUrl.match(/[?&]uddg=([^&]+)/)?.[1];
  const url = uddg ? decodeURIComponent(uddg) : '';
  const snippetRaw = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '';
  const snippet = snippetRaw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (title && url) results.push({ title, url, snippet });
}

console.log(JSON.stringify({ query, results, count: results.length }, null, 2));
