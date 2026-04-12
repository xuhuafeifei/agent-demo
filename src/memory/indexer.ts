import fs from "node:fs";
import path from "node:path";
import { batchEmbeddingText } from "./embedding/embedding-provider.js";
import {
  deleteByPath,
  queryFileHash,
  listTrackedPaths,
  replacePathChunks,
} from "./store.js";
import type { MemorySource, SyncResult, SyncSummary } from "./types.js";
import { chunkTextWithLines } from "./utils/chunk.js";
import { extractSessionDialogueText } from "./utils/session-content.js";
import { sha256 } from "./utils/hash.js";
import {
  ensureDirSync,
  resolveWorkspaceMemoryDir,
  resolveWorkspaceMemoryPath,
  resolveWorkspaceUserinfoDir,
} from "./utils/path.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";
import { readFgbgUserConfig } from "../config/index.js";

// ========== 日志实例 ==========
// 所有 memory 模块的日志统一使用此 logger，带子系统标识便于过滤。
const memoryLogger = getSubsystemConsoleLogger("memory");

// ========== 耗时测量工具 ==========
// 包裹异步/同步操作，记录耗时并通过 debug 日志输出，便于性能分析。

/** 测量异步操作的耗时，返回结果值与毫秒数 */
async function measureAsync<T>(params: {
  label: string;
  meta: Record<string, unknown>;
  fn: () => Promise<T>;
}): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  try {
    const value = await params.fn();
    return { value, ms: Date.now() - started };
  } finally {
    memoryLogger.debug(
      `timing label=${params.label} costMs=${Date.now() - started} meta=${JSON.stringify(params.meta)}`,
    );
  }
}

/** 测量同步操作的耗时，返回结果值与毫秒数 */
function measureSync<T>(params: {
  label: string;
  meta: Record<string, unknown>;
  fn: () => T;
}): { value: T; ms: number } {
  const started = Date.now();
  try {
    const value = params.fn();
    return { value, ms: Date.now() - started };
  } finally {
    memoryLogger.debug(
      ` timing label=${params.label} costMs=${Date.now() - started} meta=${JSON.stringify(params.meta)}`,
    );
  }
}

// ========== 来源类型推断 ==========
/**
 * 根据路径推断来源类型，用于缺省 source 的场景。
 * 与 memory.ts 映射一致：workspace 的 MEMORY.md → memory；用户 memory 目录 → MEMORY.md；userinfo → userinfo。
 *
 * tenantId 在此用于解析各类型目录的实际磁盘路径，确保不同租户的路径隔离。
 */
function detectSourceByPath(tenantId: string, filePath: string): MemorySource {
  const normalized = path.resolve(filePath);
  if (filePath.endsWith(".jsonl")) return "sessions";
  if (normalized === path.resolve(resolveWorkspaceMemoryPath(tenantId))) return "memory";
  const userinfoDir = path.resolve(resolveWorkspaceUserinfoDir(tenantId));
  const userinfoPrefix = userinfoDir + path.sep;
  if (normalized.startsWith(userinfoPrefix)) return "userinfo";
  const workspaceMem = path.resolve(resolveWorkspaceMemoryDir(tenantId));
  if (
    normalized.startsWith(workspaceMem + path.sep) ||
    normalized === workspaceMem
  ) {
    return "MEMORY.md";
  }
  return "memory";
}

// ========== 单路径同步入口 ==========
/**
 * 同步单个路径的索引。
 *
 * 【同步规则——状态机】
 * 1. 文件已删除 + 数据库有历史 hash → action=delete，调用 deleteByPath 清理该路径下所有 chunk 和 embedding 向量。
 * 2. 文件已删除 + 数据库无历史 hash → action=skip，从未索引过的新文件被删除，无需操作。
 * 3. 文件存在 + hash 与数据库一致 → action=skip，内容未变，跳过切分和 embedding 以节省 API 调用。
 * 4. 文件存在 + hash 不同（或首次索引）→ 执行完整 pipeline：
 *    a. 读取文件内容
 *    b. 若 source 为 sessions，先做对话清洗（仅保留 role+正文）
 *    c. 按 chunkMaxChars 切块
 *    d. 批量生成 embedding 向量
 *    e. 调用 replacePathChunks 原子替换该路径的所有 chunk（含新 hash 落库）
 *    最终 action 根据是否有旧 hash 判定为 "create" 或 "rebuild"。
 *
 * 【tenantId 隔离机制】
 * tenantId 贯穿整个调用链，所有数据库操作都以 tenantId 为前缀/分区键：
 * - queryFileHash(tenantId, filePath) → 只查询该租户下的 hash 记录
 * - deleteByPath(tenantId, filePath)  → 只删除该租户下的索引
 * - replacePathChunks(tenantId, ...)   → 只写入该租户下的 chunk/向量
 * 因此即使两个租户有同名文件，索引数据也完全隔离。
 */
