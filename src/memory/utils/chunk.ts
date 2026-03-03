export type TextChunk = {
  content: string;
  lineStart: number;
  lineEnd: number;
};

// 单块目标大小（字符数），用于折中召回粒度与上下文长度。
const MAX_CHARS = 800;

/**
 * 将原始文本按行切块，并保留行号范围。
 */
export function chunkTextWithLines(raw: string): TextChunk[] {
  const lines = raw.split(/\r?\n/);
  const chunks: TextChunk[] = [];

  let start = 0;
  while (start < lines.length) {
    let end = start;
    let size = 0;

    // 按行贪心扩展，单块不超过 MAX_CHARS（含换行）
    while (end < lines.length) {
      const candidate = lines[end] ?? "";
      if (size > 0 && size + candidate.length + 1 > MAX_CHARS) break;
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
