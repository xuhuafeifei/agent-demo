import type sqlite from "node:sqlite";
import { resolveTaskDbPath } from "./paths.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";
import { nowChinaIso } from "./time.js";
import { createSerialExecutor } from "./serial-sql.js";

export type TaskStatus = "pending" | "running" | "done" | "failed" | "timeout";
export type TaskDetailStatus = "success" | "failed" | "timeout" | "skipped";

export type TaskScheduleKind = "once" | "cron";

export type TaskScheduleRow = {
  id: number;
  task_name: string;
  task_type: string;
  payload_text: string | null;
  schedule_kind: TaskScheduleKind;
  schedule_expr: string;
  timezone: string;
  status: TaskStatus;
  attempts: number;
  last_error: string | null;
  create_time: string;
  update_time: string;
  next_run_time: string;
  started_at: string | null;
  finished_at: string | null;
  /** 任务所属租户 ID；default 租户拥有全量管理权 */
  tenant_id: string;
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
  schedule_kind: TaskScheduleKind;
  schedule_expr: string;
  timezone?: string;
  status?: TaskStatus;
  next_run_time?: string;
  /** 任务所属租户 ID，默认 "default" */
  tenant_id?: string;
};

const serialExecutor = createSerialExecutor();

type SqliteModule = typeof import("node:sqlite");

