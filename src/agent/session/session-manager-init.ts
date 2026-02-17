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
  const sessionDir = ensureSessionDir();
  const index = loadSessionIndex();
  const existing = index[params.sessionKey];

  let nextEntry = existing;
  let shouldWrite = false;

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
