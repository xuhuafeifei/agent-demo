import type { LaneEvent } from "../../lane/lane-types.js";

/**
 * 从 lane 的 .jsonl 原始内容中提取高价值对话文本，用于 memory 索引。
 * 只保留：
 * 1. 用户的提问（user 消息）
 * 2. Assistant 的回答（assistant 消息）
 *
 * lane 数据本身已排除工具过程与推理链，因此直接提取 content 即可。
 */
export function extractLaneDialogueText(rawJsonl: string): string {
  const lines = rawJsonl.split(/\r?\n/).filter((line) => line.trim());
  const parts: string[] = [];

  for (const line of lines) {
    let row: LaneEvent;
    try {
      row = JSON.parse(line) as LaneEvent;
    } catch {
      continue;
    }

    if (!row.role || !row.content) continue;
    if (row.role !== "user" && row.role !== "assistant") continue;

    const text = row.content.trim();
    if (text) {
      parts.push(`${row.role}: ${text}`);
    }
  }

  return parts.join("\n\n");
}
