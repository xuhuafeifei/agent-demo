import fs from "node:fs";
import path from "node:path";
import { ensureAgentDir } from "../utils/agent-path";
import type { SessionMessage, SessionSnapshot } from "./types";

const DEFAULT_SESSION_ID = "main";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseSnapshot(
  raw: string,
  fallbackSessionId: string,
): SessionSnapshot {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {
        sessionId: fallbackSessionId,
        updatedAt: Date.now(),
        messages: [],
      };
    }

    const messages = Array.isArray(parsed.messages)
      ? (parsed.messages.filter(isRecord) as SessionMessage[])
      : [];

    return {
      sessionId:
        typeof parsed.sessionId === "string" && parsed.sessionId.trim()
          ? parsed.sessionId
          : fallbackSessionId,
      updatedAt:
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      messages,
    };
  } catch {
    return {
      sessionId: fallbackSessionId,
      updatedAt: Date.now(),
      messages: [],
    };
  }
}

export function createSessionManager(sessionId: string = DEFAULT_SESSION_ID) {
  const agentDir = ensureAgentDir();
  const sessionDir = path.join(agentDir, "session");
  const sessionFile = path.join(sessionDir, `${sessionId}.json`);

  // 初始化时确保会话目录存在，避免首次写入失败。
  fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

  function loadMessages(): SessionMessage[] {
    if (!fs.existsSync(sessionFile)) return [];
    const raw = fs.readFileSync(sessionFile, "utf-8");
    return parseSnapshot(raw, sessionId).messages;
  }

  function saveMessages(messages: SessionMessage[]): void {
    const snapshot: SessionSnapshot = {
      sessionId,
      updatedAt: Date.now(),
      messages,
    };

    // 原子写：先写临时文件，再替换，减少异常中断导致的文件损坏。
    const tempFile = `${sessionFile}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(snapshot, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(tempFile, sessionFile);
  }

  function clearMessages(): void {
    if (!fs.existsSync(sessionFile)) return;
    fs.unlinkSync(sessionFile);
  }

  return {
    sessionId,
    sessionDir,
    sessionFile,
    loadMessages,
    saveMessages,
    clearMessages,
  };
}

export type SessionManager = ReturnType<typeof createSessionManager>;
