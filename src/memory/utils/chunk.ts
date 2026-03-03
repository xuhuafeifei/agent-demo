export type TextChunk = {
  content: string;
  lineStart: number;
  lineEnd: number;
};

// 单块目标大小默认值（字符数）。
const DEFAULT_MAX_CHARS = 500;

function normalizeMaxChars(maxChars?: number): number {
  if (typeof maxChars !== "number" || !Number.isFinite(maxChars)) {
    return DEFAULT_MAX_CHARS;
  }
  const rounded = Math.floor(maxChars);
  if (rounded < 100) return 100;
  if (rounded > 4000) return 4000;
  return rounded;
}

/**
 * 将原始文本按行切块，并保留行号范围。
 * maxChars 可由配置传入（agents.memorySearch.chunkMaxChars）。
 */
export function chunkTextWithLines(raw: string, maxChars?: number): TextChunk[] {
  const max = normalizeMaxChars(maxChars);
  const lines = raw.split(/\r?\n/);
  const chunks: TextChunk[] = [];

  let start = 0;
  while (start < lines.length) {
    let end = start;
    let size = 0;

    // 按行贪心扩展，单块不超过 max（含换行）
    while (end < lines.length) {
      const candidate = lines[end] ?? "";
      if (size > 0 && size + candidate.length + 1 > max) break;
      size += candidate.length + 1;
      end += 1;
    }

    const content = lines.slice(start, end).join("\n").trim();
    if (content) {
      chunks.push({
        content,
        lineStart: start + 1, // 行号 1-based
        lineEnd: end,
      });
    }

    // 防御性推进，避免 end===start 时死循环
    if (end <= start) {
      start += 1;
    } else {
      start = end;
    }
  }

  return chunks;
}
