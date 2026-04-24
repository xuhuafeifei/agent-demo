import fs from "node:fs";
import { getGlobalModelConfigPath } from "../pi-embedded-runner/model-config.js";
import type {
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@mariozechner/pi-ai";
import {
  SessionManager,
  type SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";
import { loadSessionIndexEntry, resolveSessionDir } from "../session/index.js";
import { clearLaneHistory, loadLane } from "../../lane/lane-store.js";
import type { AgentHookEvent, AgentLane } from "../../hook/events.js";
import type { BaseHook } from "../../hook/base-hook.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { getFilterContextToolNames } from "../tool/tool-bundle.js";

// Agent 运行时辅助函数专用日志记录器
const agentLogger = getSubsystemConsoleLogger("agent");

/**
 * 默认历史消息限制数量（前端 API 消费时使用）
 */
const DEFAULT_HISTORY_LIMIT = 20;

/**
 * 路由决策时使用的最近用户输入数量
 */
const ROUTER_RECENT_USER_COUNT = 5;

/**
 * 按优先级升序执行 Agent 钩子
 *
 * 工具阶段与 prompt 阶段共用同一 hooks Set；
 * 各钩子实现类在 onEvent 开头按 event.kind 早退即可，不会串台。
 *
 * @param hooks - 要执行的钩子集合
 * @param event - 钩子事件对象
 * @param options - 执行选项，logErrors 表示是否记录错误（默认不记录）
 */
export async function invokeAgentHooks(
  hooks: Iterable<BaseHook<AgentHookEvent>>,
  event: AgentHookEvent,
  options?: { logErrors?: boolean },
): Promise<void> {
  // 按优先级升序排序钩子（priority 越小优先级越高）
  const sorted = [...hooks].sort((a, b) => a.priority() - b.priority());

  for (const h of sorted) {
    if (options?.logErrors) {
      try {
        await h.onEvent(event);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        agentLogger.warn(`hook failed name=${h.name} error=${msg}`, error);
      }
    } else {
      await h.onEvent(event);
    }
  }
}

/**
 * 生成默认的 main 会话键
 *
 * 会话键格式：session:main:<lane>:<tenantId>
 *
 * @param tenantId - 租户 ID
 * @param lane - 执行通道，默认 heavy（重量级）
 * @returns 格式化后的会话键
 */
export function defaultMainSessionKey(
  tenantId: string,
  lane: AgentLane = "heavy",
): string {
  return `session:main:${lane}:${tenantId}`;
}

/**
 * 打印当前租户的运行时路径信息（调试用）
 *
 * 输出全局配置路径、会话索引路径和会话文件路径
 *
 * @param tenantId - 租户 ID
 */
export function logRuntimePaths(tenantId: string): void {
  const sessionKey = defaultMainSessionKey(tenantId);
  agentLogger.info(`全局配置路径: ${getGlobalModelConfigPath()}`);
  const entry = loadSessionIndexEntry(tenantId, sessionKey);
  agentLogger.info(`会话索引路径: ${resolveSessionDir(tenantId)}/session.json`);
  agentLogger.info(`会话文件路径: ${entry?.sessionFile ?? "未创建"}`);
}

/**
 * 获取指定租户的 session 消息列表（内部用，用于构建对话历史上下文）
 *
 * 从会话文件中读取消息条目，并过滤出类型为 "message" 的条目
 *
 * @param tenantId - 租户 ID
 * @param sessionKey - 会话键
 * @returns 会话消息条目数组
 */
/**
 * 获取指定租户的 session 消息列表（内部用，用于构建对话历史上下文）
 *
 * 从会话文件中读取消息条目，并过滤出类型为 "message" 的条目
 *
 * @param tenantId - 租户 ID
 * @param sessionKey - 会话键
 * @returns 会话消息条目数组
 */
export function getSessionMessageEntrys(
  tenantId: string,
  sessionKey: string,
): SessionMessageEntry[] {
  // 1. 从会话索引中获取会话文件路径
  const entry = loadSessionIndexEntry(tenantId, sessionKey);
  if (!entry?.sessionFile) return [];
  if (!fs.existsSync(entry.sessionFile)) return [];

  // 2. 打开会话文件
  const sessionManager = SessionManager.open(
    entry.sessionFile,
    resolveSessionDir(tenantId),
  );
  const entries = sessionManager.getEntries();

  // 3. 过滤出类型为 "message" 的条目
  return entries.filter(
    (entryItem): entryItem is SessionMessageEntry =>
      entryItem.type === "message",
  );
}

/**
 * 获取会话文件的修改时间（用于判断会话活跃度）
 *
 * @param tenantId - 租户 ID
 * @param sessionKey - 会话键
 * @returns 会话文件的修改时间戳（毫秒），文件不存在时返回 0
 */
function sessionFileMtimeMs(tenantId: string, sessionKey: string): number {
  const entry = loadSessionIndexEntry(tenantId, sessionKey);
  if (!entry?.sessionFile || !fs.existsSync(entry.sessionFile)) return 0;
  try {
    return fs.statSync(entry.sessionFile).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 从 session 条目中抽取 user 角色的纯文本行（与 pruneSessionChat 同样跳过 context tool）
 *
 * 用于路由决策时获取用户输入特征
 *
 * @param messages - 会话消息条目数组
 * @returns 抽取的用户纯文本输入数组
 */
/**
 * 从 session 条目中抽取 user 角色的纯文本行（与 pruneSessionChat 同样跳过 context tool）
 *
 * 用于路由决策时获取用户输入特征
 *
 * @param messages - 会话消息条目数组
 * @returns 抽取的用户纯文本输入数组
 */
function collectUserTextLinesFromSessionMessages(
  messages: SessionMessageEntry[],
): string[] {
  const filterToolNames = getFilterContextToolNames();
  const lines: string[] = [];

  // 遍历所有会话消息
  for (const msg of messages) {
    const raw = msg.message as {
      role?: string;
      content?: (TextContent | ThinkingContent | ToolCall)[];
      toolName?: string;
    };

    // 只处理 user 角色的消息
    if (raw.role !== "user") continue;

    const toolName = raw.toolName ?? "";
    // 跳过需要从上下文过滤的工具消息
    if (filterToolNames.includes(toolName)) continue;

    // 提取纯文本内容
    const textParts = extractTextPartsFromContent(raw.content);
    if (textParts.length > 0) lines.push(textParts.join("\n"));
  }

  return lines;
}

/**
 * 供 lane 路由使用：读取 main 模块下 light/heavy 两个会话，取「最近更活跃」一侧末尾的用户输入
 *
 * 最多 ROUTER_RECENT_USER_COUNT 条（时间顺序为会话文件内从旧到新）
 *
 * @param tenantId - 租户 ID
 * @returns 最近用户输入数组，用于路由决策
 */
/**
 * 供 lane 路由使用：读取 main 模块下 light/heavy 两个会话，取「最近更活跃」一侧末尾的用户输入
 *
 * 最多 ROUTER_RECENT_USER_COUNT 条（时间顺序为会话文件内从旧到新）
 *
 * @param tenantId - 租户 ID
 * @returns 最近用户输入数组，用于路由决策
 */
export function getRecentUserInputsForRouter(tenantId: string): string[] {
  const heavyKey = defaultMainSessionKey(tenantId, "heavy");
  const lightKey = defaultMainSessionKey(tenantId, "light");

  // 获取 heavy 和 light 两个 lane 的用户输入历史
  const heavyLines = collectUserTextLinesFromSessionMessages(
    getSessionMessageEntrys(tenantId, heavyKey),
  );
  const lightLines = collectUserTextLinesFromSessionMessages(
    getSessionMessageEntrys(tenantId, lightKey),
  );

  // 获取两个 lane 的会话活跃度（通过文件修改时间判断）
  const mHeavy = sessionFileMtimeMs(tenantId, heavyKey);
  const mLight = sessionFileMtimeMs(tenantId, lightKey);

  // 确定主辅会话：最近活跃的会话为主会话
  const [primary, secondary] =
    mHeavy >= mLight ? [heavyLines, lightLines] : [lightLines, heavyLines];

  // 从主会话获取最近的用户输入
  const out = primary.slice(-ROUTER_RECENT_USER_COUNT);

  // 若主会话输入不足，则从辅会话补充
  if (out.length >= ROUTER_RECENT_USER_COUNT || secondary.length === 0) {
    return out;
  }
  const need = ROUTER_RECENT_USER_COUNT - out.length;
  return [...secondary.slice(-need), ...out];
}

/**
 * 从消息内容中提取纯文本部分
 *
 * 通用的消息内容解析函数，用于从包含多种类型内容的消息中提取纯文本
 *
 * @param content - 消息内容数组（包含 TextContent、ThinkingContent、ToolCall 等类型）
 * @returns 提取的纯文本内容数组
 */
function extractTextPartsFromContent(
  content?: (TextContent | ThinkingContent | ToolCall)[],
): string[] {
  const textParts: string[] = [];

  // 检查内容是否为数组类型
  if (Array.isArray(content)) {
    // 遍历内容数组，筛选出纯文本类型的内容
    for (const block of content) {
      // 只提取类型为 text、内容为非空字符串的部分
      if (
        block?.type === "text" &&
        typeof block.text === "string" &&
        block.text.trim()
      ) {
        textParts.push(block.text.trim());
      }
    }
  }

  return textParts;
}

/**
 * 获取指定租户的对话历史（前端 API 消费）
 *
 * 从 lane 文件中读取统一时间线，返回格式化后的对话历史。
 *
 * @param tenantId - 租户 ID
 * @param laneKey - lane 键，默认使用 main 模块的 lane
 * @returns 格式化后的对话历史数组
 */
export function getHistory(
  tenantId: string,
  laneKey: string = `lane:main:${tenantId}`,
): Array<{
  role: string;
  content: string;
  timestamp?: number;
}> {
  const events = loadLane(tenantId, laneKey);
  const filtered = events.filter(
    (e) => e.role === "user" || e.role === "assistant",
  );
  const recent = filtered.slice(-DEFAULT_HISTORY_LIMIT);

  return recent.map((e) => ({
    role: e.role,
    content: e.content,
    timestamp: e.timestamp,
  }));
}

/**
 * 清除指定租户的对话历史
 *
 * 删除 lane 文件，下次对话时将创建新 lane
 *
 * @param tenantId - 租户 ID
 * @param laneKey - lane 键，默认使用 main 模块的 lane
 */
export function clearHistory(
  tenantId: string,
  laneKey: string = `lane:main:${tenantId}`,
): void {
  clearLaneHistory(tenantId, laneKey);
}

/**
 * 从 session 消息列表剪枝，返回格式化的对话历史文本（用于主链路 prompt 上下文）
 *
 * 格式："user: ...\n\nassistant: ..."
 * 会跳过需要从上下文过滤的工具消息
 *
 * @param messages - 会话消息条目数组
 * @returns 格式化后的对话历史文本
 */
export function pruneSessionChat(messages: SessionMessageEntry[]): string {
  const selected: string[] = [];
  const filterToolNames = getFilterContextToolNames();

  // 遍历所有消息
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    const raw = msg.message as {
      role?: string;
      content?: (TextContent | ThinkingContent | ToolCall)[];
      toolName?: string;
    };
    const role = raw.role ?? "unknown";
    const toolName = raw.toolName ?? "";

    // 跳过需要从上下文过滤的工具消息
    if (filterToolNames.includes(toolName)) continue;

    // 提取纯文本内容
    const textParts = extractTextPartsFromContent(raw.content);
    if (textParts.length > 0) {
      selected.push(`${role}: ${textParts.join("\n")}`);
    }
  }

  // 反转消息顺序（最新的消息在最后）
  return selected.reverse().join("\n\n");
}
