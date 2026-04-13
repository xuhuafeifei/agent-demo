import type { FetchResult } from './types.js';

const TIMEOUT_MS = 10_000;
const MAX_CONTENT_LENGTH = 50_000;

/**
 * 抓取指定 URL 的内容，转换为 Markdown/纯文本返回
 * - text/html: 去除 HTML 标签，保留文本结构
 * - text/markdown|plain: 直接使用
 * - 其他: 返回原始文本
 */
export async function fetchUrl(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'Accept': 'text/html, text/markdown, text/plain, */*' },
  });

  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();

  // 根据 Content-Type 决定处理方式
  let content: string;
  if (contentType.includes('text/html')) {
    // HTML → 简易文本转换（去除标签、清理空白）
    content = htmlToText(rawText);
  } else {
    // 其他文本类型直接使用
    content = rawText;
  }

  // 截断，避免过长内容撑爆 context
  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH) + '\n\n[内容已截断]';
  }

  return {
    url,
    content,
    statusCode: response.status,
    contentType,
  };
}

/**
 * HTML → 纯文本的简易转换
 * 去除 script/style 标签 → 去除所有 HTML 标签 → 清理多余空白
 * 后续可替换为 html-to-text 等库以获得更好的 Markdown 输出
 */
function htmlToText(html: string): string {
  return html
    // 去除 script/style 内容
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // 块级元素转为换行
    .replace(/<(?:br|p|div|li|tr|h[1-6]|blockquote|pre)[^>]*>/gi, '\n')
    // 去除所有剩余标签
    .replace(/<[^>]+>/g, '')
    // 解码常见 HTML 实体
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // 清理多余空白（保留换行，但去除行首行尾空格和连续空行）
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n\n');
}
