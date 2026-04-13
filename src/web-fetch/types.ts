/** 抓取结果 */
export interface FetchResult {
  url: string;          // 实际抓取的 URL
  content: string;      // Markdown 或纯文本
  statusCode: number;   // HTTP 状态码
  contentType: string;  // Content-Type 响应头
}
