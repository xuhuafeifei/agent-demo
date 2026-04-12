import fs from "node:fs";
import { resolveSessionIndexPath } from "./session-path.js";
import type { SessionIndex, SessionIndexEntry } from "./types.js";

/**
 * 加载指定租户的 session 索引文件。
 * @param tenantId 租户 ID，决定从哪个租户的 session 目录读取
 */
function loadSessionIndex(tenantId: string): SessionIndex {
  const indexPath = resolveSessionIndexPath(tenantId);
  try {
    const raw = fs.readFileSync(indexPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as SessionIndex) : {};
  } catch {
    return {};
  }
}

/**
 * 加载指定租户 session 索引中的某条记录。
 * @param tenantId 租户 ID
 * @param sessionKey session 键（如 "session:main:default"）
 */
export function loadSessionIndexEntry(
  tenantId: string,
  sessionKey: string,
): SessionIndexEntry | null {
  const index = loadSessionIndex(tenantId);
  return index[sessionKey] ?? null;
}

/**
 * 初始化会话状态，返回 sessionId 和 sessionFile。
 * 如果 session.json 中找不到对应记录，会抛出错误（需先调用 prepareBeforeSessionManager）。
 *
 * @param tenantId 租户 ID
 * @param sessionKey session 键
 */
export function initSessionState(
  tenantId: string,
  sessionKey: string,
): {
  sessionId: string;
  sessionFile: string;
  entry: SessionIndexEntry;
} {
  const entry = loadSessionIndexEntry(tenantId, sessionKey);
  if (!entry?.sessionId || !entry.sessionFile) {
    throw new Error("session.json missing session metadata");
  }
  return {
    sessionId: entry.sessionId,
    sessionFile: entry.sessionFile,
    entry,
  };
}
