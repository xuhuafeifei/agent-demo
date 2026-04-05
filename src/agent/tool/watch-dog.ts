import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import {
  deleteTaskByName,
  listAllTasks,
  type TaskScheduleRow,
} from "../../watch-dog/store.js";
import { runTaskByNameNow } from "../../watch-dog/watch-dog.js";
import { upsertTaskSchedule } from "../../watch-dog/store.js";
import { errResult, okResult, type ToolDetails } from "./types.js";
import { getLastSeenQQOpenid } from "../../middleware/qq/qq-layer.js";
import { formatChinaIso } from "../../watch-dog/time.js";
import { computeNextRunFromCron } from "../../watch-dog/cron.js";
import { formatBlacklistPresetLines } from "../../watch-dog/blacklist-presets.js";

const toolLogger = getSubsystemConsoleLogger("tool");

const BLACKLIST_TOOL_PRESET_BLOCK = formatBlacklistPresetLines();

const blacklistPeriodsSchema = Type.Optional(
  Type.Array(
    Type.Object({
      type: Type.Literal("cron", {
        description: 'Only "cron" is evaluated; other values are ignored.',
      }),
      content: Type.String({
        minLength: 1,
        description: [
          "Unix 5-field cron (minute hour day-of-month month day-of-week), OR exact string match (after trim) to one preset cron below.",
          "Model must copy a preset `cron` literally for preset semantics.",
          "Presets:",
          BLACKLIST_TOOL_PRESET_BLOCK,
        ].join("\n"),
      }),
    }),
    {
      minItems: 1,
      description:
        "Optional: do not run business logic when current fire time matches any rule; cron schedules still advance next_run as usual.",
    },
  ),
);

const listTasksParams = Type.Object({});
type ListTasksInput = Static<typeof listTasksParams>;

type ListTasksOutput = {
  tasks: Array<
    Pick<
      TaskScheduleRow,
      | "task_name"
      | "task_type"
      | "status"
      | "next_run_time"
      | "schedule_kind"
      | "schedule_expr"
      | "timezone"
      | "attempts"
      | "last_error"
    >
  >;
};

const runTaskParams = Type.Object({
  task_name: Type.String({
    minLength: 1,
    description: "Scheduled task name (task_schedule.task_name).",
  }),
});
type RunTaskInput = Static<typeof runTaskParams>;

const deleteTaskParams = Type.Object({
  task_name: Type.String({
    minLength: 1,
    description:
      "The name of the task to delete. It is recommended to list task schedules first before deleting.",
  }),
});
type DeleteTaskInput = Static<typeof deleteTaskParams>;

const getNowParams = Type.Object({
  timezone: Type.Optional(
    Type.String({
      minLength: 1,
      description: "Timezone. Defaults to Asia/Shanghai.",
    }),
  ),
});
type GetNowInput = Static<typeof getNowParams>;

type GetNowOutput = {
  now_iso: string;
  now_ms: number;
  timezone: string;
};

const shiftTimeParams = Type.Object({
  time: Type.String({
    minLength: 1,
    description: "Time in HH:mm format.",
  }),
  offset_seconds: Type.Number({
    description: "Seconds offset, can be negative.",
  }),
});
type ShiftTimeInput = Static<typeof shiftTimeParams>;

type ShiftTimeOutput = {
  input_time: string;
  offset_seconds: number;
  result_time: string;
};

const validateCronParams = Type.Object({
  cron: Type.String({
    minLength: 1,
    description:
      "5-field cron (min hour dom mon dow). The system will prepend second=0.",
  }),
  timezone: Type.Optional(
    Type.String({
      minLength: 1,
      description: "Timezone. Defaults to Asia/Shanghai.",
    }),
  ),
});

