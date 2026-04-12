import { getLoadablePath } from "sqlite-vec";
import fs from "node:fs";
import { ensureMemoryPaths, resolveMemoryDbPath } from "./utils/path.js";
import { resolveSharedDir, resolveSharedEmbeddingCacheDbPath } from "../utils/app-path.js";
import type { MemorySource } from "./types.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";
import { readFgbgUserConfig } from "../config/index.js";

type ChunkRow = {
  id: number;
  source: MemorySource;
  path: string;
  chunk_content: string;
  line_start: number;
  line_end: number;
};

type DbLike = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...args: unknown[]) => { lastInsertRowid?: number | bigint };
    get: (...args: unknown[]) => Record<string, unknown> | undefined;
    all: (...args: unknown[]) => Array<Record<string, unknown>>;
  };
  enableLoadExtension: (enabled: boolean) => void;
  loadExtension: (path: string) => void;
  close: () => void;
};

// ============================================================
// 整体架构说明
// ============================================================
// 本模块实现记忆系统的持久化存储，分为两层：
// 1. 租户级数据库（tenant-isolated）：
//    - 每个 tenantId 对应独立的 SQLite 文件（~/.fgbg/memory/<tenantId>/memory.db）
//    - 包含 files、chunks、chunks_fts、chunks_vec 四张表
//    - 存储各租户的代码文件索引、分块内容、全文检索和向量检索能力
//    - 通过 dbInstances Map 按租户复用连接，避免重复初始化
//
// 2. 全局共享 embedding 缓存（global shared cache）：
//    - 所有租户共用一个 SQLite 文件（~/.fgbg/shared/embedding-cache.db）
//    - 仅包含 embedding_cache 一张表
//    - embedding 向量是纯文本内容的函数输出（相同文本 → 相同向量），与租户无关
//    - 全局共享可提升跨租户的缓存命中率，避免重复调用 embedding API
// ============================================================
const dbInstances = new Map<string, DbLike>();
// 全局共享的 embedding 缓存数据库——embedding 向量与租户无关，全进程共用一个连接
let sharedCacheDbInstance: DbLike | null = null;
const memoryLogger = getSubsystemConsoleLogger("memory");

// Embedding 缓存条目上限，超过后淘汰最久未访问的条目
const EMBEDDING_CACHE_MAX_SIZE = 1000;

/**
 * 打开指定租户的记忆数据库（惰性初始化，按 tenantId 复用连接）。
 *
 * 职责：
 * 1. 创建/打开租户专属的 SQLite 数据库文件
 * 2. 加载 sqlite-vec 向量检索扩展
 * 3. 初始化四张核心表：
 *    - files：记录已跟踪的文件路径及其 hash，用于同步时判断文件是否变更
 *    - chunks：存储代码分块的正文内容、embedding 向量、起止行号
 *    - chunks_fts：FTS5 全文检索虚拟表，支持 BM25 关键词匹配
 *    - chunks_vec：vec0 向量检索虚拟表，支持 KNN 相似度搜索
 * 4. 检测 embedding 维度变化，如从 384 维切换到 768 维，自动重建索引
 *
 * 租户隔离机制：
 * - 每个 tenantId 有独立的数据库文件，数据完全隔离
 * - 通过 dbInstances Map 缓存连接，避免同一租户重复打开数据库
 */
