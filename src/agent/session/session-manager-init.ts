import fs from "node:fs";
import path from "node:path";
import {
  SessionManager,
  SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { resolveSessionDir, resolveSessionIndexPath } from "./session-path.js";
import type { SessionIndex, SessionIndexEntry } from "./types.js";
import { getFilterContextToolNames } from "../tool/tool-bundle.js";

// 512 KB：超过此大小的 session 文件触发轮转
const MAX_SESSION_FILE_SIZE = 512 * 1024;

type UserOrAssistantMessage = Extract<Message, { role: "user" | "assistant" }>;

function isUserOrAssistantMessage(m: AgentMessage): m is UserOrAssistantMessage {
  return m.role === "user" || m.role === "assistant";
}

/**
 * 从旧会话中获取需要保留到新轮转会话的消息（最多 10 条 user/assistant 文本消息）。
 */
function getMessagesToPreserve(oldSessionManager: SessionManager): Message[] {
  const entries = oldSessionManager.getEntries();
  const messagesToPreserve: Message[] = [];
  const filterToolNames = getFilterContextToolNames();

  for (let i = entries.length - 1; i >= 0 && messagesToPreserve.length < 10; i--) {
    const entry = entries[i];
    if (entry.type !== "message") continue;

    const message = (entry as SessionMessageEntry).message;
    if (!isUserOrAssistantMessage(message)) continue;

    const toolName =
      "toolName" in message && typeof (message as { toolName?: string }).toolName === "string"
        ? (message as { toolName: string }).toolName
        : "";
    if (filterToolNames.includes(toolName)) continue;

    messagesToPreserve.unshift(message);
  }

  return messagesToPreserve;
}

/**
 * 确保租户 session 目录存在并返回路径。
 */
function ensureSessionDir(tenantId: string): string {
  const sessionDir = resolveSessionDir(tenantId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  }
  return sessionDir;
}

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

function saveSessionIndex(tenantId: string, index: SessionIndex): void {
  const indexPath = resolveSessionIndexPath(tenantId);
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
}

function ensureSessionFile(sessionManager: SessionManager): string {
  let sessionFile = sessionManager.getSessionFile();
  if (!sessionFile) {
    sessionManager.newSession();
    sessionFile = sessionManager.getSessionFile();
  }
  if (!sessionFile) throw new Error("session file not initialized");
  return sessionFile;
}

function shouldRotateSessionFile(sessionFile: string): boolean {
  // TODO, 未来可以新增创建新会话的能力.
  // 当前自动创建新的 session, 避免 session 文件过大
  // 后续主链路存在的信息摘要功能, 会压缩 session 内容.
  // 但他会过滤掉部分没有实际含义的内容, 譬如记忆查询, 文件读取
  // 这些低价值内容不会进行压缩. 因此 session 文件整体大小会不断膨胀.
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
    contextTokens:
      typeof contextTokens === "number" ? contextTokens : (previous?.contextTokens ?? 0),
  };
}

/**
 * 在创建 SessionManager 之前完成会话目录、索引与当前会话的准备工作。
 * 若该 sessionKey 无有效会话或会话文件超过大小阈值，会新建会话并写入索引。
 *
 * @param params.tenantId 租户 ID，用于定位 session 目录和索引文件
 * @param params.sessionKey 会话键（如 "session:main:default"）
 * @param params.modelProvider 模型提供商
 * @param params.model 模型名
 * @param params.contextTokens 可选，上下文 token 数
 * @param params.cwd 当前工作目录，用于 SessionManager
 */
export function prepareBeforeSessionManager(params: {
  tenantId: string;
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
  const { tenantId } = params;
  const sessionDir = ensureSessionDir(tenantId);
  const index = loadSessionIndex(tenantId);
  const existing = index[params.sessionKey];

  let nextEntry = existing;
  let shouldWrite = false;

  if (!existing?.sessionFile || !existing.sessionId) {
    // 无已有会话，新建
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
    // 已有会话，检查是否需要轮转
    const resolvedFile = path.resolve(existing.sessionFile);
    if (shouldRotateSessionFile(resolvedFile)) {
      const oldManager = SessionManager.open(existing.sessionFile, sessionDir);
      const messagesToPreserve = getMessagesToPreserve(oldManager);
      const manager = SessionManager.create(params.cwd, sessionDir);
      const sessionFile = ensureSessionFile(manager);

      for (const message of messagesToPreserve) {
        manager.appendMessage(message);
      }

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

  if (!nextEntry) throw new Error("session entry init failed");

  if (shouldWrite || !fs.existsSync(resolveSessionIndexPath(tenantId))) {
    index[params.sessionKey] = nextEntry;
    saveSessionIndex(tenantId, index);
  }

  return {
    sessionId: nextEntry.sessionId,
    sessionFile: nextEntry.sessionFile,
    entry: nextEntry,
  };
}
