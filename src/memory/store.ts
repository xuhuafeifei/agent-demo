import { getLoadablePath } from "sqlite-vec";
import { ensureMemoryPaths, resolveMemoryDbPath } from "./utils/path.js";
import type { MemorySource } from "./types.js";

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

// 进程级连接复用，避免重复 loadExtension 与建表开销。
let dbInstance: DbLike | null = null;

/**
 * 打开并初始化数据库（惰性初始化）。
 */
async function openDb(): Promise<DbLike> {
  if (dbInstance) return dbInstance;

  const sqlite = await import("node:sqlite");
  ensureMemoryPaths();

  const dbPath = resolveMemoryDbPath();
  const db = new sqlite.DatabaseSync(dbPath, {
    allowExtension: true,
  }) as unknown as DbLike;

  // 加载 sqlite-vec 扩展后立即关闭扩展加载，降低误用风险
  db.enableLoadExtension(true);
  db.loadExtension(getLoadablePath());
  db.enableLoadExtension(false);

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");

  // 建表：files 存 path+hash，chunks 存正文+embedding+行号，fts5 全文 + vec0 向量
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
  embedding float[384]
);
`);

  dbInstance = db;
  return db;
}

function toNumber(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  return 0;
}

function toChunkRow(row: Record<string, unknown>): ChunkRow {
  // 将 SQL 行转为强类型 ChunkRow，空内容兜底为空串
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
 */
async function transactionCommit<T>(
  db: DbLike,
  fn: (db: DbLike) => T | Promise<T>,
): Promise<T> {
  db.exec("BEGIN");
  try {
    const result = await fn(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * 读取 path 对应的文件 hash。
 */
export async function getFileHash(path: string): Promise<string | null> {
  const db = await openDb();
  const row = db.prepare("SELECT file_hash FROM files WHERE path = ?").get(path);
  // 未索引过的路径返回 null，供 sync 判断 create/rebuild
  if (!row || typeof row.file_hash !== "string") return null;
  return row.file_hash;
}

/**
 * Upsert 文件 hash（当前实现主要由 replacePathChunks 调用）。
 */
export async function upsertFileHash(
  path: string,
  fileHash: string,
): Promise<void> {
  const db = await openDb();
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
 * 列出 files 表中所有已跟踪路径。
 */
export async function listTrackedPaths(): Promise<string[]> {
  const db = await openDb();
  const rows = db.prepare("SELECT path FROM files").all();
  return rows.map((r) => String(r.path)); // 全量已索引路径，供 syncAll 补全“已删文件”的 delete 候选
}

/**
 * 删除 path 的所有索引数据（chunks + vec + fts + files）。
 */
export async function deleteByPath(path: string): Promise<void> {
  const db = await openDb();
  await transactionCommit(db, () => {
    // 先查该 path 下所有 chunk id，再按 id 删 vec/fts，避免外键或虚拟表残留
    const idRows = db.prepare("SELECT id FROM chunks WHERE path = ?").all(path);
    const ids = idRows.map((r) => Number(r.id));

    for (const id of ids) {
      db.prepare("DELETE FROM chunks_vec WHERE id = ?").run(BigInt(id));
      db.prepare("DELETE FROM chunks_fts WHERE id = ?").run(id);
    }

    db.prepare("DELETE FROM chunks WHERE path = ?").run(path);
    db.prepare("DELETE FROM files WHERE path = ?").run(path);
  });
}

/**
 * 全量替换某个 path 的 chunks 索引（事务）。
 */
export async function replacePathChunks(params: {
  path: string;
  source: MemorySource;
  fileHash: string;
  chunks: Array<{ content: string; lineStart: number; lineEnd: number }>;
  embeddings: number[][];
}): Promise<number> {
  const db = await openDb();
  const { path, source, fileHash, chunks, embeddings } = params;
  if (chunks.length !== embeddings.length) {
    throw new Error("chunks and embeddings length mismatch");
  }

  return transactionCommit(db, () => {
    // 先删该 path 在 vec/fts 的旧记录，再删 chunks，再插入新 chunk
    const oldRows = db.prepare("SELECT id FROM chunks WHERE path = ?").all(path);
    for (const row of oldRows) {
      const id = Number(row.id);
      db.prepare("DELETE FROM chunks_vec WHERE id = ?").run(BigInt(id));
      db.prepare("DELETE FROM chunks_fts WHERE id = ?").run(id);
    }
    db.prepare("DELETE FROM chunks WHERE path = ?").run(path);

    const insertChunk = db.prepare(
      `INSERT INTO chunks(source, path, chunk_content, embedding, line_start, line_end, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    );
    const insertVec = db.prepare(
      "INSERT INTO chunks_vec(id, embedding) VALUES (?, ?)",
    );
    const insertFts = db.prepare(
      `INSERT INTO chunks_fts(source, chunk_content, path, line_start, line_end, id)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    let inserted = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const embedding = embeddings[i];

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

      // 同一 embedding 写入 chunks（BLOB）与 chunks_vec（KNN 检索用）
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

    // 更新 files 表 hash，供下次 sync 判断 skip/rebuild
    db.prepare(
      `INSERT INTO files(path, file_hash, update_time)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(path) DO UPDATE SET
         file_hash = excluded.file_hash,
         update_time = CURRENT_TIMESTAMP`,
    ).run(path, fileHash);

    return inserted;
  });
}

/**
 * FTS 查询（按 bm25 升序）并输出排名。
 */
export async function queryFts(
  query: string,
  topK: number,
): Promise<Array<{ id: number; rank: number }>> {
  const db = await openDb();
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
    // 用户输入可能触发非法 FTS 语法，捕获后返回空结果
    rows = [];
  }

  return rows.map((row, idx) => ({ id: Number(row.id), rank: idx + 1 })); // rank 为 1-based 顺序
}

/**
 * 向量检索（sqlite-vec KNN）并输出排名。
 */
export async function queryVector(
  embedding: number[],
  topK: number,
): Promise<Array<{ id: number; rank: number }>> {
  const db = await openDb();
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
 * 通过 id 列表批量回表拿 chunk 元数据。
 */
export async function getChunksByIds(ids: number[]): Promise<ChunkRow[]> {
  if (ids.length === 0) return [];
  const db = await openDb();
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
 * 关闭内存数据库连接（用于服务停止）。
 */
export async function closeMemoryDb(): Promise<void> {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null; // 置空便于下次 start 时重新 openDb
  }
}