export async function syncMemoryByPath(tenantId: string, params: {
  path: string;
  source?: MemorySource;
}): Promise<SyncResult> {
  const started = Date.now();
  const filePath = path.resolve(params.path);
  const source = params.source ?? detectSourceByPath(tenantId, filePath);
  const metaBase = { path: filePath, source };

  // Step 1: 检查文件是否在磁盘上存在
  const { value: exists } = measureSync({
    label: "check_exists",
    meta: metaBase,
    fn: () => fs.existsSync(filePath),
  });

  // Step 2: 查询数据库中该租户下此路径的历史 hash（tenantId 隔离）
  const { value: existingHash } = await measureAsync({
    label: "query_file_hash",
    meta: metaBase,
    fn: () => queryFileHash(tenantId, filePath),
  });

  // 规则 1 & 2：文件已删除——有历史则 delete 清理，否则 skip
  if (!exists) {
    if (existingHash) {
      await measureAsync({
        label: "delete_index",
        meta: metaBase,
        fn: () => deleteByPath(tenantId, filePath),
      });
      return {
        path: filePath,
        action: "delete",
        chunkCount: 0,
        costMs: Date.now() - started,
      };
    }
    return {
      path: filePath,
      action: "skip",
      chunkCount: 0,
      costMs: Date.now() - started,
    };
  }

  // Step 3: 读取文件内容并计算新 hash
  const { value: content } = measureSync({
    label: "read_file",
    meta: metaBase,
    fn: () => fs.readFileSync(filePath, "utf8"),
  });
  const nextHash = sha256(content);

  // 规则 3：hash 未变 → skip，避免重复切块和 embedding 调用
  if (existingHash && existingHash === nextHash) {
    return {
      path: filePath,
      action: "skip",
      chunkCount: 0,
      costMs: Date.now() - started,
    };
  }

  // 规则 4：内容变化或首次索引 → 执行完整 pipeline

  // Step 4a: 内容预处理——session 文件需清洗，只保留 role+对话正文
  const { value: textToChunk } = measureSync({
    label: "normalize",
    meta: metaBase,
    fn: () =>
      source === "sessions" ? extractSessionDialogueText(content) : content,
  });

  // Step 4b: 从用户配置读取切块大小上限
  const { value: chunkMaxChars } = measureSync({
    label: "load_cfg",
    meta: metaBase,
    fn: () => readFgbgUserConfig().agents.memorySearch.chunkMaxChars,
  });

  // Step 4c: 文本切块——按行边界切分，每块不超过 chunkMaxChars
  const { value: chunks } = measureSync({
    label: "chunk",
    meta: metaBase,
    fn: () => chunkTextWithLines(textToChunk, chunkMaxChars),
  });

  // Step 4d: 批量 embedding——将所有 chunk 的 content 转为向量
  const { value: embeddings } = await measureAsync({
    label: "embed",
    meta: { ...metaBase, chunks: chunks.length },
    fn: () => batchEmbeddingText(chunks.map((c) => c.content)),
  });

  // Step 4e: 原子写入——replacePathChunks 先删除该路径旧 chunk，再批量写入新 chunk + embeddings + hash
  // tenantId 确保数据写入正确的租户分区
  const { value: count } = await measureAsync({
    label: "write_db",
    meta: { ...metaBase, chunks: chunks.length },
    fn: () =>
      replacePathChunks(tenantId, {
        path: filePath,
        source,
        fileHash: nextHash,
        chunks,
        embeddings,
      }),
  });

  // 根据是否有旧 hash 判定 create 还是 rebuild
  const action: SyncResult["action"] = existingHash ? "rebuild" : "create";
  memoryLogger.debug(
    ` syncMemoryByPath done action=${action} totalMs=${Date.now() - started} source=${source} path=${filePath} chunks=${count}`,
  );
  return {
    path: filePath,
    action,
    chunkCount: count,
    costMs: Date.now() - started,
  };
}

// ========== 目录扫描工具 ==========
/** 列出目录下所有 Markdown 文件（当前不递归子目录，仅扫描顶层 .md） */
function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
    )
    .map((entry) => path.join(dir, entry.name)); // 仅顶层 .md，不递归
}

/** 列出目录下所有会话文件（*.jsonl，仅顶层） */
function listJsonlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl"),
    )
    .map((entry) => path.join(dir, entry.name)); // 会话文件，仅顶层
}