const createReminderTaskParams = Type.Object({
  content: Type.String({
    minLength: 1,
    description:
      "Reminder content, for example: drink water, stand up and move, submit daily report.",
  }),
  scheduleType: Type.Union([Type.Literal("cron"), Type.Literal("once")], {
    description:
      "Schedule type: cron = recurring based on cron expression, once = run only once.",
  }),
  runAt: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Required when scheduleType=once. Execution time as a parseable datetime string.",
    }),
  ),
  cron: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Required when scheduleType=cron. 5-field cron (min hour dom mon dow). The system will prepend second=0.",
    }),
  ),
  timezone: Type.Optional(
    Type.String({
      minLength: 1,
      description: "Timezone. Defaults to Asia/Shanghai.",
    }),
  ),
  channels: Type.Optional(
    Type.Array(Type.Union([Type.Literal("qq"), Type.Literal("web")]), {
      minItems: 1,
      description:
        "Notification channels. Defaults to [qq]. Use System prompt's ## Channel context to choose the proper delivery channel.",
    }),
  ),
  taskName: Type.Optional(
    Type.String({
      minLength: 1,
      description: "Optional task name. Auto-generated when omitted.",
    }),
  ),
  blacklistPeriods: blacklistPeriodsSchema,
});
type CreateReminderTaskInput = Static<typeof createReminderTaskParams>;

const createAgentTaskParams = Type.Object({
  goal: Type.String({
    minLength: 1,
    description:
      "Goal of the agent task, for example: organize recent conversations or summarize industry updates.",
  }),
  scheduleType: Type.Union([Type.Literal("cron"), Type.Literal("once")], {
    description:
      "Schedule type: cron = recurring based on cron expression, once = run only once.",
  }),
  runAt: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Required when scheduleType=once. Execution time as a parseable datetime string.",
    }),
  ),
  cron: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Required when scheduleType=cron. 5-field cron (min hour dom mon dow). The system will prepend second=0.",
    }),
  ),
  timezone: Type.Optional(
    Type.String({
      minLength: 1,
      description: "Timezone. Defaults to Asia/Shanghai.",
    }),
  ),
  notify: Type.Optional(
    Type.Boolean({
      description:
        "Whether to notify the user with execution results. Defaults to false.",
    }),
  ),
  channels: Type.Optional(
    Type.Array(Type.Union([Type.Literal("qq"), Type.Literal("web")]), {
      minItems: 1,
      description: "Effective when notify=true. Defaults to [qq].",
    }),
  ),
  mode: Type.Optional(
    Type.Union([Type.Literal("evolve"), Type.Literal("analyze_then_notify")], {
      description: "Agent task mode. Defaults to evolve.",
    }),
  ),
  title: Type.Optional(
    Type.String({
      minLength: 1,
      description: "Optional title used to generate a default task name.",
    }),
  ),
  taskName: Type.Optional(
    Type.String({
      minLength: 1,
      description: "Optional task name. Auto-generated when omitted.",
    }),
  ),
  blacklistPeriods: blacklistPeriodsSchema,
});
type CreateAgentTaskInput = Static<typeof createAgentTaskParams>;

function makeTaskName(prefix: string): string {
  return `${prefix}_${Date.now()}`;
}

/**
 * 展示所有调度任务
 */
export function createListTasksTool(): ToolDefinition<
  typeof listTasksParams,
  ToolDetails<ListTasksOutput>
> {
  return {
    name: "listTaskSchedules",
    label: "List Task Schedules",
    description:
      "List all task_schedule entries with status and next_run_time.",
    parameters: listTasksParams,
    execute: async (_id, _params: ListTasksInput) => {
      try {
        const rows = await listAllTasks();
        const tasks = rows.map((row) => ({
          task_name: row.task_name,
          task_type: row.task_type,
          payload_text: row.payload_text,
          status: row.status,
          next_run_time: row.next_run_time,
          schedule_kind: row.schedule_kind,
          schedule_expr: row.schedule_expr,
          timezone: row.timezone,
          attempts: row.attempts,
          last_error: row.last_error,
        }));
        const summary =
          tasks.length === 0
            ? "No tasks found."
            : tasks
                .map(
                  (t, idx) =>
                    `[${idx + 1}] ${t.task_name} (${t.task_type}) kind=${t.schedule_kind} content=${t.payload_text} next=${t.next_run_time} tz=${t.timezone} attempts=${t.attempts}${t.last_error ? ` last_error=${t.last_error}` : ""}`,
                )
                .join("\n");
        return okResult(summary, { tasks });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.error("listTaskSchedules error=%s", message);
        return errResult("listTaskSchedules 失败", {
          code: "INTERNAL_ERROR",
          message,
        });
      }
    },
  };
}

