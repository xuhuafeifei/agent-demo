/**
 * 从 session 的 .jsonl 原始内容中提取高价值对话文本，用于 memory 索引。
 * 只保留：
 * 1. 用户的提问（user 消息）
 * 2. Assistant 的回答（assistant 消息的 text 块）
 *
 * 过滤掉所有中间过程：
 * - thinking（思考过程）
 * - toolCall（工具调用）
 * - toolResult（工具结果）
 * - 其他非对话内容
 */
export function extractSessionDialogueText(rawJsonl: string): string {
  const lines = rawJsonl.split(/\r?\n/).filter((line) => line.trim());
  const parts: string[] = [];

  for (const line of lines) {
    let row: {
      type?: string;
      message?: {
        role?: string;
        content?: unknown[] | string;
      };
    };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      continue;
    }

    // 只处理 message 类型
    if (row.type !== "message" || !row.message) {
      continue;
    }

    const message = row.message;
    const role = message.role;

    // 1. 用户提问：保留纯文本内容
    if (role === "user") {
      const texts: string[] = [];
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          const b = block as { type?: string; text?: string };
          if (
            b.type === "text" &&
            typeof b.text === "string" &&
            b.text.trim()
          ) {
            texts.push(b.text.trim());
          }
        }
      } else if (message.content !== undefined) {
        const contentStr = String(message.content);
        if (contentStr.trim()) {
          texts.push(contentStr.trim());
        }
      }
      if (texts.length > 0) {
        parts.push(`user: ${texts.join("\n")}`);
      }
    }

    // 2. Assistant 回答：只保留 text 块，过滤掉 thinking、toolCall 等中间过程
    if (role === "assistant" && Array.isArray(message.content)) {
      const texts: string[] = [];
      for (const block of message.content) {
        const b = block as { type?: string; text?: string };
        // 只保留 text 类型的块
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          texts.push(b.text.trim());
        }
      }
      if (texts.length > 0) {
        parts.push(`assistant: ${texts.join("\n")}`);
      }
    }

    // 其他类型（toolResult、thinking 等）全部过滤掉
  }

  return parts.join("\n\n");
}
