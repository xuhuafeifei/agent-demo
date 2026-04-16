/**
 * 没有测过, 懒得测了. 如果未来有好心人可以帮忙测一下...
 */
import { Router } from "express";
import type { Request } from "express";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import {
  PROTECTED_TASK_NAMES,
  deleteTaskByNameForTenant,
  execRawUpdateTaskSchedule,
  getTaskScheduleById,
  listTaskDetailsByCreateTime,
  listTasksByTenant,
  updateCronScheduleExprById,
  updateOnceScheduleExprById,
  type TaskScheduleRow,
  type TaskStatus,
} from "../../../watch-dog/store.js";
import { computeNextRunFromCron } from "../../../watch-dog/cron.js";
import { chinaCalendarDayBoundsFromUtcMs } from "../../../watch-dog/time.js";
import { runTaskByNameNowForTenant } from "../../../watch-dog/watch-dog.js";
import { HANDLERS } from "../../../watch-dog/handlers.js";
import { WATCH_DOG_TASK_TYPE_SET } from "../../../watch-dog/registered-task-types.js";

/**
 * Web 调度任务管理 API（挂载在 /api/task-schedules）。
 * 约定：能登录 web 即视为可信管理员，数据层固定 default 租户语义。
 * 静态路由（/trigger、/by-name/...、/exec-sql）必须注册在 /:id 之前，避免被误捕获。
 */
const log = getSubsystemConsoleLogger("web:task-schedule");

const TASK_STATUSES = new Set<TaskStatus>([
  "pending",
  "running",
  "done",
  "failed",
  "timeout",
]);

/** 明细列表：按 create_time 倒序，固定最多 3 条（产品约定写死） */
const DETAIL_ROW_LIMIT = 3;

const TASK_TYPE_LABELS: Record<string, string> = {
  execute_script: "脚本执行",
  execute_reminder: "提醒任务",
  execute_agent: "Agent任务",
  cleanup_logs: "日志清理",
  one_minute_heartbeat: "一分钟心跳",
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "待执行",
  running: "执行中",
  done: "已完成",
  failed: "失败",
  timeout: "超时",
};

const DETAIL_STATUS_LABELS: Record<string, string> = {
  success: "成功",
  failed: "失败",
  timeout: "超时",
  skipped: "跳过",
};

type WebTaskScheduleRow = TaskScheduleRow & {
  task_type_label: string;
  status_label: string;
  schedule_kind_label: string;
};

type TaskDetailRow = Awaited<ReturnType<typeof listTaskDetailsByCreateTime>>[number];

type WebTaskDetailRow = TaskDetailRow & { status_label: string };

function toWebTaskRow(row: TaskScheduleRow): WebTaskScheduleRow {
  return {
    ...row,
    task_type_label: TASK_TYPE_LABELS[row.task_type] || row.task_type,
    status_label: TASK_STATUS_LABELS[row.status] || row.status,
    schedule_kind_label: row.schedule_kind === "once" ? "运行一次" : "cron调度",
  };
}

function toWebDetailRow(row: TaskDetailRow): WebTaskDetailRow {
  return {
    ...row,
    status_label: DETAIL_STATUS_LABELS[row.status] || row.status,
  };
}

