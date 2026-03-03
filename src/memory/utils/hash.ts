import crypto from "node:crypto";

/**
 * 计算文本 SHA256，用于文件内容变更判定。
 */
export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
