// 字符转 TOKEN 比例
const CHARS_PER_TOKEN = 3.5;

/**
 * 估算多个文本内容的总 TOKEN 数量
 * @param texts 要估算的文本数组
 * @returns 估算的总 TOKEN 数量
 */
export function estimateTextsTotalTokens(texts: string[]): number {
  return texts.reduce((total, text) => {
    return total + estimateTextTokens(text);
  }, 0);
}

/**
 * 检查多个文本的总 Token 数是否超过阈值
 * @param texts 文本数组
 * @param maxTokens 最大 Token 数
 * @param tokenRatio 比例系数（默认 0.75）
 * @returns 是否超过阈值
 */
/**
 * 检查多个文本的总 Token 数是否超过阈值，并返回相关信息
 * @param texts 文本数组
 * @param maxTokens 最大 Token 数
 * @param tokenRatio 比例系数（默认 0.75）
 * @returns 是否超过阈值以及总 Token 数
 */
export function areTextsOverTokenThreshold(
  texts: string[],
  maxTokens: number,
  tokenRatio: number = 0.75,
): { isOver: boolean; totalTokens: number; threshold: number } {
  const totalTokens = estimateTextsTotalTokens(texts);
  const threshold = maxTokens * tokenRatio;
  return {
    isOver: totalTokens > threshold,
    totalTokens,
    threshold,
  };
}

/**
 * 估算文本内容的 TOKEN 数量
 * @param text 要估算的文本
 * @returns 估算的 TOKEN 数量
 */
export function estimateTextTokens(text: string): number {
  if (text == null || text.trim() === "") {
    return 0;
  }

  const charCount = text.length;
  return Math.ceil(charCount / CHARS_PER_TOKEN); // 字符数 ÷ 2.5，向上取整
}