async function openDb(tenantId: string): Promise<DbLike> {
  // 检查是否已存在该租户的数据库连接，有则直接复用
  const existing = dbInstances.get(tenantId);
  if (existing) return existing;

  // 从用户配置中读取当前使用的 embedding 维度（如 384 或 768）
  const embeddingDimensions =
    readFgbgUserConfig().agents.memorySearch.embeddingDimensions;

  const sqlite = await import("node:sqlite");
  // 确保租户 memory 目录存在，并初始化 embedding 模型目录
  ensureMemoryPaths(tenantId);

  // 解析租户数据库的绝对路径
  const dbPath = resolveMemoryDbPath(tenantId);
  const db = new sqlite.DatabaseSync(dbPath, {
    allowExtension: true,
  }) as unknown as DbLike;

  // 加载 sqlite-vec 扩展（用于向量检索）后立即关闭扩展加载，降低误用风险
  db.enableLoadExtension(true);
  db.loadExtension(getLoadablePath());
  db.enableLoadExtension(false);

  // WAL 模式：允许多个读者和一个写入者并发，提升查询性能
  db.exec("PRAGMA journal_mode = WAL;");
  // NORMAL 模式：平衡性能与数据安全性，崩溃时最多丢失少量事务
  db.exec("PRAGMA synchronous = NORMAL;");

  // ============================================================
  // 建表语句
  // ============================================================
  // files 表：跟踪已索引的文件，记录路径和 hash 用于增量同步
  // idx_files_path：加速按路径查询
  //
  // chunks 表：存储代码分块的核心数据
  // - source：来源类型（如 'file', 'terminal' 等）
  // - path：文件路径
  // - chunk_content：分块的文本内容
  // - embedding：序列化的 embedding 向量（JSON 数组格式的 BLOB）
  // - line_start/line_end：原始代码的起止行号
  // - 三个索引：按 source 查询、按 path 查询、按 (path, line_start, line_end) 唯一约束
  //
  // chunks_fts：FTS5 全文检索虚拟表
  // - 除了 chunk_content 外，其他列标记为 UNINDEXED（不参与倒排索引）
  // - 用于 BM25 关键词匹配
  //
  // chunks_vec：vec0 向量检索虚拟表（sqlite-vec 提供）
  // - 存储向量数据，支持 KNN 相似度搜索
  // - embedding float[N] 的维度由配置决定
  // ============================================================
  db.exec(`
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  file_hash TEXT NOT NULL,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  chunk_content TEXT NOT NULL,
  embedding BLOB,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);
CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_path_line ON chunks(path, line_start, line_end);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  source UNINDEXED,
  chunk_content,
  path UNINDEXED,
  line_start UNINDEXED,
  line_end UNINDEXED,
  id UNINDEXED
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
  id INTEGER PRIMARY KEY,
  embedding float[${embeddingDimensions}]
);
`);

  // ============================================================
  // Embedding 维度兼容性检查与迁移
  // ============================================================
  // 旧库可能是 384 维，配置切到 768 后会在查询时报维度不匹配。
  // 这里通过尝试插入一个零向量来探测当前 vec0 表的维度是否匹配配置。
  // 如果不兼容，则清空并重建向量相关索引（chunks_vec、chunks_fts、chunks），
  // 交给后续 syncAll 重新计算 embedding 并回填数据。
  if (!isVectorDimensionCompatible(db, embeddingDimensions)) {
    memoryLogger.warn(
      ` embedding dimension changed, rebuilding memory indexes with ${embeddingDimensions} dimensions`,
    );
    await reinitializeIndexesForEmbeddingDimension(db, embeddingDimensions);
  }

  // 将初始化好的数据库连接存入 Map，下次同一租户直接复用
  dbInstances.set(tenantId, db);
  return db;
}

/**
 * 打开全局共享的 embedding 缓存数据库（惰性初始化，进程内单例）。
 *
 * 为什么 embedding 缓存是全局的、与租户无关？
 * ---------------------------------------------------------
 * embedding 向量是纯文本内容的函数输出：给定相同的文本内容，无论来自哪个租户，
 * 调用同一个 embedding 模型都会产生完全相同的向量。因此：
 * 1. 租户 A 索引某段代码后缓存了 embedding，租户 B 遇到相同代码时可直接复用
 * 2. 避免每个租户重复调用 embedding API，显著降低成本和延迟
 * 3. 缓存表不包含任何租户字段或租户数据，纯文本 hash → embedding 映射
 *
 * 数据库路径：~/.fgbg/shared/embedding-cache.db
 * 表结构：仅 embedding_cache 一张表，不含任何租户记忆数据
 */