let sqliteModule: SqliteModule | null = null;
let db: sqlite.DatabaseSync | null = null;
const storeLogger = getSubsystemConsoleLogger("watch-dog-store");

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
  // 与其它协程路径（工具 upsert / 读任务）交错时避免立刻 SQLITE_BUSY
  db.exec("PRAGMA busy_timeout=5000;");
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
      schedule_kind TEXT NOT NULL,
      schedule_expr TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      create_time TEXT NOT NULL,
      update_time TEXT NOT NULL,
      next_run_time TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      tenant_id TEXT NOT NULL DEFAULT 'default'
    );
  `);
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_schedule_status_next_run ON task_schedule(status, next_run_time);`,
  );
  // 支持按租户过滤任务的索引
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_schedule_tenant_id ON task_schedule(tenant_id);`,
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
  const timezone = input.timezone?.trim() || "Asia/Shanghai";
  const status: TaskStatus = input.status ?? "pending";
  const tenantId = input.tenant_id?.trim() || "default";

  await serialExecutor.execute(async () => {
    const stmt = database.prepare(
      `INSERT INTO task_schedule
      (task_name, task_type, payload_text, schedule_kind, schedule_expr, timezone, status, attempts, last_error, create_time, update_time, next_run_time, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)
     ON CONFLICT(task_name) DO UPDATE SET
        task_type=excluded.task_type,
        payload_text=excluded.payload_text,
        schedule_kind=excluded.schedule_kind,
        schedule_expr=excluded.schedule_expr,
        timezone=excluded.timezone,
        status=excluded.status,
        update_time=excluded.update_time,
        next_run_time=excluded.next_run_time,
        tenant_id=excluded.tenant_id`,
    );
    stmt.run(
      input.task_name,
      input.task_type,
      input.payload_text ?? null,
      input.schedule_kind,
      input.schedule_expr,
      timezone,
      status,
      now,
      now,
      nextRun,
      tenantId,
    );
  });
  storeLogger.info(
    "upsert task_schedule name=%s type=%s kind=%s status=%s next=%s tenant=%s",
    input.task_name,
    input.task_type,
    input.schedule_kind,
    status,
    nextRun,
    tenantId,
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
  // 交给串行执行器执行
  return serialExecutor.execute(async () => {
    // 使用 UPDATE ... RETURNING 语法实现原子查询并更新
    const stmt = database.prepare(
      `UPDATE task_schedule
     SET status = 'running',
         update_time = CURRENT_TIMESTAMP,
         started_at = CURRENT_TIMESTAMP,
         attempts = COALESCE(attempts, 0) + 1
     WHERE id IN (
        SELECT id FROM task_schedule
        WHERE status = 'pending' AND next_run_time <= ?
        ORDER BY next_run_time ASC
        LIMIT ?
     )
     RETURNING id, task_name, task_type, payload_text, status, attempts, last_error,
               schedule_kind, schedule_expr, timezone,
               create_time, update_time, next_run_time, started_at, finished_at, tenant_id`,
    );
    return stmt.all(nowIso, limit) as TaskScheduleRow[];
  });
}

/**
 * 按租户查询任务：default 租户可查看全部，其他租户只能查看自己的任务。
 * @param tenantId 当前租户 ID
 */
export async function listTasksByTenant(tenantId: string): Promise<TaskScheduleRow[]> {
  const database = await getDb();
  return serialExecutor.execute(async () => {
    if (tenantId === "default") {
      // default 是主租户，有全量查看权
      const stmt = database.prepare(
        `SELECT id, task_name, task_type, payload_text, status, attempts, last_error,
              schedule_kind, schedule_expr, timezone,
              create_time, update_time, next_run_time, started_at, finished_at, tenant_id
       FROM task_schedule
       ORDER BY next_run_time ASC`,
      );
      return stmt.all() as TaskScheduleRow[];
    }
    // 非 default 租户只能看到自己的任务
    const stmt = database.prepare(
      `SELECT id, task_name, task_type, payload_text, status, attempts, last_error,
            schedule_kind, schedule_expr, timezone,
            create_time, update_time, next_run_time, started_at, finished_at, tenant_id
     FROM task_schedule
     WHERE tenant_id = ?
     ORDER BY next_run_time ASC`,
    );
    return stmt.all(tenantId) as TaskScheduleRow[];
  });
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
  return serialExecutor.execute(async () => {
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
  });
}

/**
 * 按 task_name 获取单个任务（按租户隔离）。
 * default 租户可查看任意任务，其他租户只能查看自己的任务，不存在或无权访问均返回 null。
 * @param taskName 任务名称
 * @param tenantId 当前租户 ID
 */
export async function getTaskByName(
  taskName: string,
  tenantId: string,
): Promise<TaskScheduleRow | null> {
  const database = await getDb();
  return serialExecutor.execute(async () => {
    if (tenantId === "default") {
      // default 是主租户，不加租户过滤
      const stmt = database.prepare(
        `SELECT id, task_name, task_type, payload_text, status, attempts, last_error,
              schedule_kind, schedule_expr, timezone,
              create_time, update_time, next_run_time, started_at, finished_at, tenant_id
       FROM task_schedule
       WHERE task_name = ?`,
      );
      const row = stmt.get(taskName) as TaskScheduleRow | undefined;
      return row ?? null;
    }
    // 非 default 租户：任务不属于该租户则返回 null（不泄露其他租户任务存在）
    const stmt = database.prepare(
      `SELECT id, task_name, task_type, payload_text, status, attempts, last_error,
            schedule_kind, schedule_expr, timezone,
            create_time, update_time, next_run_time, started_at, finished_at, tenant_id
     FROM task_schedule
     WHERE task_name = ? AND tenant_id = ?`,
    );
    const row = stmt.get(taskName, tenantId) as TaskScheduleRow | undefined;
    return row ?? null;
  });
}

/**
 * 按租户删除任务：default 租户可删除任意任务，其他租户只能删除自己的任务。
 * @returns "ok" 已删除 | "not_found" 任务不存在 | "forbidden" 无权限
 */
export async function deleteTaskByNameForTenant(
  taskName: string,
  tenantId: string,
): Promise<"ok" | "not_found" | "forbidden"> {
  const database = await getDb();
  return serialExecutor.execute(async () => {
    const selectStmt = database.prepare(
      `SELECT id, tenant_id FROM task_schedule WHERE task_name = ?`,
    );
    const row = selectStmt.get(taskName) as { id: number; tenant_id: string } | undefined;
    if (!row) return "not_found";
    // 非 default 租户只能删除自己的任务
    if (tenantId !== "default" && row.tenant_id !== tenantId) return "forbidden";

    database.prepare(`DELETE FROM task_schedule_detail WHERE task_id = ?`).run(row.id);
    database.prepare(`DELETE FROM task_schedule WHERE id = ?`).run(row.id);
    storeLogger.info(
      "delete task_schedule name=%s id=%s by_tenant=%s",
      taskName,
      row.id,
      tenantId,
    );
    return "ok";
  });
}

/**
 * @deprecated 使用listDueTasks取代, 该方法是原子操作.
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
  await serialExecutor.execute(async () => {
    const stmt = database.prepare(
      `UPDATE task_schedule
     SET status='running',
         started_at=?,
         update_time=?,
         attempts=attempts+1
     WHERE id=?`,
    );
    stmt.run(startedAtIso, startedAtIso, taskId);
    storeLogger.info(
      "mark task_schedule id=%s status=running started_at=%s",
      taskId,
      startedAtIso,
    );
  });
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
  await serialExecutor.execute(async () => {
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
    storeLogger.info(
      "finalize task_schedule id=%s status=%s finished_at=%s next_run_time=%s last_error=%s",
      params.taskId,
      params.status,
      params.finishedAtIso,
      params.nextRunTimeIso ?? null,
      params.lastError ?? null,
    );
  });
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
  await serialExecutor.execute(async () => {
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
      "insert task_schedule_detail tas_id=%s status=%s executor=%s start=%s end=%s",
      params.taskId,
      params.status,
      params.executor ?? "unknown",
      params.startTimeIso,
      params.endTimeIso,
    );
  });
}

/**
 * 清理旧的任务明细记录
 * 删除创建时间早于指定截止时间的记录
 * @param cutoffIso - 截止时间的 ISO 字符串
 * @returns 删除的记录数
 */
export async function cleanupOldDetails(cutoffIso: string): Promise<number> {
  const database = await getDb();
  // 交由串行执行器执行
  return serialExecutor.execute(async () => {
    const stmt = database.prepare(
      `DELETE FROM task_schedule_detail WHERE create_time < ?`,
    );
    const result = stmt.run(cutoffIso);
    const deleted =
      typeof result.changes === "number" && result.changes > 0
        ? result.changes
        : 0;
    if (deleted > 0) {
      storeLogger.info(
        "cleanup task_schedule_detail cutoff=%s deleted=%s",
        cutoffIso,
        deleted,
      );
    }
    return deleted;
  });
}