// ========== 全量同步入口 ==========
/**
 * 全量同步所有 memory 来源。
 *
 * 【tenantId 数据隔离】
 * - 所有目录解析函数（resolveWorkspaceMemoryDir / resolveWorkspaceMemoryPath / resolveWorkspaceUserinfoDir）
 *   均接受 tenantId 参数，返回该租户专属的磁盘路径。
 * - listTrackedPaths(tenantId) 只列出该租户下已跟踪的路径。
 * - 后续每个 syncMemoryByPath 调用都传入 tenantId，确保所有数据库操作限定在租户分区内。
 *
 * 【候选文件收集——三类来源】
 * 1. workspace MEMORY.md：resolveWorkspaceMemoryPath(tenantId) 返回的路径，标记为 source="memory"
 * 2. 用户 memory 目录下的 .md 文件：resolveWorkspaceMemoryDir(tenantId) 下的所有顶层 .md，标记为 source="MEMORY.md"
 * 3. userinfo 目录下的 .md 文件：resolveWorkspaceUserinfoDir(tenantId) 下的所有顶层 .md，标记为 source="userinfo"
 * 4. 会话目录下的 .jsonl 文件（sessionDir 可选传入），标记为 source="sessions"
 *
 * 【已跟踪路径清理机制】
 * 数据库维护了一份"已跟踪路径列表"（tracked paths），通过 listTrackedPaths(tenantId) 获取。
 * 本轮扫描不到的已跟踪路径 = 用户已删除或移走 → 这些路径被加入 candidates Map，
 * 后续 syncMemoryByPath 检测到文件不存在且有历史 hash，会执行 action=delete 清理。
 * 这确保了已删除文件的索引不会残留。
 *
 * 【去重】使用 Map<path, source> 以绝对路径为 key，天然去重。
 */
export async function syncAllMemorySources(
  tenantId: string,
  sessionDir?: string,
): Promise<SyncSummary> {
  const started = Date.now();

  // 确保租户的 memory 和 userinfo 目录存在（按 tenantId 隔离）
  ensureDirSync(resolveWorkspaceMemoryDir(tenantId));
  ensureDirSync(resolveWorkspaceUserinfoDir(tenantId));

  // 收集本轮候选文件——四类来源，均以 tenantId 解析目录
  const workspaceMemory = resolveWorkspaceMemoryPath(tenantId);
  const userMemoryFiles = listMarkdownFiles(resolveWorkspaceMemoryDir(tenantId));
  const userinfoFiles = listMarkdownFiles(resolveWorkspaceUserinfoDir(tenantId));
  const sessionFiles = sessionDir ? listJsonlFiles(sessionDir) : [];

  memoryLogger.debug("syncAllMemorySources: workspaceMemory", {
    workspaceMemory,
  });
  memoryLogger.debug("syncAllMemorySources: userMemoryFiles", {
    userMemoryFiles,
  });
  memoryLogger.debug("syncAllMemorySources: userinfoFiles", {
    userinfoFiles,
  });
  memoryLogger.debug("syncAllMemorySources: sessionFiles", { sessionFiles });

  // 构建候选 Map：key=绝对路径，value=来源类型
  const candidates = new Map<string, MemorySource>();
  candidates.set(path.resolve(workspaceMemory), "memory"); // 工作区 MEMORY.md 路径 → memory
  for (const p of userMemoryFiles) candidates.set(path.resolve(p), "MEMORY.md"); // 用户 memory 目录 → MEMORY.md
  for (const p of userinfoFiles) candidates.set(path.resolve(p), "userinfo");
  for (const p of sessionFiles) candidates.set(path.resolve(p), "sessions");

  memoryLogger.debug("syncAllMemorySources: candidates", { candidates });

  // 关键：将历史已跟踪但本轮未扫描到的路径加入候选
  // 这些文件大概率已被删除，syncMemoryByPath 会对它们执行 delete 清理
  for (const tracked of await listTrackedPaths(tenantId)) {
    if (!candidates.has(path.resolve(tracked))) {
      candidates.set(path.resolve(tracked), detectSourceByPath(tenantId, tracked));
    }
  }

  // 初始化计数器
  const summary: SyncSummary = {
    total: 0,
    create: 0,
    rebuild: 0,
    delete: 0,
    skip: 0,
    failed: 0,
    durationMs: 0,
  };

  // 逐个同步：每个路径调用 syncMemoryByPath(tenantId, ...)，tenantId 确保数据隔离
  for (const [filePath, source] of candidates.entries()) {
    summary.total += 1;
    try {
      const start = Date.now();
      const result = await syncMemoryByPath(tenantId, { path: filePath, source });
      memoryLogger.info(
        ` syncMemoryByPath done action=${result.action} totalMs=${Date.now() - start} source=${source} path=${filePath} chunks=${result.chunkCount}`,
      );
      summary[result.action] += 1;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      memoryLogger.warn(` sync failed: ${filePath} - ${message}`);
      // 单文件失败不影响其余，继续下一路径
    }
  }

  summary.durationMs = Date.now() - started;
  return summary;
}