async function openSharedCacheDb(): Promise<DbLike> {
  // 检查是否已初始化全局共享数据库连接，有则直接复用（进程内单例）
  if (sharedCacheDbInstance) return sharedCacheDbInstance;

  const sqlite = await import("node:sqlite");
  // 确保 shared 目录存在（~/.fgbg/shared/）
  fs.mkdirSync(resolveSharedDir(), { recursive: true });

  // 解析共享缓存数据库的绝对路径
  const dbPath = resolveSharedEmbeddingCacheDbPath();
  const db = new sqlite.DatabaseSync(dbPath, {
    allowExtension: true,
  }) as unknown as DbLike;

  // WAL 模式 + NORMAL 同步策略（与租户数据库保持一致）
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");

  // ============================================================
  // embedding_cache 表结构
  // ============================================================
  // - text_hash：文本内容的 hash 值（唯一索引），作为缓存的 key
  // - embedding：序列化后的 embedding 向量（JSON 数组），作为缓存的 value
  // - last_access_at：最后访问时间，用于 LRU 淘汰策略
  // idx_embedding_cache_hash：加速按 text_hash 查询
  // ============================================================
  db.exec(`
CREATE TABLE IF NOT EXISTS embedding_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text_hash TEXT NOT NULL UNIQUE,
  embedding BLOB NOT NULL,
  last_access_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_hash ON embedding_cache(text_hash);
`);

  sharedCacheDbInstance = db;
  return db;
}

// ============================================================
// 辅助类型转换函数
// ============================================================

/** 将 bigint 或 number 统一转为 number（SQLite 的 lastInsertRowid 可能返回 bigint） */
function toNumber(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  return 0;
}

/** 将 SQL 查询结果行转为强类型 ChunkRow 对象，空内容兜底为空串 */
function toChunkRow(row: Record<string, unknown>): ChunkRow {
  return {
    id: Number(row.id),
    source: String(row.source) as MemorySource,
    path: String(row.path),
    chunk_content: String(row.chunk_content ?? ""),
    line_start: Number(row.line_start),
    line_end: Number(row.line_end),
  };
}

/**
 * 在事务中执行 fn：BEGIN → fn(db) → COMMIT；异常时 ROLLBACK 并重新抛出。
 *
 * 为什么需要事务？
 * ---------------------------------------------------------
 * 记忆系统的写入操作通常涉及多张表的联动（如 chunks + chunks_vec + chunks_fts + files）。
 * 如果中途某一步失败（如向量插入失败），没有事务会导致数据不一致：
 * - chunks 表写入了新记录，但 chunks_vec 没有对应向量 → 向量检索返回空
 * - chunks_fts 写入了全文索引，但 chunks 表没有对应记录 → 回表失败
 *
 * 使用事务保证 ACID 特性：
 * - 原子性：要么全部成功，要么全部回滚，不会出现半截数据
 * - 一致性：多张表之间的数据始终保持完整关联
 * - 性能：批量写入时，事务减少磁盘 I/O 次数，显著提升吞吐
 */
async function transactionCommit<T>(
  db: DbLike,
  fn: (db: DbLike) => T | Promise<T>,
): Promise<T> {
  db.exec("BEGIN"); // 开启事务
  try {
    const result = await fn(db); // 执行业务逻辑
    db.exec("COMMIT"); // 提交事务，持久化所有变更
    return result;
  } catch (error) {
    db.exec("ROLLBACK"); // 发生异常时回滚，撤销所有未提交的变更
    throw error; // 重新抛出，让调用方感知到错误
  }
}

/**
 * 检测当前 chunks_vec 表的 embedding 维度是否与配置匹配。
 *
 * 原理：构造一个全零的 N 维向量（N = 配置的维度），尝试在 chunks_vec 中执行 KNN 查询。
 * - 如果维度匹配，查询成功返回 true
 * - 如果维度不匹配（如旧库是 384 维，新配置是 768 维），sqlite-vec 会抛出异常，返回 false
 */
