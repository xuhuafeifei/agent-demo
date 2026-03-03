/**
 * 从 session 的 .jsonl 原始内容中提取纯对话文本，用于 memory 索引。
 * 只保留 type===message 的 role + content 中的 text，去掉 JSON 结构、thinking、usage 等噪声。
 */
export function extractSessionDialogueText(rawJsonl: string): string {
  const lines = rawJsonl.split(/\r?\n/).filter((line) => line.trim());
  const parts: string[] = [];

  for (const line of lines) {
    let row: { type?: string; message?: { role?: string; content?: unknown[] } };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      continue;
    }
    if (row.type !== "message" || !row.message?.content || !Array.isArray(row.message.content)) {
      continue;
    }

    const role = row.message.role === "assistant" ? "assistant" : "user";
    const texts: string[] = [];
    for (const block of row.message.content) {
      const b = block as { type?: string; text?: string };
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        texts.push(b.text.trim());
      }
    }
    if (texts.length === 0) continue;
    parts.push(`${role}: ${texts.join("\n")}`);
  }

  return parts.join("\n\n");
}
