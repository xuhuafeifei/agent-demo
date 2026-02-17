import fs from "node:fs";
import { resolveSessionIndexPath } from "./session-path.js";
import type { SessionIndex, SessionIndexEntry } from "./types.js";

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

export function loadSessionIndexEntry(sessionKey: string): SessionIndexEntry | null {
  const index = loadSessionIndex();
  return index[sessionKey] ?? null;
}

export function initSessionState(sessionKey: string): {
  sessionId: string;
  sessionFile: string;
  entry: SessionIndexEntry;
} {
  const entry = loadSessionIndexEntry(sessionKey);
  if (!entry?.sessionId || !entry.sessionFile) {
    throw new Error("session.json missing session metadata");
  }
  return {
    sessionId: entry.sessionId,
    sessionFile: entry.sessionFile,
    entry,
  };
}