function isVectorDimensionCompatible(db: DbLike, dimensions: number): boolean {
  const probe = JSON.stringify(new Array<number>(dimensions).fill(0));
  try {
    db.prepare(
      `SELECT id, distance
       FROM chunks_vec
       WHERE embedding MATCH ? AND k = 1
       ORDER BY distance ASC`,
    ).all(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * 重建索引以适配新的 embedding 维度。
 *
 * 流程（在事务中执行）：
 * 1. 清空 chunks_vec（旧维度的向量数据，已无用）
 * 2. 清空 chunks_fts（全文索引，依赖 chunks 的 id）
 * 3. 清空 chunks（主数据表，embedding 列的维度已过期）
 * 4. 清空 files（文件跟踪表，因为对应的 chunks 已清空）
 * 5. 删除旧的 chunks_vec 虚拟表
 * 6. 用新维度重新创建 chunks_vec 虚拟表
 *
 * 注意：此处只清空数据并重建表结构，实际的数据回填由后续的 syncAll 负责。
 * syncAll 会重新扫描文件、计算新的 embedding、并写入所有表。
 */
async function reinitializeIndexesForEmbeddingDimension(
  db: DbLike,
  dimensions: number,
): Promise<void> {
  await transactionCommit(db, () => {
    // 清空所有向量、全文索引、分块和文件跟踪数据
    db.prepare("DELETE FROM chunks_vec").run();
    db.prepare("DELETE FROM chunks_fts").run();
    db.prepare("DELETE FROM chunks").run();
    db.prepare("DELETE FROM files").run();

    // 删除旧的 vec0 虚拟表（旧维度）
    db.exec("DROP TABLE IF EXISTS chunks_vec");
    // 用新维度重新创建 vec0 虚拟表
    db.exec(
      `CREATE VIRTUAL TABLE chunks_vec USING vec0(
         id INTEGER PRIMARY KEY,
         embedding float[${dimensions}]
       )`,
    );
  });
}

/**
 * 读取 path 对应的文件 hash。
 *
 * 租户隔离：通过 tenantId 打开对应的数据库，不同租户的数据完全隔离。
 * 用途：sync 流程通过比较文件当前 hash 与存储的 hash，判断文件是否需要重新索引。
 *
 * @returns 文件 hash 字符串，未索引过的路径返回 null（供 sync 判断 create/rebuild）
 */
export async function queryFileHash(tenantId: string, path: string): Promise<string | null> {
  const db = await openDb(tenantId);
  const row = db
    .prepare("SELECT file_hash FROM files WHERE path = ?")
    .get(path);
  // 未索引过的路径返回 null，供 sync 判断 create/rebuild
  if (!row || typeof row.file_hash !== "string") return null;
  return row.file_hash;
}

/**
 * Upsert 文件 hash（插入或更新）。
 *
 * 租户隔离：通过 tenantId 打开对应的数据库。
 * 用途：文件重新索引后更新 hash，供下次 sync 判断文件是否发生变更。
 * 使用 ON CONFLICT(path) 实现 upsert：path 不存在则插入，存在则更新 file_hash 和 update_time。
 */
export async function upsertFileHash(
  tenantId: string,
  path: string,
  fileHash: string,
): Promise<void> {
  const db = await openDb(tenantId);
  // ON CONFLICT 更新已有 path 的 hash，供下次 sync 判断是否需 rebuild
  db.prepare(
    `INSERT INTO files(path, file_hash, update_time)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(path) DO UPDATE SET
       file_hash = excluded.file_hash,
       update_time = CURRENT_TIMESTAMP`,
  ).run(path, fileHash);
}

/**
 * 列出 files 表中所有已跟踪的文件路径。
 *
 * 租户隔离：通过 tenantId 打开对应的数据库。
 * 用途：syncAll 流程获取全量已索引路径，用于对比文件系统，补全"已删文件"的 delete 候选。
 */
export async function listTrackedPaths(tenantId: string): Promise<string[]> {
  const db = await openDb(tenantId);
  const rows = db.prepare("SELECT path FROM files").all();
  return rows.map((r) => String(r.path)); // 全量已索引路径，供 syncAll 补全"已删文件"的 delete 候选
}

/**
 * 删除指定 path 的所有索引数据（chunks + chunks_vec + chunks_fts + files）。
 *
 * 租户隔离：通过 tenantId 打开对应的数据库。
 *
 * 为什么需要事务？
 * 删除操作涉及四张表的联动：
 * 1. 先查出该 path 下所有 chunk id
 * 2. 按 id 逐个删除 chunks_vec 中的向量记录
 * 3. 按 id 逐个删除 chunks_fts 中的全文索引记录
 * 4. 删除 chunks 表中的主数据
 * 5. 删除 files 表中的文件跟踪记录
 * 如果中途失败，事务确保不会出现孤儿数据或不一致的索引状态。
 */
export async function deleteByPath(tenantId: string, path: string): Promise<void> {
  const db = await openDb(tenantId);
  await transactionCommit(db, () => {
    // 先查该 path 下所有 chunk id，再按 id 删 vec/fts，避免外键或虚拟表残留孤儿记录
    const idRows = db.prepare("SELECT id FROM chunks WHERE path = ?").all(path);
    const ids = idRows.map((r) => Number(r.id));

    // 逐个删除向量索引和全文索引中的对应记录
    for (const id of ids) {
      db.prepare("DELETE FROM chunks_vec WHERE id = ?").run(BigInt(id));
      db.prepare("DELETE FROM chunks_fts WHERE id = ?").run(id);
    }

    // 删除主分块数据和文件跟踪记录
    db.prepare("DELETE FROM chunks WHERE path = ?").run(path);
    db.prepare("DELETE FROM files WHERE path = ?").run(path);
  });
}

/**
 * 全量替换某个 path 的 chunks 索引（事务）。
 *
 * 租户隔离：通过 tenantId 打开对应的数据库。
 *
 * 使用场景：文件内容发生变更后，重新解析分块并替换该文件的所有索引数据。
 *
 * 执行流程（在事务中）：
 * 1. 删除旧的向量索引（chunks_vec）和全文索引（chunks_fts）
 * 2. 删除旧的 chunks 主数据
 * 3. 逐条插入新的 chunks、chunks_vec、chunks_fts 记录
 * 4. 更新 files 表的 file_hash，供下次 sync 判断文件状态
 *
 * 为什么需要事务？
 * - 一次替换涉及 N 个 chunk × 3 张表 + 1 个 file 记录的写入
 * - 任何一步失败（如 embedding 序列化异常）都应回滚全部操作，保持索引一致性
 */
export async function replacePathChunks(tenantId: string, params: {
  path: string;
  source: MemorySource;
  fileHash: string;
  chunks: Array<{ content: string; lineStart: number; lineEnd: number }>;
  embeddings: number[][];
}): Promise<number> {
  const db = await openDb(tenantId);
  const { path, source, fileHash, chunks, embeddings } = params;
  // 校验：chunks 和 embeddings 数量必须一一对应
  if (chunks.length !== embeddings.length) {
    throw new Error("chunks and embeddings length mismatch");
  }

  return transactionCommit(db, () => {
    // ============================================================
    // 第一步：清理旧数据
    // ============================================================
    // 先查出该 path 在 chunks 表中的所有旧记录 id
    const oldRows = db
      .prepare("SELECT id FROM chunks WHERE path = ?")
      .all(path);
    // 按 id 逐个删除向量索引和全文索引中的对应记录
    for (const row of oldRows) {
      const id = Number(row.id);
      db.prepare("DELETE FROM chunks_vec WHERE id = ?").run(BigInt(id));
      db.prepare("DELETE FROM chunks_fts WHERE id = ?").run(id);
    }
    // 删除 chunks 表中的旧分块数据
    db.prepare("DELETE FROM chunks WHERE path = ?").run(path);

    // ============================================================
    // 第二步：预编译 SQL 语句（提升批量插入性能）
    // ============================================================
    const insertChunk = db.prepare(
      `INSERT INTO chunks(source, path, chunk_content, embedding, line_start, line_end, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    );
    const insertVec = db.prepare(
      "INSERT INTO chunks_vec(id, embedding) VALUES (?, ?)",
    );
    const insertFts = db.prepare(
      `INSERT INTO chunks_fts(source, chunk_content, path, line_start, line_end, id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    // ============================================================
    // 第三步：逐条插入新的分块数据
    // ============================================================
    let inserted = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const embedding = embeddings[i];

      // 插入 chunks 主表（embedding 以 JSON 字符串形式存入 BLOB 列）
      const chunkRes = insertChunk.run(
        source,
        path,
        chunk.content,
        JSON.stringify(embedding),
        chunk.lineStart,
        chunk.lineEnd,
      );
      const id = toNumber(chunkRes.lastInsertRowid);
      if (!id) continue;

      // 同一 embedding 同时写入 chunks_vec（KNN 向量检索用）和 chunks_fts（全文检索用）
      insertVec.run(BigInt(id), JSON.stringify(embedding));
      insertFts.run(
        source,
        chunk.content,
        path,
        chunk.lineStart,
        chunk.lineEnd,
        id,
      );
      inserted += 1;
    }

    // ============================================================
    // 第四步：更新 files 表的 hash，供下次 sync 判断 skip/rebuild
    // ============================================================
    db.prepare(
      `INSERT INTO files(path, file_hash, update_time)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(path) DO UPDATE SET
         file_hash = excluded.file_hash,
         update_time = CURRENT_TIMESTAMP`,
    ).run(path, fileHash);

    return inserted; // 返回成功插入的分块数量
  });
}

/**
 * FTS 全文检索查询（按 BM25 相关性升序排名）。
 *
 * 租户隔离：通过 tenantId 打开对应的数据库，不同租户的检索结果完全隔离。
 *
 * 查询原理：
 * - 使用 FTS5 虚拟表的 MATCH 语法进行关键词匹配
 * - bm25() 函数计算每个匹配文档的 BM25 相关性得分（分数越低相关性越高）
 * - 按 bm25_score ASC 排序，取 topK 条结果
 *
 * 异常处理：用户输入的查询可能包含非法 FTS 语法（如未闭合的引号、特殊操作符），
 * 此时 FTS5 会抛出 SQL 异常。捕获后返回空结果，避免崩溃。
 *
 * @returns 按相关性排序的 { id, rank } 列表，rank 为 1-based 顺序号
 */
export async function queryFts(
  tenantId: string,
  query: string,
  topK: number,
): Promise<Array<{ id: number; rank: number }>> {
  const db = await openDb(tenantId);
  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = db
      .prepare(
        `SELECT id, bm25(chunks_fts) AS bm25_score
         FROM chunks_fts
         WHERE chunks_fts MATCH ?
         ORDER BY bm25_score ASC
         LIMIT ?`,
      )
      .all(query, topK);
  } catch {
    // 用户输入可能触发非法 FTS 语法，捕获后返回空结果，避免崩溃
    rows = [];
  }

  return rows.map((row, idx) => ({ id: Number(row.id), rank: idx + 1 })); // rank 为 1-based 顺序号
}

/**
 * 向量检索查询（sqlite-vec KNN 最近邻搜索）。
 *
 * 租户隔离：通过 tenantId 打开对应的数据库，不同租户的检索结果完全隔离。
 *
 * 查询原理：
 * - 使用 sqlite-vec 扩展的 MATCH 语法进行向量相似度匹配
 * - embedding MATCH ? 将查询向量与库中所有向量计算距离
 * - k = ? 限制返回最近邻的数量（topK）
 * - distance 为余弦距离或欧氏距离（取决于 embedding 模型），值越小越相似
 *
 * @returns 按相似度排序的 { id, rank } 列表，rank 按距离升序 1-based
 */
export async function queryVector(
  tenantId: string,
  embedding: number[],
  topK: number,
): Promise<Array<{ id: number; rank: number }>> {
  const db = await openDb(tenantId);
  const rows = db
    .prepare(
      `SELECT id, distance
       FROM chunks_vec
       WHERE embedding MATCH ? AND k = ?
       ORDER BY distance ASC`,
    )
    .all(JSON.stringify(embedding), topK);

  return rows.map((row, idx) => ({ id: Number(row.id), rank: idx + 1 })); // rank 按距离升序 1-based
}

/**
 * 通过 id 列表批量回表获取 chunk 元数据。
 *
 * 租户隔离：通过 tenantId 打开对应的数据库。
 *
 * 使用场景：queryFts 或 queryVector 返回的只是 id 列表和排名，
 * 需要调用此函数回表 chunks 表获取完整的 chunk 信息（source、path、内容、行号等），
 * 供 recall 流程拼装成 MemoryHit 对象返回给上层。
 *
 * SQL 优化：使用 IN 子句 + 动态占位符实现批量查询，避免 N 次单独查询。
 */
export async function getChunksByIds(tenantId: string, ids: number[]): Promise<ChunkRow[]> {
  if (ids.length === 0) return [];
  const db = await openDb(tenantId);
  // 构造动态占位符列表，如 [?, ?, ?] 对应 3 个 id
  const placeholders = ids.map(() => "?").join(",");
  // 批量回表拿 chunk 元数据，供 recall 拼成 MemoryHit
  const rows = db
    .prepare(
      `SELECT id, source, path, chunk_content, line_start, line_end
       FROM chunks
       WHERE id IN (${placeholders})`,
    )
    .all(...ids);
  return rows.map(toChunkRow);
}

/**
 * 关闭指定租户的记忆数据库连接（用于服务停止或资源释放）。
 *
 * 租户隔离：仅关闭传入 tenantId 对应的数据库连接。
 * 关闭后从 dbInstances Map 中移除，下次调用 openDb 时会重新打开数据库文件。
 */
export async function closeMemoryDb(tenantId: string): Promise<void> {
  const db = dbInstances.get(tenantId);
  if (db) {
    db.close();
    dbInstances.delete(tenantId); // 移除缓存，供下次重新 openDb
  }
}

/**
 * 查询 embedding 缓存（使用全局共享数据库，与租户无关）。
 *
 * 缓存命中流程：
 * 1. 通过文本内容的 hash 值查找缓存（相同内容 → 相同 hash → 相同 embedding）
 * 2. 命中时更新 last_access_at 时间戳（用于 LRU 淘汰策略）
 * 3. 反序列化 JSON 字符串为 embedding 向量数组
 *
 * 为什么与租户无关？
 * embedding 是纯文本的函数输出，不同租户的相同文本会产生相同的 embedding，
 * 因此全局共享缓存可以跨租户复用，显著提升缓存命中率。
 *
 * @returns 缓存的 embedding 向量数组，未命中或解析失败返回 null
 */
export async function queryEmbeddingCache(
  textHash: string,
): Promise<number[] | null> {
  const db = await openSharedCacheDb();
  // 按 text_hash 查找缓存
  const row = db
    .prepare("SELECT embedding FROM embedding_cache WHERE text_hash = ?")
    .get(textHash);
  if (!row || !row.embedding) return null;

  // 缓存命中：更新 last_access_at，标记为"最近使用"，延缓被淘汰
  db.prepare(
    "UPDATE embedding_cache SET last_access_at = CURRENT_TIMESTAMP WHERE text_hash = ?",
  ).run(textHash);

  // 反序列化 JSON 字符串为 embedding 向量数组
  try {
    return JSON.parse(String(row.embedding));
  } catch {
    return null; // 解析失败（数据损坏），返回 null 供调用方重新计算
  }
}

/**
 * 淘汰最不常用的 embedding 缓存条目（基于 LRU 策略）。
 *
 * 淘汰逻辑说明：
 * - 缓存上限：EMBEDDING_CACHE_MAX_SIZE = 1000 条
 * - 淘汰策略：LRU（Least Recently Used，最近最少使用）
 *   按 last_access_at 升序排序，最早访问的条目最先被淘汰
 * - 淘汰数量：当前总数 - 上限 = 需要淘汰的条目数
 *
 * 为什么选择 LRU 而非 LFU（Least Frequently Used）？
 * - LRU 只需要维护 last_access_at 一个时间戳字段
 * - LFU 需要额外的访问计数器，增加写入开销（每次查询都要 +1）
 * - 对于 embedding 缓存，时间局部性（最近用过的可能还会用）比频率更重要
 */
async function evictOldEmbeddingCacheEntries(db: DbLike): Promise<void> {
  // 查询当前缓存总数
  const countResult = db
    .prepare("SELECT COUNT(*) as count FROM embedding_cache")
    .get();
  memoryLogger.info(
    `[cache-evict] current embedding cache count: ${countResult?.count || 0}`,
  );
  const currentCount = Number(countResult?.count || 0);

  // 未超过限制，无需淘汰
  if (currentCount <= EMBEDDING_CACHE_MAX_SIZE) {
    return;
  }

  // 计算需要淘汰的条目数（超出部分）
  const entriesToEvict = currentCount - EMBEDDING_CACHE_MAX_SIZE;

  // 查找最近最少使用的条目（按 last_access_at 升序，越早访问的越靠前）
  const oldEntries = db
    .prepare(
      "SELECT id FROM embedding_cache ORDER BY last_access_at ASC LIMIT ?",
    )
    .all(entriesToEvict);

  if (oldEntries.length > 0) {
    const idsToDelete = oldEntries.map((row) => Number(row.id));

    // 批量删除最不常用的条目（使用 IN 子句一次性删除）
    const placeholders = idsToDelete.map(() => "?").join(",");
    db.prepare(`DELETE FROM embedding_cache WHERE id IN (${placeholders})`).run(
      ...idsToDelete,
    );

    memoryLogger.info(
      `[cache-evict] evicted ${idsToDelete.length} old embedding cache entries`,
    );
  }
}

/**
 * 写入 embedding 缓存，并在超过限制时淘汰最不常用的条目（使用全局共享数据库）。
 *
 * 写入流程：
 * 1. 使用 ON CONFLICT(text_hash) 实现 upsert：
 *    - text_hash 不存在：插入新缓存条目
 *    - text_hash 已存在：更新 embedding 和 last_access_at
 * 2. 写入后检查总数，超过 EMBEDDING_CACHE_MAX_SIZE 则触发淘汰
 *
 * @param textHash 文本内容的 hash 值（缓存的 key）
 * @param embedding 计算得到的 embedding 向量数组（缓存的 value）
 */
export async function upsertEmbeddingCache(params: {
  textHash: string;
  embedding: number[];
}): Promise<void> {
  const db = await openSharedCacheDb();
  const { textHash, embedding } = params;

  // 插入或更新缓存条目（text_hash 冲突时更新 embedding 和访问时间）
  db.prepare(
    `INSERT INTO embedding_cache(text_hash, embedding, last_access_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(text_hash) DO UPDATE SET
       embedding = excluded.embedding,
       last_access_at = CURRENT_TIMESTAMP`,
  ).run(textHash, JSON.stringify(embedding));

  // 检查并淘汰超过限制的缓存（LRU 策略）
  await evictOldEmbeddingCacheEntries(db);
}

/**
 * 批量查询 embedding 缓存（使用全局共享数据库，与租户无关）。
 *
 * 优化点：
 * - 使用 IN 子句一次性查询多个 text_hash，避免 N 次单独查询
 * - 批量更新命中条目的 last_access_at，减少写入次数
 * - 解析失败的条目静默跳过，不影响其他命中
 *
 * @param textHashes 待查询的文本 hash 数组
 * @returns Map<textHash, embedding>，仅包含命中的条目
 */
export async function batchQueryEmbeddingCache(
  textHashes: string[],
): Promise<Map<string, number[]>> {
  if (textHashes.length === 0) return new Map();

  const db = await openSharedCacheDb();
  // 构造动态占位符列表，如 [?, ?, ?] 对应 3 个 text_hash
  const placeholders = textHashes.map(() => "?").join(",");
  // 批量查询缓存
  const rows = db
    .prepare(
      `SELECT text_hash, embedding FROM embedding_cache WHERE text_hash IN (${placeholders})`,
    )
    .all(...textHashes);

  // 解析命中的缓存条目
  const result = new Map<string, number[]>();
  for (const row of rows) {
    try {
      const embedding = JSON.parse(String(row.embedding));
      result.set(String(row.text_hash), embedding);
    } catch {
      // 解析失败（数据损坏），跳过该条目
    }
  }

  // 批量更新命中条目的 last_access_at（标记为"最近使用"）
  for (const hash of textHashes) {
    if (result.has(hash)) {
      db.prepare(
        "UPDATE embedding_cache SET last_access_at = CURRENT_TIMESTAMP WHERE text_hash = ?",
      ).run(hash);
    }
  }

  return result;
}

/**
 * 批量写入 embedding 缓存，并在超过限制时淘汰最不常用的条目（使用全局共享数据库）。
 *
 * 优化点：
 * - 使用事务（BEGIN/COMMIT）批量写入，减少磁盘 I/O 次数
 * - 异常时 ROLLBACK 确保数据一致性
 * - 写入完成后统一触发一次淘汰检查（而非每条都检查）
 *
 * @param params 缓存条目数组，每项包含 textHash 和 embedding
 */
export async function batchUpsertEmbeddingCache(
  params: Array<{
    textHash: string;
    embedding: number[];
  }>,
): Promise<void> {
  if (params.length === 0) return;

  const db = await openSharedCacheDb();
  // 预编译 upsert 语句
  const insert = db.prepare(
    `INSERT INTO embedding_cache(text_hash, embedding, last_access_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(text_hash) DO UPDATE SET
       embedding = excluded.embedding,
       last_access_at = CURRENT_TIMESTAMP`,
  );

  // 使用事务批量写入，减少磁盘 I/O 次数
  db.exec("BEGIN");
  try {
    for (const item of params) {
      insert.run(item.textHash, JSON.stringify(item.embedding));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK"); // 写入失败时回滚，确保一致性
    throw error;
  }

  // 检查并淘汰超过限制的缓存（LRU 策略）
  await evictOldEmbeddingCacheEntries(db);
}
