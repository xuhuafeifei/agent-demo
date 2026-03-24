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
import { getLastSeenQQOpenid } from "../../middleware/qq-layer.js";
import { formatChinaIso } from "../../watch-dog/time.js";

const toolLogger = getSubsystemConsoleLogger("tool");

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
      | "interval_seconds"
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

const createReminderTaskParams = Type.Object({
  content: Type.String({
    minLength: 1,
    description:
      "Reminder content, for example: drink water, stand up and move, submit daily report.",
  }),
  scheduleType: Type.Union([Type.Literal("daily_at"), Type.Literal("once")], {
    description:
      "Schedule type: daily_at = run at a fixed time every day, once = run only once.",
  }),
  time: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Required when scheduleType=daily_at. Format: HH:mm (24-hour), e.g., 10:00.",
    }),
  ),
  runAt: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Required when scheduleType=once. Execution time as a parseable datetime string.",
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
});
type CreateReminderTaskInput = Static<typeof createReminderTaskParams>;

const createAgentTaskParams = Type.Object({
  goal: Type.String({
    minLength: 1,
    description:
      "Goal of the agent task, for example: organize recent conversations or summarize industry updates.",
  }),
  scheduleType: Type.Union([Type.Literal("daily_at"), Type.Literal("once")], {
    description:
      "Schedule type: daily_at = run at a fixed time every day, once = run only once.",
  }),
  time: Type.Optional(
    Type.String({
      minLength: 1,
      description: "Required when scheduleType=daily_at. Format: HH:mm.",
    }),
  ),
  runAt: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Required when scheduleType=once. Execution time as a parseable datetime string.",
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
});
type CreateAgentTaskInput = Static<typeof createAgentTaskParams>;

function isValidHHmm(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function toNextDailyRunIso(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((v) => parseInt(v, 10));
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h!, m!, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return formatChinaIso(d);
}

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
          status: row.status,
          next_run_time: row.next_run_time,
          interval_seconds: row.interval_seconds,
          attempts: row.attempts,
          last_error: row.last_error,
        }));
        const summary =
          tasks.length === 0
            ? "No tasks found."
            : tasks
                .map(
                  (t, idx) =>
                    `[${idx + 1}] ${t.task_name} (${t.task_type}) status=${t.status} next=${t.next_run_time} interval=${t.interval_seconds}s attempts=${t.attempts}${t.last_error ? ` last_error=${t.last_error}` : ""}`,
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
      let intervalSeconds: number;

      if (scheduleType === "daily_at") {
        const hhmm = params.time?.trim() || "";
        if (!isValidHHmm(hhmm)) {
          return errResult("daily_at 需要合法 time（HH:mm）", {
            code: "INVALID_ARGUMENT",
            message: "invalid time",
          });
        }
        nextRunTime = toNextDailyRunIso(hhmm);
        intervalSeconds = 86400;
      } else {
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
        intervalSeconds = 0;
      }

      const qqOpenid = getLastSeenQQOpenid();
      const payload = {
        content,
        channels,
        timezone,
        target: qqOpenid ? { qqOpenid } : {},
      };

      try {
        await upsertTaskSchedule({
          task_name: taskName,
          task_type: "execute_reminder",
          payload_text: JSON.stringify(payload),
          interval_seconds: intervalSeconds,
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
      let intervalSeconds: number;

      if (scheduleType === "daily_at") {
        const hhmm = params.time?.trim() || "";
        if (!isValidHHmm(hhmm)) {
          return errResult("daily_at 需要合法 time（HH:mm）", {
            code: "INVALID_ARGUMENT",
            message: "invalid time",
          });
        }
        nextRunTime = toNextDailyRunIso(hhmm);
        intervalSeconds = 86400;
      } else {
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
        intervalSeconds = 0;
      }

      const qqOpenid = getLastSeenQQOpenid();
      const payload = {
        goal,
        notify,
        channels,
        timezone,
        mode,
        target: qqOpenid ? { qqOpenid } : {},
      };

      try {
        await upsertTaskSchedule({
          task_name: taskName,
          task_type: "execute_agent",
          payload_text: JSON.stringify(payload),
          interval_seconds: intervalSeconds,
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