function sqlStringLiteral(value: string | null): string {
  if (value === null) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildInsertSql(row: TaskScheduleRow): string {
  const cols = `task_name, task_type, payload_text, schedule_kind, schedule_expr, timezone, status, attempts, last_error, create_time, update_time, next_run_time, started_at, finished_at, tenant_id`;
  const vals = [
    sqlStringLiteral(row.task_name),
    sqlStringLiteral(row.task_type),
    sqlStringLiteral(row.payload_text),
    sqlStringLiteral(row.schedule_kind),
    sqlStringLiteral(row.schedule_expr),
    sqlStringLiteral(row.timezone),
    sqlStringLiteral(row.status),
    String(row.attempts),
    sqlStringLiteral(row.last_error),
    sqlStringLiteral(row.create_time),
    sqlStringLiteral(row.update_time),
    sqlStringLiteral(row.next_run_time),
    sqlStringLiteral(row.started_at),
    sqlStringLiteral(row.finished_at),
    sqlStringLiteral(row.tenant_id),
  ].join(", ");
  return `INSERT INTO task_schedule (${cols}) VALUES (${vals});`;
}

function buildFullUpdateSql(row: TaskScheduleRow): string {
  return `UPDATE task_schedule SET
  task_name = ${sqlStringLiteral(row.task_name)},
  task_type = ${sqlStringLiteral(row.task_type)},
  payload_text = ${sqlStringLiteral(row.payload_text)},
  schedule_kind = ${sqlStringLiteral(row.schedule_kind)},
  schedule_expr = ${sqlStringLiteral(row.schedule_expr)},
  timezone = ${sqlStringLiteral(row.timezone)},
  status = ${sqlStringLiteral(row.status)},
  attempts = ${String(row.attempts)},
  last_error = ${sqlStringLiteral(row.last_error)},
  create_time = ${sqlStringLiteral(row.create_time)},
  update_time = ${sqlStringLiteral(row.update_time)},
  next_run_time = ${sqlStringLiteral(row.next_run_time)},
  started_at = ${sqlStringLiteral(row.started_at)},
  finished_at = ${sqlStringLiteral(row.finished_at)},
  tenant_id = ${sqlStringLiteral(row.tenant_id)}
WHERE id = ${String(row.id)};`;
}

/**
 * 校验 UPDATE 语句：仅允许改主表；禁止动明细表；禁止多条语句；必须带 WHERE id = 数字 以便执行后校验。
 */
function assertSafeTaskScheduleUpdateSql(sqlRaw: string): string {
  const sql = sqlRaw.trim();
  if (!sql) throw new Error("SQL 不能为空");
  if (sql.includes(";")) throw new Error("不允许使用分号或一条以上语句");
  const lower = sql.toLowerCase();
  if (!lower.startsWith("update "))
    throw new Error("仅支持以 UPDATE 开头的语句");
  if (!lower.includes("task_schedule"))
    throw new Error("UPDATE 必须针对 task_schedule 表");
  if (lower.includes("task_schedule_detail"))
    throw new Error("禁止修改 task_schedule_detail");
  if (!/where\s+id\s*=\s*\d+/i.test(sql)) {
    throw new Error(
      "必须在 WHERE 子句中指定 id = <数字>，以便执行后做一致性校验",
    );
  }
  return sql;
}

function validateRowSemantics(row: TaskScheduleRow): string | null {
  if (!WATCH_DOG_TASK_TYPE_SET.has(row.task_type)) {
    return `非法 task_type: ${row.task_type}（须为已注册的 handler 类型）`;
  }
  if (!TASK_STATUSES.has(row.status)) {
    return `非法 status: ${row.status}`;
  }
  if (row.schedule_kind !== "cron" && row.schedule_kind !== "once") {
    return `非法 schedule_kind: ${row.schedule_kind}`;
  }
  if (!(row.task_type in HANDLERS)) {
    return `task_type 无对应 handler: ${row.task_type}`;
  }
  return null;
}

function parseDayOrToday(req: Request): { fromIso: string; toIso: string } {
  const day = typeof req.query.day === "string" ? req.query.day.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return {
      fromIso: `${day}T00:00:00.000+08:00`,
      toIso: `${day}T23:59:59.999+08:00`,
    };
  }
  return chinaCalendarDayBoundsFromUtcMs(Date.now());
}

