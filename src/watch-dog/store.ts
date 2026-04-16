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

/** 系统内置任务名：禁止删除，前后端一致校验 */
export const PROTECTED_TASK_NAMES = new Set<string>([
  "cleanup_logs",
  "one_minute_heartbeat",
]);

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
 *
 * 【表结构设计】
 * 1. task_schedule（任务调度主表）- 存储任务的"定义"与"当前状态"
 *    - id: 自增主键，唯一标识每个任务
 *    - task_name: 任务名称，UNIQUE 约束确保全局唯一
 *    - task_type: 任务类型（如 "http_request", "script" 等），用于路由到不同的执行器
 *    - payload_text: 任务执行所需的载荷数据（如 HTTP 请求体、脚本内容等），可为空
 *    - schedule_kind: 调度类型，"once" 表示单次执行，"cron" 表示周期性执行
 *    - schedule_expr: 调度表达式，cron 类型时为 cron 表达式，once 类型时为具体时间
 *    - timezone: 时区配置，默认 'Asia/Shanghai'，用于 cron 表达式的时间解析
 *    - status: 任务当前状态，可选值: pending / running / done / failed / timeout
 *    - attempts: 已尝试执行次数，每次调度时 +1，用于监控和重试分析
 *    - last_error: 最后一次执行的错误信息，失败时写入，成功时清空
 *    - create_time / update_time: 记录创建和更新时间
 *    - next_run_time: 下次计划执行时间，调度器据此判断任务是否到期
 *    - started_at / finished_at: 当前执行周期的开始/结束时间，running 时设置 started_at，完成时设置 finished_at
 *    - tenant_id: 租户隔离字段，"default" 租户拥有全量管理权，其他租户只能管理自己的任务
 *
 * 2. task_schedule_detail（任务执行明细表）- 存储"每次执行"的快照记录
 *    - id: 自增主键
 *    - task_id: 外键关联 task_schedule.id，指向被执行的任务
 *    - start_time / end_time: 本次执行的实际开始/结束时间
 *    - create_time / update_time: 记录创建和更新时间
 *    - status: 本次执行结果，可选值: success / failed / timeout / skipped
 *    - error_message: 执行失败时的错误信息
 *    - executor: 执行者标识（如触发该次执行的用户或系统组件名）
 *
 * 【索引设计】
 * - idx_task_schedule_status_next_run: 复合索引 (status, next_run_time)，加速到期任务查询
 * - idx_task_schedule_tenant_id: 租户索引，加速按租户过滤任务的查询
 * - idx_task_detail_task_id: 明细表索引，加速按 task_id 查询执行历史
 *
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
 * 查询到期可执行的任务列表
 *
 * 【调度机制】
 * 该方法由调度器周期性调用，用于获取当前应该执行的任务。
 *
 * 【查询条件】
 * - status = 'pending': 只选择处于等待状态的任务（排除正在运行或已完成的任务）
 * - next_run_time <= nowIso: 计划执行时间已到或已过（到期任务）
 *
 * 【原子性保证】
 * 使用 UPDATE ... RETURNING 语法实现"查询并更新"的原子操作：
 * 1. 先通过子查询选出符合条件的任务 ID（按 next_run_time 升序，限制数量）
 * 2. 将这些任务的状态更新为 'running'，同时记录开始时间和增加尝试次数
 * 3. RETURNING 子句返回更新后的完整任务行
 *
 * 这种设计避免了"查询"和"更新"之间的竞态条件，确保同一任务不会被多个调度器同时拾取。
 *
 * 【返回结果排序】
 * 按 next_run_time 升序排列，优先执行最早到期的任务。
 *
 * @param limit - 最大返回数量，控制单次调度批次的任务数
 * @param nowIso - 当前时间的 ISO 字符串，用于判断哪些任务已到期
 * @returns 到期任务列表，已标记为 running 状态
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
): Promise<"ok" | "not_found" | "forbidden" | "protected"> {
  if (PROTECTED_TASK_NAMES.has(taskName)) return "protected";
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

const TASK_SCHEDULE_SELECT_COLUMNS = `id, task_name, task_type, payload_text, status, attempts, last_error,
              schedule_kind, schedule_expr, timezone,
              create_time, update_time, next_run_time, started_at, finished_at, tenant_id`;

/**
 * 按主键读取任务（Web 管理用；调用方已确认权限）
 */
export async function getTaskScheduleById(
  taskId: number,
): Promise<TaskScheduleRow | null> {
  const database = await getDb();
  return serialExecutor.execute(async () => {
    const stmt = database.prepare(
      `SELECT ${TASK_SCHEDULE_SELECT_COLUMNS}
       FROM task_schedule WHERE id = ?`,
    );
    const row = stmt.get(taskId) as TaskScheduleRow | undefined;
    return row ?? null;
  });
}

/**
 * 按明细 create_time 倒序分页；闭区间 [fromIso, toIso]
 */
export async function listTaskDetailsByCreateTime(params: {
  taskId: number;
  fromIso: string;
  toIso: string;
  limit: number;
}): Promise<TaskDetailRow[]> {
  const database = await getDb();
  const cap = Math.max(1, Math.min(500, Math.floor(params.limit)));
  return serialExecutor.execute(async () => {
    const stmt = database.prepare(
      `SELECT id, task_id, start_time, end_time, create_time, update_time, status, error_message, executor
       FROM task_schedule_detail
       WHERE task_id = ? AND create_time >= ? AND create_time <= ?
       ORDER BY create_time DESC
       LIMIT ?`,
    );
    return stmt.all(params.taskId, params.fromIso, params.toIso, cap) as TaskDetailRow[];
  });
}

/**
 * 仅更新 cron 任务的表达式，并重新计算 next_run_time（不改变 schedule_kind）
 */
export async function updateCronScheduleExprById(params: {
  taskId: number;
  scheduleExpr: string;
  nextRunTimeIso: string;
}): Promise<"ok" | "not_found" | "not_cron"> {
  const database = await getDb();
  return serialExecutor.execute(async () => {
    const check = database
      .prepare(`SELECT id, schedule_kind FROM task_schedule WHERE id = ?`)
      .get(params.taskId) as { id: number; schedule_kind: string } | undefined;
    if (!check) return "not_found";
    if (check.schedule_kind !== "cron") return "not_cron";
    const now = nowChinaIso();
    database
      .prepare(
        `UPDATE task_schedule SET schedule_expr = ?, next_run_time = ?, update_time = ? WHERE id = ?`,
      )
      .run(params.scheduleExpr.trim(), params.nextRunTimeIso, now, params.taskId);
    return "ok";
  });
}

/**
 * 非 cron 任务：只改 schedule_expr（一般为 once 的触发时间字符串），并同步 next_run_time
 */
export async function updateOnceScheduleExprById(params: {
  taskId: number;
  scheduleExpr: string;
}): Promise<"ok" | "not_found" | "is_cron"> {
  const database = await getDb();
  return serialExecutor.execute(async () => {
    const check = database
      .prepare(`SELECT id, schedule_kind FROM task_schedule WHERE id = ?`)
      .get(params.taskId) as { id: number; schedule_kind: string } | undefined;
    if (!check) return "not_found";
    if (check.schedule_kind === "cron") return "is_cron";
    const expr = params.scheduleExpr.trim();
    const now = nowChinaIso();
    database
      .prepare(
        `UPDATE task_schedule SET schedule_expr = ?, next_run_time = ?, update_time = ? WHERE id = ?`,
      )
      .run(expr, expr, now, params.taskId);
    return "ok";
  });
}

/**
 * 执行单条 UPDATE task_schedule ...（仅主表；由路由层做字符串校验）
 */
export async function execRawUpdateTaskSchedule(sql: string): Promise<void> {
  const database = await getDb();
  await serialExecutor.execute(async () => {
    database.exec(sql);
  });
}

/**
 * 完成任务，更新最终状态
 *
 * 【执行跟踪机制】
 * 任务执行完成后调用此方法，更新主表中的任务状态。完整的执行跟踪流程如下：
 *
 * 1. 任务被调度器拾取（listDueTasks）→ 状态变为 'running'，started_at 被记录
 * 2. 执行器执行任务逻辑
 * 3. 执行完成后调用 finalizeTask → 更新状态为 done/failed/timeout，记录 finished_at
 * 4. 同时调用 insertTaskDetail → 在明细表中插入一条执行记录，保存本次执行的详细结果
 *
 * 【状态流转】
 * - pending → running（listDueTasks）→ done/failed/timeout（finalizeTask）
 * - 如果是 cron 任务且状态为 done，next_run_time 会被更新为下次执行时间
 * - 如果是失败/超时任务，last_error 会记录错误信息，便于后续排查
 *
 * 【下次运行时间计算】
 * - nextRunTimeIso 由调用方根据 schedule_kind 和 schedule_expr 计算：
 *   - cron 任务：根据 cron 表达式计算下一次触发时间
 *   - once 任务：通常不设置（保持 NULL 或原值），因为单次任务不再重复
 * - 使用 COALESCE(?, next_run_time) 确保未传入新值时保留原有值
 *
 * @param params - 任务完成参数
 * @param params.taskId - 任务 ID
 * @param params.status - 最终状态: done（成功）/ failed（失败）/ timeout（超时）
 * @param params.finishedAtIso - 完成时间的 ISO 字符串
 * @param params.nextRunTimeIso - 下次计划执行时间（cron 任务必填）
 * @param params.lastError - 错误信息（失败时填写）
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
 *
 * 【执行跟踪机制 - 明细记录】
 * 每次任务执行完毕后调用，在 task_schedule_detail 表中插入一条快照记录。
 * 与主表（task_schedule）的关系：
 * - 主表：每个任务只有一行，记录"当前"状态和元数据
 * - 明细表：每个任务有多行，记录"历史"每次执行的结果
 *
 * 【记录内容】
 * - task_id: 关联到 task_schedule.id
 * - start_time / end_time: 本次执行的实际起止时间，用于计算执行耗时
 * - status: 本次执行结果
 *   - success: 执行成功
 *   - failed: 执行失败（如网络错误、脚本异常等）
 *   - timeout: 执行超时（超过预设的最大执行时间）
 *   - skipped: 被跳过（如前置条件不满足、依赖任务失败等）
 * - error_message: 失败/超时时的错误堆栈或描述
 * - executor: 执行者标识，可用于审计（如哪个用户手动触发、哪个系统组件自动执行）
 *
 * 【使用场景】
 * - 查询任务的执行历史（按 task_id 查询明细表）
 * - 统计任务成功率、平均耗时等指标
 * - 排查问题时查看历史错误信息
 *
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
 *
 * 【清理机制】
 * 由于每次任务执行都会在 task_schedule_detail 表中插入一条记录，长期运行会导致表数据膨胀。
 * 此方法用于定期清理过期的明细记录，控制数据库大小。
 *
 * 【清理策略】
 * - 按 create_time 字段判断记录是否过期
 * - 调用方传入截止时间 cutoffIso（如 7 天前的时间戳），删除所有早于该时间的记录
 * - 典型用法：cleanupOldDetails(cutoffIso) 其中 cutoffIso = 7天前的 ISO 时间
 *
 * 【注意事项】
 * - 只清理明细表（task_schedule_detail），不清理主表（task_schedule）
 * - 主表中的任务定义和当前状态需要永久保留（除非手动删除任务）
 * - 建议在定时任务中定期调用此方法，如每天凌晨执行一次清理
 *
 * @param cutoffIso - 截止时间的 ISO 字符串，删除创建时间早于此值的明细记录
 * @returns 删除的记录数，可用于监控清理效果
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