/**
 * 运行调度任务
 */
export function createRunTaskTool(): ToolDefinition<
  typeof runTaskParams,
  ToolDetails<{ ok: boolean }>
> {
  return {
    name: "runTaskByName",
    label: "Run Task By Name",
    description:
      "Manually execute a task by task_name immediately (does not shift its next_run_time for recurring tasks).",
    parameters: runTaskParams,
    execute: async (_id, params: RunTaskInput) => {
      const taskName = params.task_name.trim();
      if (!taskName) {
        return errResult("task_name 不能为空", {
          code: "INVALID_ARGUMENT",
          message: "task_name 不能为空",
        });
      }
      try {
        const ok = await runTaskByNameNow(taskName);
        if (!ok) {
          return errResult(`未找到任务或缺少 handler：${taskName}`, {
            code: "NOT_FOUND",
            message: "任务不存在或缺少处理器",
          });
        }
        return okResult(`任务 ${taskName} 已立即执行`, { ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.error("runTaskByName error=%s", message);
        return errResult("runTaskByName 失败", {
          code: "INTERNAL_ERROR",
          message,
        });
      }
    },
  };
}

/**
 * 删除调度任务（建议配合“删除后重建”修改任务）
 */
export function createDeleteTaskTool(): ToolDefinition<
  typeof deleteTaskParams,
  ToolDetails<{ ok: boolean }>
> {
  return {
    name: "deleteTaskByName",
    label: "Delete Task By Name",
    description:
      "Delete a scheduled task by task_name (also removes task details).",
    parameters: deleteTaskParams,
    execute: async (_id, params: DeleteTaskInput) => {
      const taskName = params.task_name.trim();
      if (!taskName) {
        return errResult("task_name 不能为空", {
          code: "INVALID_ARGUMENT",
          message: "task_name 不能为空",
        });
      }
      try {
        const ok = await deleteTaskByName(taskName);
        if (!ok) {
          return errResult(`未找到任务：${taskName}`, {
            code: "NOT_FOUND",
            message: "任务不存在",
          });
        }
        return okResult(`任务 ${taskName} 已删除`, { ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.error("deleteTaskByName error=%s", message);
        return errResult("deleteTaskByName 失败", {
          code: "INTERNAL_ERROR",
          message,
        });
      }
    },
  };
}

export function createGetNowTool(): ToolDefinition<
  typeof getNowParams,
  ToolDetails<GetNowOutput>
> {
  return {
    name: "getNow",
    label: "Get Now",
    description: "Get current time (ISO) and unix ms.",
    parameters: getNowParams,
    execute: async (_id, params: GetNowInput) => {
      const timezone = params.timezone?.trim() || "Asia/Shanghai";
      const nowMs = Date.now();
      const nowIso = formatChinaIso(new Date(nowMs));
      return okResult(nowIso, { now_iso: nowIso, now_ms: nowMs, timezone });
    },
  };
}

function isValidHHmm(value: string): boolean {
  return /^([01]\\d|2[0-3]):([0-5]\\d)$/.test(value);
}

export function createShiftTimeTool(): ToolDefinition<
  typeof shiftTimeParams,
  ToolDetails<ShiftTimeOutput>
> {
  return {
    name: "shiftTime",
    label: "Shift Time",
    description: "Shift a HH:mm time by offset_seconds (wraps around 24h).",
    parameters: shiftTimeParams,
    execute: async (_id, params: ShiftTimeInput) => {
      const time = params.time.trim();
      if (!isValidHHmm(time)) {
        return errResult("time 需要合法 HH:mm", {
          code: "INVALID_ARGUMENT",
          message: "invalid time",
        });
      }
      const offsetSeconds = Math.trunc(params.offset_seconds);
      if (!Number.isFinite(offsetSeconds)) {
        return errResult("offset_seconds 需要是数字", {
          code: "INVALID_ARGUMENT",
          message: "invalid offset_seconds",
        });
      }
      const [hh, mm] = time.split(":").map((v) => parseInt(v, 10));
      const base = (hh! * 60 + mm!) * 60;
      const day = 24 * 3600;
      const shifted = (((base + offsetSeconds) % day) + day) % day;
      const outH = String(Math.floor(shifted / 3600)).padStart(2, "0");
      const outM = String(Math.floor((shifted % 3600) / 60)).padStart(2, "0");
      const resultTime = `${outH}:${outM}`;
      return okResult(resultTime, {
        input_time: time,
        offset_seconds: offsetSeconds,
        result_time: resultTime,
      });
    },
  };
}

/**
 * @deprecated 未来删掉这个工具
 */
export function createValidateCronTool(): ToolDefinition<
  typeof validateCronParams,
  ToolDetails<{ ok: boolean }>
> {
  return {
    name: "validateCron",
    label: "Validate Cron",
    description: "Validate cron expression (not implemented yet).",
    parameters: validateCronParams,
    execute: async () => {
      return errResult("validateCron 暂未实现", {
        code: "INTERNAL_ERROR",
        message: "not implemented",
      });
    },
  };
}

export function createReminderTaskTool(): ToolDefinition<
  typeof createReminderTaskParams,
  ToolDetails<{ task_name: string; task_type: string; next_run_time: string }>
> {
  return {
    name: "createReminderTask",
    label: "Create Reminder Task",
    description:
      "Create execute_reminder scheduled task with fixed reminder content.",
    parameters: createReminderTaskParams,
    execute: async (_id, params: CreateReminderTaskInput) => {
      const content = params.content.trim();
      const scheduleType = params.scheduleType;
      const timezone = params.timezone?.trim() || "Asia/Shanghai";
      const channels = (
        params.channels && params.channels.length > 0 ? params.channels : ["qq"]
      ) as Array<"qq" | "web">;
      const taskName = params.taskName?.trim() || makeTaskName("reminder");
      let nextRunTime: string;
      let scheduleKind: "once" | "cron";
      let scheduleExpr: string;

      if (scheduleType === "once") {
        const runAt = params.runAt?.trim() || "";
        const ts = Date.parse(runAt);
        if (!runAt || Number.isNaN(ts)) {
          return errResult("once 需要合法 runAt（ISO 时间）", {
            code: "INVALID_ARGUMENT",
            message: "invalid runAt",
          });
        }
        if (ts <= Date.now()) {
          return errResult("once 的 runAt 必须晚于当前时间", {
            code: "INVALID_ARGUMENT",
            message: "runAt must be in the future",
          });
        }
        nextRunTime = formatChinaIso(new Date(ts));
        scheduleKind = "once";
        scheduleExpr = nextRunTime;
      } else {
        const cron = params.cron?.trim() || "";
        if (!cron) {
          return errResult("cron 需要合法 cron 表达式（5 段）", {
            code: "INVALID_ARGUMENT",
            message: "invalid cron",
          });
        }
        scheduleKind = "cron";
        scheduleExpr = `0 ${cron.replace(/\s+/g, " ").trim()}`;
        try {
          nextRunTime = computeNextRunFromCron({
            cron: scheduleExpr,
            timezone,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return errResult(`cron 表达式不合法: ${message}`, {
            code: "INVALID_ARGUMENT",
            message,
          });
        }
      }

      const qqOpenid = getLastSeenQQOpenid();
      const payload: Record<string, unknown> = {
        content,
        channels,
        timezone,
        target: qqOpenid ? { qqOpenid } : {},
      };
      if (params.blacklistPeriods && params.blacklistPeriods.length > 0) {
        payload.blacklistPeriods = params.blacklistPeriods;
      }

      try {
        await upsertTaskSchedule({
          task_name: taskName,
          task_type: "execute_reminder",
          payload_text: JSON.stringify(payload),
          schedule_kind: scheduleKind,
          schedule_expr: scheduleExpr,
          timezone,
          next_run_time: nextRunTime,
          status: "pending",
        });
        return okResult(`已创建提醒任务 ${taskName}`, {
          task_name: taskName,
          task_type: "execute_reminder",
          next_run_time: nextRunTime,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errResult(`创建提醒任务失败: ${message}`, {
          code: "INTERNAL_ERROR",
          message,
        });
      }
    },
  };
}

export function createAgentTaskTool(): ToolDefinition<
  typeof createAgentTaskParams,
  ToolDetails<{ task_name: string; task_type: string; next_run_time: string }>
> {
  return {
    name: "createAgentTask",
    label: "Create Agent Task",
    description:
      "Create execute_agent scheduled task for intelligent periodic work.",
    parameters: createAgentTaskParams,
    execute: async (_id, params: CreateAgentTaskInput) => {
      const goal = params.goal.trim();
      const scheduleType = params.scheduleType;
      const timezone = params.timezone?.trim() || "Asia/Shanghai";
      const notify = params.notify === true;
      const channels = (
        params.channels && params.channels.length > 0 ? params.channels : ["qq"]
      ) as Array<"qq" | "web">;
      const mode = params.mode ?? "evolve";
      const taskName =
        params.taskName?.trim() ||
        params.title?.trim() ||
        makeTaskName("agent_task");
      let nextRunTime: string;
      let scheduleKind: "once" | "cron";
      let scheduleExpr: string;

      if (scheduleType === "once") {
        const runAt = params.runAt?.trim() || "";
        const ts = Date.parse(runAt);
        if (!runAt || Number.isNaN(ts)) {
          return errResult("once 需要合法 runAt（ISO 时间）", {
            code: "INVALID_ARGUMENT",
            message: "invalid runAt",
          });
        }
        if (ts <= Date.now()) {
          return errResult("once 的 runAt 必须晚于当前时间", {
            code: "INVALID_ARGUMENT",
            message: "runAt must be in the future",
          });
        }
        nextRunTime = formatChinaIso(new Date(ts));
        scheduleKind = "once";
        scheduleExpr = nextRunTime;
      } else {
        const cron = params.cron?.trim() || "";
        if (!cron) {
          return errResult("cron 需要合法 cron 表达式（5 段）", {
            code: "INVALID_ARGUMENT",
            message: "invalid cron",
          });
        }
        scheduleKind = "cron";
        scheduleExpr = `0 ${cron.replace(/\s+/g, " ").trim()}`;
        try {
          nextRunTime = computeNextRunFromCron({
            cron: scheduleExpr,
            timezone,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return errResult(`cron 表达式不合法: ${message}`, {
            code: "INVALID_ARGUMENT",
            message,
          });
        }
      }

      const qqOpenid = getLastSeenQQOpenid();
      const payload: Record<string, unknown> = {
        goal,
        notify,
        channels,
        timezone,
        mode,
        target: qqOpenid ? { qqOpenid } : {},
      };
      if (params.blacklistPeriods && params.blacklistPeriods.length > 0) {
        payload.blacklistPeriods = params.blacklistPeriods;
      }

      try {
        await upsertTaskSchedule({
          task_name: taskName,
          task_type: "execute_agent",
          payload_text: JSON.stringify(payload),
          schedule_kind: scheduleKind,
          schedule_expr: scheduleExpr,
          timezone,
          next_run_time: nextRunTime,
          status: "pending",
        });
        return okResult(`已创建智能任务 ${taskName}`, {
          task_name: taskName,
          task_type: "execute_agent",
          next_run_time: nextRunTime,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errResult(`创建智能任务失败: ${message}`, {
          code: "INTERNAL_ERROR",
          message,
        });
      }
    },
  };
}
