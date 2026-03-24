import type sqlite from "node:sqlite";
import { resolveTaskDbPath } from "./paths.js";
import { getSubsystemLogger } from "../logger/logger.js";
import { nowChinaIso } from "./time.js";

export type TaskStatus = "pending" | "running" | "done" | "failed" | "timeout";
export type TaskDetailStatus = "success" | "failed" | "timeout";

export type TaskScheduleRow = {
  id: number;
  task_name: string;
  task_type: string;
  payload_text: string | null;
  status: TaskStatus;
  attempts: number;
  last_error: string | null;
  create_time: string;
  update_time: string;
  next_run_time: string;
  interval_seconds: number;
  started_at: string | null;
  finished_at: string | null;
};

export type TaskDetailRow = {
  id: number;
  task_id: number;
  start_time: string;
  end_time: string;
  create_time: string;
  update_time: string;
  status: TaskDetailStatus;
  error_message: string | null;
  executor: string | null;
};

export type NewTaskInput = {
  task_name: string;
  task_type: string;
  payload_text?: string | null;
  status?: TaskStatus;
  next_run_time?: string;
  interval_seconds?: number;
};

type SqliteModule = typeof import("node:sqlite");

let sqliteModule: SqliteModule | null = null;
let db: sqlite.DatabaseSync | null = null;
const storeLogger = getSubsystemLogger("watch-dog-store");

/**
 * 动态加载 node:sqlite 模块
 * 使用延迟加载以避免在不需要时加载
 * @returns sqlite 模块
 */
async function loadSqlite(): Promise<SqliteModule> {
  if (sqliteModule) return sqliteModule;
  sqliteModule = await import("node:sqlite");
  return sqliteModule;
}

/**
 * 获取数据库连接（单例模式）
 * 如果数据库不存在则创建，并初始化表结构
 * 使用 WAL 模式和 NORMAL 同步级别以优化单机性能
 * @returns SQLite 数据库连接
 */
async function getDb(): Promise<sqlite.DatabaseSync> {
  if (db) return db;
  const sqlite = await loadSqlite();
  const dbPath = resolveTaskDbPath();
  // watch-dog 专用的轻量 SQLite 库，WAL + NORMAL 保证单机性能
  db = new sqlite.DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  ensureSchema(db);
  return db;
}

/**
 * 确保数据库表结构存在
 * 创建 task_schedule 主表和 task_schedule_detail 明细表
 * 以及必要的索引
 * @param database - SQLite 数据库连接
 */
function ensureSchema(database: sqlite.DatabaseSync): void {
  // 主表：task_schedule（任务定义/状态）；明细表：task_schedule_detail（每次执行快照）
  database.exec(`
    CREATE TABLE IF NOT EXISTS task_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_name TEXT NOT NULL UNIQUE,
      task_type TEXT NOT NULL,
      payload_text TEXT,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      create_time TEXT NOT NULL,
      update_time TEXT NOT NULL,
      next_run_time TEXT NOT NULL,
      interval_seconds INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT
    );
  `);
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_schedule_status_next_run ON task_schedule(status, next_run_time);`,
  );
  database.exec(`
    CREATE TABLE IF NOT EXISTS task_schedule_detail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      create_time TEXT NOT NULL,
      update_time TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      executor TEXT
    );
  `);
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_detail_task_id ON task_schedule_detail(task_id);`,
  );
}

/**
 * 插入或更新任务调度记录
 * 使用 task_name 作为唯一键，存在则更新，不存在则插入
 * @param input - 任务输入参数
 */
export async function upsertTaskSchedule(input: NewTaskInput): Promise<void> {
  const database = await getDb();
  const now = nowChinaIso();
  const nextRun = input.next_run_time ?? now;
  const status: TaskStatus = input.status ?? "pending";
  const interval =
    typeof input.interval_seconds === "number" && Number.isFinite(input.interval_seconds)
      ? Math.max(0, Math.floor(input.interval_seconds))
      : 0;

  const stmt = database.prepare(
    `INSERT INTO task_schedule
      (task_name, task_type, payload_text, status, attempts, last_error, create_time, update_time, next_run_time, interval_seconds)
     VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)
     ON CONFLICT(task_name) DO UPDATE SET
        task_type=excluded.task_type,
        payload_text=excluded.payload_text,
        status=excluded.status,
        update_time=excluded.update_time,
        next_run_time=excluded.next_run_time,
        interval_seconds=excluded.interval_seconds`,
  );
  stmt.run(
    input.task_name,
    input.task_type,
    input.payload_text ?? null,
    status,
    now,
    now,
    nextRun,
    interval,
  );
  storeLogger.info(
    "[watch-dog-store] upsert task_schedule name=%s type=%s status=%s next=%s interval=%ss",
    input.task_name,
    input.task_type,
    status,
    nextRun,
    interval,
  );
}

/**
 * 查询到期待执行的任务列表
 * 查询条件：状态为 pending 且 next_run_time <= 当前时间
 * 按 next_run_time 升序排列，限制返回数量
 * @param limit - 最大返回数量
 * @param nowIso - 当前时间的 ISO 字符串
 * @returns 到期任务列表
 */
export async function listDueTasks(
  limit: number,
  nowIso: string,
): Promise<TaskScheduleRow[]> {
  const database = await getDb();
  const stmt = database.prepare(
    `SELECT id, task_name, task_type, payload_text, status, attempts, last_error,
            create_time, update_time, next_run_time, interval_seconds, started_at, finished_at
     FROM task_schedule
     WHERE status = 'pending' AND next_run_time <= ?
     ORDER BY next_run_time ASC
     LIMIT ?`,
  );
  return stmt.all(nowIso, limit) as TaskScheduleRow[];
}

