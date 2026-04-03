import { randomUUID } from "node:crypto";

/**
 * OAuth session state for Qwen Portal device flow.
 */
export type QwenOAuthSession = {
  verifier: string;
  deviceCode: string;
  expiresAt: number;
  intervalMs: number;
};

/**
 * OAuth session storage interface.
 * Default implementation uses in-memory Map; can be replaced with Redis/SQLite.
 */
export interface OAuthSessionStore {
  get(sessionId: string): QwenOAuthSession | undefined;
  set(sessionId: string, session: QwenOAuthSession): void;
  delete(sessionId: string): void;
}

/**
 * Default in-memory OAuth session store.
 */
export class InMemoryOAuthSessionStore implements OAuthSessionStore {
  private sessions = new Map<string, QwenOAuthSession>();

  get(sessionId: string): QwenOAuthSession | undefined {
    return this.sessions.get(sessionId);
  }

  set(sessionId: string, session: QwenOAuthSession): void {
    this.sessions.set(sessionId, session);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Clean up expired sessions.
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }
}

/**
 * Global OAuth session store (default: in-memory).
 */
export const oauthSessionStore = new InMemoryOAuthSessionStore();

/**
 * Create a new OAuth session with expiry cleanup.
 */
export function createOAuthSession(
  verifier: string,
  deviceCode: string,
  expiresInSec: number,
  intervalSec: number,
): string {
  // Cleanup expired sessions
  oauthSessionStore.cleanup();

  const oauthSessionId = randomUUID();
  const expiresAt = Date.now() + expiresInSec * 1000;
  const intervalMs = Math.max(1000, Math.round(intervalSec * 1000));

  oauthSessionStore.set(oauthSessionId, {
    verifier,
    deviceCode,
    expiresAt,
    intervalMs,
  });

  // Auto-delete after expiry
  setTimeout(() => {
    oauthSessionStore.delete(oauthSessionId);
  }, expiresInSec * 1000 + 60_000);

  return oauthSessionId;
}
