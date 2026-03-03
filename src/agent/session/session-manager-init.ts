import fs from "node:fs";
import path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { resolveSessionDir, resolveSessionIndexPath } from "./session-path.js";
import type { SessionIndex, SessionIndexEntry } from "./types.js";

const MAX_SESSION_FILE_SIZE = 4 * 1024;

function ensureSessionDir(): string {
  const sessionDir = resolveSessionDir();
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  }
  return sessionDir;
}

function loadSessionIndex(): SessionIndex {
  const indexPath = resolveSessionIndexPath();
  try {
    const raw = fs.readFileSync(indexPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as SessionIndex) : {};
  } catch {
    return {};
  }
}

function saveSessionIndex(index: SessionIndex): void {
  const indexPath = resolveSessionIndexPath();
  const nextContent = `${JSON.stringify(index, null, 2)}\n`;
  fs.writeFileSync(indexPath, nextContent, { mode: 0o600 });
}

function ensureSessionFile(sessionManager: SessionManager): string {
  let sessionFile = sessionManager.getSessionFile();
  if (!sessionFile) {
    sessionManager.newSession();
    sessionFile = sessionManager.getSessionFile();
  }
  if (!sessionFile) {
    throw new Error("session file not initialized");
  }
  return sessionFile;
}

function shouldRotateSessionFile(sessionFile: string): boolean {
  try {
    const stat = fs.statSync(sessionFile);
    return stat.size > MAX_SESSION_FILE_SIZE;
  } catch {
    return true;
  }
}

function createSessionEntry(params: {
  sessionKey: string;
  sessionId: string;
  sessionFile: string;
  modelProvider: string;
  model: string;
  contextTokens?: number;
  previous?: SessionIndexEntry;
}): SessionIndexEntry {
  const { sessionId, sessionFile, modelProvider, model, contextTokens, previous } = params;
  return {
    sessionId,
    updatedAt: Date.now(),
    sessionFile,
    inputTokens: previous?.inputTokens ?? 0,
    outputTokens: previous?.outputTokens ?? 0,
    totalTokens: previous?.totalTokens ?? 0,
    modelProvider,
    model,
    contextTokens: typeof contextTokens === "number" ? contextTokens : previous?.contextTokens ?? 0,
  };
}

/**
 * 在创建 SessionManager 之前完成会话目录、索引与当前会话的准备工作。
 * 若该 sessionKey 无有效会话或会话文件超过大小阈值，会新建会话并写入索引；
 * 否则复用已有会话信息。
 *
 * @param params.sessionKey - 会话键，用于在索引中唯一标识该会话
 * @param params.modelProvider - 模型提供商
 * @param params.model - 模型名
 * @param params.contextTokens - 可选，上下文 token 数
 * @param params.cwd - 当前工作目录，用于 SessionManager
 * @returns 当前会话的 sessionId、sessionFile 及索引条目
 */
export function prepareBeforeSessionManager(params: {
  sessionKey: string;
  modelProvider: string;
  model: string;
  contextTokens?: number;
  cwd: string;
}): {
  sessionId: string;
  sessionFile: string;
  entry: SessionIndexEntry;
} {
  // 确保会话根目录存在（不存在则创建，权限 0o700）
  const sessionDir = ensureSessionDir();
  // 从磁盘加载会话索引（sessionKey -> SessionIndexEntry）
  const index = loadSessionIndex();
  const existing = index[params.sessionKey];

  let nextEntry = existing;
  let shouldWrite = false;

  // 无已有会话或缺少 sessionFile/sessionId 时，创建新会话
  if (!existing?.sessionFile || !existing.sessionId) {
    const manager = SessionManager.create(params.cwd, sessionDir);
    const sessionFile = ensureSessionFile(manager);
    nextEntry = createSessionEntry({
      sessionKey: params.sessionKey,
      sessionId: manager.getSessionId(),
      sessionFile,
      modelProvider: params.modelProvider,
      model: params.model,
      contextTokens: params.contextTokens,
      previous: existing,
    });
    shouldWrite = true;
  } else {
    // 已有会话时，检查会话文件是否超过大小阈值需要轮转
    const resolvedFile = path.resolve(existing.sessionFile);
    if (shouldRotateSessionFile(resolvedFile)) {
      const manager = SessionManager.create(params.cwd, sessionDir);
      const sessionFile = ensureSessionFile(manager);
      nextEntry = createSessionEntry({
        sessionKey: params.sessionKey,
        sessionId: manager.getSessionId(),
        sessionFile,
        modelProvider: params.modelProvider,
        model: params.model,
        contextTokens: params.contextTokens,
        previous: existing,
      });
      shouldWrite = true;
    }
  }

  if (!nextEntry) {
    throw new Error("session entry init failed");
  }

  // 有新条目或索引文件不存在时，写回索引
  if (shouldWrite || !fs.existsSync(resolveSessionIndexPath())) {
    index[params.sessionKey] = nextEntry;
    saveSessionIndex(index);
  }

  return {
    sessionId: nextEntry.sessionId,
    sessionFile: nextEntry.sessionFile,
    entry: nextEntry,
  };
}