/**
 * 查询所有任务（按 next_run_time 升序）
 */
export async function listAllTasks(): Promise<TaskScheduleRow[]> {
  const database = await getDb();
  const stmt = database.prepare(
    `SELECT id, task_name, task_type, payload_text, status, attempts, last_error,
            create_time, update_time, next_run_time, interval_seconds, started_at, finished_at
     FROM task_schedule
     ORDER BY next_run_time ASC`,
  );
  return stmt.all() as TaskScheduleRow[];
}

/**
 * 手动触发指定任务（按 task_name）
 * 将状态重置为 pending，next_run_time 设为当前时间
 */
export async function triggerTaskByName(
  taskName: string,
  nowIso: string,
): Promise<boolean> {
  const database = await getDb();
  const stmt = database.prepare(
    `UPDATE task_schedule
     SET status='pending',
         update_time=?,
         next_run_time=?,
         started_at=NULL,
         finished_at=NULL
     WHERE task_name=?`,
  );
  const result = stmt.run(nowIso, nowIso, taskName);
  return typeof result.changes === "number" && result.changes > 0;
}

/**
 * 按 task_name 获取单个任务
 */
export async function getTaskByName(
  taskName: string,
): Promise<TaskScheduleRow | null> {
  const database = await getDb();
  const stmt = database.prepare(
    `SELECT id, task_name, task_type, payload_text, status, attempts, last_error,
            create_time, update_time, next_run_time, interval_seconds, started_at, finished_at
     FROM task_schedule
     WHERE task_name = ?`,
  );
  const row = stmt.get(taskName) as TaskScheduleRow | undefined;
  return row ?? null;
}

/**
 * 按 task_name 删除任务（同时删除执行明细）
 * @returns 是否删除成功（true=删除了至少一条任务）
 */
export async function deleteTaskByName(taskName: string): Promise<boolean> {
  const database = await getDb();
  const selectStmt = database.prepare(
    `SELECT id FROM task_schedule WHERE task_name = ?`,
  );
  const row = selectStmt.get(taskName) as { id: number } | undefined;
  if (!row) return false;

  const deleteDetailsStmt = database.prepare(
    `DELETE FROM task_schedule_detail WHERE task_id = ?`,
  );
  deleteDetailsStmt.run(row.id);

  const deleteTaskStmt = database.prepare(
    `DELETE FROM task_schedule WHERE id = ?`,
  );
  const result = deleteTaskStmt.run(row.id);
  const deleted = typeof result.changes === "number" && result.changes > 0;
  if (deleted) {
    storeLogger.info("[watch-dog-store] delete task_schedule name=%s id=%s", taskName, row.id);
  }
  return deleted;
}

/**
 * 标记任务为运行中状态
 * 更新状态为 running，设置开始时间，增加尝试次数
 * @param taskId - 任务 ID
 * @param startedAtIso - 开始时间的 ISO 字符串
 */
export async function markTaskRunning(
  taskId: number,
  startedAtIso: string,
): Promise<void> {
  const database = await getDb();
  const stmt = database.prepare(
    `UPDATE task_schedule
     SET status='running',
         started_at=?,
         update_time=?,
         attempts=attempts+1
     WHERE id=?`,
  );
  stmt.run(startedAtIso, startedAtIso, taskId);
}

/**
 * 完成任务，更新最终状态
 * 更新状态、完成时间、下次运行时间、错误信息
 * @param params - 任务完成参数
 */
export async function finalizeTask(params: {
  taskId: number;
  status: TaskStatus;
  finishedAtIso: string;
  nextRunTimeIso?: string;
  lastError?: string | null;
}): Promise<void> {
  const database = await getDb();
  const stmt = database.prepare(
    `UPDATE task_schedule
     SET status = ?, finished_at = ?, update_time = ?, next_run_time = COALESCE(?, next_run_time), last_error = ?
     WHERE id = ?`,
  );
  stmt.run(
    params.status,
    params.finishedAtIso,
    params.finishedAtIso,
    params.nextRunTimeIso ?? null,
    params.lastError ?? null,
    params.taskId,
  );
}

/**
 * 插入任务执行明细记录
 * 记录每次任务执行的详细信息
 * @param params - 任务明细参数
 */
export async function insertTaskDetail(params: {
  taskId: number;
  startTimeIso: string;
  endTimeIso: string;
  status: TaskDetailStatus;
  errorMessage?: string | null;
  executor?: string | null;
}): Promise<void> {
  const database = await getDb();
  const now = nowChinaIso();
  const stmt = database.prepare(
    `INSERT INTO task_schedule_detail
      (task_id, start_time, end_time, create_time, update_time, status, error_message, executor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    params.taskId,
    params.startTimeIso,
    params.endTimeIso,
    now,
    now,
    params.status,
    params.errorMessage ?? null,
    params.executor ?? null,
  );
  storeLogger.info(
    "[watch-dog-store] insert task_schedule_detail task_id=%s status=%s executor=%s start=%s end=%s",
    params.taskId,
    params.status,
    params.executor ?? "unknown",
    params.startTimeIso,
    params.endTimeIso,
  );
}

/**
 * 清理旧的任务明细记录
 * 删除创建时间早于指定截止时间的记录
 * @param cutoffIso - 截止时间的 ISO 字符串
 * @returns 删除的记录数
 */
export async function cleanupOldDetails(cutoffIso: string): Promise<number> {
  const database = await getDb();
  const stmt = database.prepare(
    `DELETE FROM task_schedule_detail WHERE create_time < ?`,
  );
  const result = stmt.run(cutoffIso);
  return typeof result.changes === "number" ? result.changes : 0;
}
