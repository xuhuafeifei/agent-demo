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
import { ToolRegister } from "../tool/tool-register.js";

// 512 KB
const MAX_SESSION_FILE_SIZE = 512 * 1024;

/** User / assistant LLM messages only (excludes toolResult and agent custom roles). */
type UserOrAssistantMessage = Extract<Message, { role: "user" | "assistant" }>;

function isUserOrAssistantMessage(
  m: AgentMessage,
): m is UserOrAssistantMessage {
  return m.role === "user" || m.role === "assistant";
}

/**
 * 从旧会话中获取需要保留到新的轮转会话中的消息。
 * 过滤规则：
 * 1. 只要 role 为 user 和 assistant 的消息
 * 2. 只要 text 内容（忽略 toolResult 等）
 * 3. 过滤掉 toolRegister 中 getFilterContextToolNames() 返回的工具相关消息
 */
function getMessagesToPreserve(oldSessionManager: SessionManager): Message[] {
  const entries = oldSessionManager.getEntries();

  // 从后向前收集最多 10 条符合条件的消息
  const messagesToPreserve: Message[] = [];

  for (
    let i = entries.length - 1;
    i >= 0 && messagesToPreserve.length < 10;
    i--
  ) {
    const entry = entries[i];

    // 只处理 message 类型的条目
    if (entry.type !== "message") {
      continue;
    }

    const message = (entry as SessionMessageEntry).message;
    if (!isUserOrAssistantMessage(message)) {
      continue;
    }
    // 过滤掉 toolRegister 中 getFilterContextToolNames() 返回的工具相关消息
    const toolName =
      "toolName" in message &&
      typeof (message as { toolName?: string }).toolName === "string"
        ? (message as { toolName: string }).toolName
        : "";
    if (
      ToolRegister.getInstance().getFilterContextToolNames().includes(toolName)
    ) {
      continue;
    }

    messagesToPreserve.unshift(message);
  }

  return messagesToPreserve;
}

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
  const {
    sessionId,
    sessionFile,
    modelProvider,
    model,
    contextTokens,
    previous,
  } = params;
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
      typeof contextTokens === "number"
        ? contextTokens
        : (previous?.contextTokens ?? 0),
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
      // 打开旧会话管理器以读取消息
      const oldManager = SessionManager.open(existing.sessionFile, sessionDir);

      // 获取需要保留的消息
      const messagesToPreserve = getMessagesToPreserve(oldManager);

      // 创建新会话
      const manager = SessionManager.create(params.cwd, sessionDir);
      const sessionFile = ensureSessionFile(manager);

      // 将旧消息复制到新会话
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
