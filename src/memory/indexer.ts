import fs from "node:fs";
import path from "node:path";
import { batchEmbeddingText } from "./embedding/embedding-provider.js";
import {
  deleteByPath,
  getFileHash,
  listTrackedPaths,
  replacePathChunks,
} from "./store.js";
import type { MemorySource, SyncResult, SyncSummary } from "./types.js";
import { getMemorySearchConfig } from "./memory-search-config.js";
import { chunkTextWithLines } from "./utils/chunk.js";
import { extractSessionDialogueText } from "./utils/session-content.js";
import { sha256 } from "./utils/hash.js";
import { getUserFgbgConfig } from "../utils/app-path.js";
import {
  ensureDirSync,
  resolveUserMemoryDir,
  resolveWorkspaceMemoryPath,
} from "./utils/path.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";

const memoryLogger = getSubsystemConsoleLogger("memory");

/**
 * 根据路径推断来源类型，用于缺省 source 的场景。
 * 与 memory.ts 映射一致：workspace 的 MEMORY.md → memory；用户 memory 目录 → MEMORY.md。
 */
function detectSourceByPath(filePath: string): MemorySource {
  const normalized = path.resolve(filePath);
  if (filePath.endsWith(".jsonl")) return "sessions";
  if (normalized === path.resolve(resolveWorkspaceMemoryPath())) return "memory";
  if (normalized.startsWith(path.resolve(resolveUserMemoryDir()) + path.sep)) return "MEMORY.md";
  return "memory";
}

/**
 * 同步单个路径。
 *
 * 规则：
 * - 文件消失且已索引 -> delete
 * - hash 不变 -> skip
 * - 新文件 -> create
 * - hash 变化 -> rebuild
 */
export async function syncMemoryByPath(params: {
  path: string;
  source?: MemorySource;
}): Promise<SyncResult> {
  const started = Date.now();
  const filePath = path.resolve(params.path);
  const source = params.source ?? detectSourceByPath(filePath);

  const exists = fs.existsSync(filePath);
  const existingHash = await getFileHash(filePath);

  // 文件已删除：有历史索引则 delete 清理，否则 skip
  if (!exists) {
    if (existingHash) {
      await deleteByPath(filePath);
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

  const content = fs.readFileSync(filePath, "utf8");
  const nextHash = sha256(content);

  // hash 未变则 skip，避免重复切块和 embedding
  if (existingHash && existingHash === nextHash) {
    return {
      path: filePath,
      action: "skip",
      chunkCount: 0,
      costMs: Date.now() - started,
    };
  }

  // 内容有变化：session 先清洗（只保留 role+对话正文），再切块 -> embedding
  const textToChunk =
    source === "sessions" ? extractSessionDialogueText(content) : content;
  const chunkMaxChars = getMemorySearchConfig(
    getUserFgbgConfig(),
  ).chunkMaxChars;
  const chunks = chunkTextWithLines(textToChunk, chunkMaxChars);
  const embeddings = await batchEmbeddingText(chunks.map((c) => c.content));
  const count = await replacePathChunks({
    path: filePath,
    source,
    fileHash: nextHash,
    chunks,
    embeddings,
  });

  return {
    path: filePath,
    action: existingHash ? "rebuild" : "create",
    chunkCount: count,
    costMs: Date.now() - started,
  };
}

/**
 * 列出目录下所有 Markdown 文件（当前不递归子目录）。
 */
function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
    )
    .map((entry) => path.join(dir, entry.name)); // 仅顶层 .md，不递归
}

/**
 * 列出目录下所有会话文件（*.jsonl）。
 */
function listJsonlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl"),
    )
    .map((entry) => path.join(dir, entry.name)); // 会话文件，仅顶层
}

/**
 * 全量同步入口：
 * - 汇总候选文件（workspace + memory + sessions）
 * - 补充历史已跟踪路径（用于清理已删除文件）
 * - 逐个执行 syncMemoryByPath 并汇总结果
 */
export async function syncAllMemorySources(
  sessionDir?: string,
): Promise<SyncSummary> {
  const started = Date.now();
  ensureDirSync(resolveUserMemoryDir());

  const workspaceMemory = resolveWorkspaceMemoryPath();
  const userMemoryFiles = listMarkdownFiles(resolveUserMemoryDir());
  const sessionFiles = sessionDir ? listJsonlFiles(sessionDir) : [];

  const candidates = new Map<string, MemorySource>();
  candidates.set(path.resolve(workspaceMemory), "memory"); // 工作区 MEMORY.md 路径 → memory
  for (const p of userMemoryFiles) candidates.set(path.resolve(p), "MEMORY.md"); // 用户 memory 目录 → MEMORY.md
  for (const p of sessionFiles) candidates.set(path.resolve(p), "sessions");

  // 历史已跟踪但本轮未扫描到的路径也加入候选，以便 sync 时执行 delete
  for (const tracked of await listTrackedPaths()) {
    if (!candidates.has(path.resolve(tracked))) {
      candidates.set(path.resolve(tracked), detectSourceByPath(tracked));
    }
  }

  const summary: SyncSummary = {
    total: 0,
    create: 0,
    rebuild: 0,
    delete: 0,
    skip: 0,
    failed: 0,
    durationMs: 0,
  };

  for (const [filePath, source] of candidates.entries()) {
    summary.total += 1;
    try {
      const result = await syncMemoryByPath({ path: filePath, source });
      summary[result.action] += 1;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      memoryLogger.warn(`[memory] sync failed: ${filePath} - ${message}`);
      // 单文件失败不影响其余，继续下一路径
    }
  }

  summary.durationMs = Date.now() - started;
  return summary;
}