export function createTaskScheduleRouter() {
  const router = Router();

  /** 全量主任务列表（固定 default 租户语义） */
  router.get("/", async (_req, res) => {
    try {
      const tasks = await listTasksByTenant("default");
      res.json({ success: true, tasks: tasks.map(toWebTaskRow) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("list tasks: %s", msg);
      res.status(500).json({ success: false, error: msg });
    }
  });

  /** 静态路径须写在 /:id 之前，避免被误匹配 */
  router.post("/trigger", async (req, res) => {
    const body = req.body as { task_name?: string };
    const name =
      typeof body?.task_name === "string" ? body.task_name.trim() : "";
    if (!name) {
      res.status(400).json({ success: false, error: "task_name 必填" });
      return;
    }
    try {
      const result = await runTaskByNameNowForTenant(name, "default", {
        triggerBy: "manual",
      });
      if (result === "not_found") {
        res
          .status(404)
          .json({ success: false, error: "任务不存在或无 handler" });
        return;
      }
      if (result === "forbidden") {
        res.status(403).json({ success: false, error: "forbidden" });
        return;
      }
      res.json({ success: true, message: "已触发" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("trigger: %s", msg);
      res.status(500).json({ success: false, error: msg });
    }
  });

  router.delete("/by-name/:name", async (req, res) => {
    const name = decodeURIComponent(String(req.params.name || "")).trim();
    if (!name) {
      res.status(400).json({ success: false, error: "task_name 无效" });
      return;
    }
    try {
      const result = await deleteTaskByNameForTenant(name, "default");
      if (result === "protected") {
        res.status(403).json({ success: false, error: "系统任务禁止删除" });
        return;
      }
      if (result === "not_found") {
        res.status(404).json({ success: false, error: "任务不存在" });
        return;
      }
      if (result === "forbidden") {
        res.status(403).json({ success: false, error: "forbidden" });
        return;
      }
      res.json({ success: true, message: "已删除" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("delete: %s", msg);
      res.status(500).json({ success: false, error: msg });
    }
  });

  router.post("/exec-sql", async (req, res) => {
    const body = req.body as { sql?: string };
    const sqlRaw = typeof body?.sql === "string" ? body.sql : "";
    try {
      const sql = assertSafeTaskScheduleUpdateSql(sqlRaw);
      await execRawUpdateTaskSchedule(sql);
      const idMatch = sql.match(/where\s+id\s*=\s*(\d+)/i);
      const id = Number.parseInt(idMatch![1]!, 10);
      const row = await getTaskScheduleById(id);
      if (!row) {
        res
          .status(400)
          .json({ success: false, error: `执行后未找到 id=${id} 的行` });
        return;
      }
      const invalid = validateRowSemantics(row);
      if (invalid) {
        res
          .status(400)
          .json({ success: false, error: `执行后校验失败: ${invalid}` });
        return;
      }
      res.json({ success: true, message: "已执行" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("exec-sql: %s", msg);
      res.status(400).json({ success: false, error: msg });
    }
  });

  /** 明细：默认当天（上海），固定 3 条；可选 query day=YYYY-MM-DD */
  router.get("/:id/details", async (req, res) => {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, error: "无效的任务 id" });
      return;
    }
    try {
      const task = await getTaskScheduleById(id);
      if (!task) {
        res.status(404).json({ success: false, error: "任务不存在" });
        return;
      }
      const { fromIso, toIso } = parseDayOrToday(req);
      const details = await listTaskDetailsByCreateTime({
        taskId: id,
        fromIso,
        toIso,
        limit: DETAIL_ROW_LIMIT,
      });
      res.json({
        success: true,
        task: toWebTaskRow(task),
        range: { fromIso, toIso },
        limit: DETAIL_ROW_LIMIT,
        details: details.map(toWebDetailRow),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("list details: %s", msg);
      res.status(500).json({ success: false, error: msg });
    }
  });

  /** 生成 INSERT SQL（便于复制到客户端执行） */
  router.get("/:id/sql-insert", async (req, res) => {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, error: "无效的任务 id" });
      return;
    }
    try {
      const row = await getTaskScheduleById(id);
      if (!row) {
        res.status(404).json({ success: false, error: "任务不存在" });
        return;
      }
      res.json({ success: true, sql: buildInsertSql(row) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ success: false, error: msg });
    }
  });

  /** 生成覆盖全字段的 UPDATE SQL */
  router.get("/:id/sql-update", async (req, res) => {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, error: "无效的任务 id" });
      return;
    }
    try {
      const row = await getTaskScheduleById(id);
      if (!row) {
        res.status(404).json({ success: false, error: "任务不存在" });
        return;
      }
      res.json({ success: true, sql: buildFullUpdateSql(row) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ success: false, error: msg });
    }
  });

  /** 仅改表达式：cron 重算 next_run；once 将 schedule_expr 与 next_run_time 同步为该字符串 */
  router.patch("/:id/schedule-expr", async (req, res) => {
    const id = Number.parseInt(String(req.params.id), 10);
    const body = req.body as { schedule_expr?: string };
    const expr =
      typeof body?.schedule_expr === "string" ? body.schedule_expr.trim() : "";
    if (!Number.isFinite(id) || !expr) {
      res
        .status(400)
        .json({ success: false, error: "需要合法的 id 与 schedule_expr" });
      return;
    }
    try {
      const task = await getTaskScheduleById(id);
      if (!task) {
        res.status(404).json({ success: false, error: "任务不存在" });
        return;
      }
      if (PROTECTED_TASK_NAMES.has(task.task_name)) {
        res.status(403).json({
          success: false,
          error: "系统任务不允许通过界面修改调度表达式",
        });
        return;
      }
      if (task.schedule_kind === "cron") {
        let nextRun: string;
        try {
          nextRun = computeNextRunFromCron({
            cron: expr,
            timezone: task.timezone,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.status(400).json({ success: false, error: `cron 无效: ${msg}` });
          return;
        }
        const r = await updateCronScheduleExprById({
          taskId: id,
          scheduleExpr: expr,
          nextRunTimeIso: nextRun,
        });
        if (r === "not_found") {
          res.status(404).json({ success: false, error: "任务不存在" });
          return;
        }
        if (r === "not_cron") {
          res.status(400).json({
            success: false,
            error: "非 cron 任务不能使用 cron 更新路径",
          });
          return;
        }
      } else {
        const r = await updateOnceScheduleExprById({
          taskId: id,
          scheduleExpr: expr,
        });
        if (r === "not_found") {
          res.status(404).json({ success: false, error: "任务不存在" });
          return;
        }
        if (r === "is_cron") {
          res
            .status(400)
            .json({ success: false, error: "cron 任务请使用 cron 解析路径" });
          return;
        }
      }
      const updated = await getTaskScheduleById(id);
      res.json({ success: true, task: updated ? toWebTaskRow(updated) : null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("patch schedule-expr: %s", msg);
      res.status(500).json({ success: false, error: msg });
    }
  });

  return router;
}
