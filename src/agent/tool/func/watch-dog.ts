/**
 * watch-dog 工具集：调度任务管理
 *
 * 提供：
 * - 展示调度任务列表
 * - 运行调度任务
 * - 删除调度任务
 * - 获取当前时间
 * - 创建提醒任务
 * - 创建智能任务
 *
 * 注意：
 * - 所有工具都依赖于当前 Channel 上下文，因此需要传入 tenantId 和 channel
 * - 所有工具都依赖于系统 prompt 的 ## Channel 章节，因此需要传入 tenantId 和 channel
 * - 所有工具都依赖于系统 prompt 的 ## Channel 章节，因此需要传入 tenantId 和 channel
 *
 * 需要强调的是，当前系统设计并未进行current Channel, current TenantId的权限校验
 * 换句话说，default tenantId可以给所有人创建调度任务. other tenantId也可以为 default 创建调度任务
 *
 * 为什么这么设计，其中一个比较重要的考量是业务场景
 * 当前项目是一个个人项目，你不会让一个不熟悉的人接入当前项目. 话句话说，接入的人应该是你信任的。因此不进行更强的权限校验
 *
 * 如果后续要做，可以通过current runtime tenantId进行权限校验。该参数在 tool 创建的时候传入，因此可以进行更强的权限校验
 * 例如，只有 default tenantId 可以给所有人创建调度任务，其他 tenantId 只能给自己创建调度任务
 *
 */
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import {
  deleteTaskByNameForTenant,
  listTasksByTenant,
  type TaskScheduleRow,
  upsertTaskSchedule,
} from "../../../watch-dog/store.js";
import { runTaskByNameNowForTenant } from "../../../watch-dog/watch-dog.js";
import { errResult, okResult, type ToolDetails } from "../tool-result.js";
import { formatChinaIso } from "../../../watch-dog/time.js";
import { formatBlacklistPresetLines } from "../../../watch-dog/blacklist-presets.js";
import { getQQBotByTenantId } from "../../../middleware/qq/qq-account.js";
import { getWeixinBotByTenantId } from "../../../middleware/weixin/weixin-account.js";
import type { AgentChannel } from "../../channel-policy.js";
import { tryResolveScheduleFields } from "../utils/schedule-resolve.js";
import { CHANNEL_TOOL_PARAM_DESC } from "../utils/channel-tool-param-desc.js";
import { reminderTaskChannelParamProperties } from "../utils/channel-tool-params.schema.js";

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

const listTasksParams = Type.Object({
  tenantId: Type.String({
    minLength: 1,
    description: CHANNEL_TOOL_PARAM_DESC.tenantIdForSessionTools,
  }),
});
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
  tenantId: Type.String({
    minLength: 1,
    description: CHANNEL_TOOL_PARAM_DESC.tenantIdForSessionTools,
  }),
});
type RunTaskInput = Static<typeof runTaskParams>;

const deleteTaskParams = Type.Object({
  task_name: Type.String({
    minLength: 1,
    description:
      "The name of the task to delete. It is recommended to list task schedules first before deleting.",
  }),
  tenantId: Type.String({
    minLength: 1,
    description: CHANNEL_TOOL_PARAM_DESC.tenantIdForSessionTools,
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
  // 展开 reminderTaskChannelParamProperties 中的字段
  ...reminderTaskChannelParamProperties,
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
  channels: Type.Array(
    Type.Union([
      Type.Literal("qq"),
      Type.Literal("weixin"),
      Type.Literal("web"),
    ]),
    {
      minItems: 1,
      description:
        "Required notification channels. Priority: user-specified channels > current channel in system prompt '## Channel' chapter.",
    },
  ),
  tenantId: Type.String({
    minLength: 1,
    description: CHANNEL_TOOL_PARAM_DESC.tenantIdForAgentTask,
  }),
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

function validateTaskTenant(params: {
  tenantId: string;
  channels: Array<"qq" | "weixin" | "web">;
}): { ok: true } | { ok: false; message: string } {
  const tid = params.tenantId.trim();
  if (!tid) {
    return { ok: false, message: "tenantId 不能为空" };
  }
  if (params.channels.includes("qq") && !getQQBotByTenantId(tid)) {
    return {
      ok: false,
      message: `tenantId=${tid} 未绑定 QQ 账号，无法创建提醒任务`,
    };
  }
  if (params.channels.includes("weixin") && !getWeixinBotByTenantId(tid)) {
    return {
      ok: false,
      message: `tenantId=${tid} 未绑定 weixin 账号，无法创建提醒任务`,
    };
  }
  return { ok: true };
}

/**
 * 展示调度任务列表（按租户隔离）。
 * default 租户可查看全部任务，其他租户只能查看自己的任务。
 * @param tenantId 当前租户 ID
 */
export function createListTasksTool(
  tenantId: string,
): ToolDefinition<typeof listTasksParams, ToolDetails<ListTasksOutput>> {
  return {
    name: "listTaskSchedules",
    label: "List Task Schedules",
    description:
      "List task_schedule entries. Default tenant sees all tasks; other tenants see only their own.",
    parameters: listTasksParams,
    execute: async (_id, params: ListTasksInput) => {
      const tid = params.tenantId.trim();
      try {
        const rows = await listTasksByTenant(tid);
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
 * 运行调度任务（按租户权限校验）。
 * default 租户可触发任意任务，其他租户只能触发自己的任务。
 * @param tenantId 当前租户 ID
 */
export function createRunTaskTool(
  tenantId: string,
): ToolDefinition<typeof runTaskParams, ToolDetails<{ ok: boolean }>> {
  return {
    name: "runTaskByName",
    label: "Run Task By Name",
    description:
      "Manually execute a task by task_name immediately. Default tenant can run any task; others can only run their own.",
    parameters: runTaskParams,
    execute: async (_id, params: RunTaskInput) => {
      const tid = params.tenantId.trim();
      if (tid === undefined || tid === "" || tid === null) {
        return errResult(
          "tenantId 不能为空，请从 system prompt ## Channel 中查看并获取",
          {
            code: "INVALID_ARGUMENT",
            message:
              "tenantId required, read from system prompt 'Channel' chapter",
          },
        );
      }
      const taskName = params.task_name.trim();
      if (!taskName) {
        return errResult("task_name 不能为空", {
          code: "INVALID_ARGUMENT",
          message: "task_name 不能为空",
        });
      }
      try {
        const result = await runTaskByNameNowForTenant(taskName, tid);
        if (result === "not_found") {
          return errResult(`未找到任务或缺少 handler：${taskName}`, {
            code: "NOT_FOUND",
            message: "任务不存在或缺少处理器",
          });
        }
        if (result === "forbidden") {
          return errResult(`无权限操作任务：${taskName}`, {
            code: "FORBIDDEN",
            message: "该任务不属于当前租户",
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
export function createDeleteTaskTool(
  tenantId: string,
): ToolDefinition<typeof deleteTaskParams, ToolDetails<{ ok: boolean }>> {
  return {
    name: "deleteTaskByName",
    label: "Delete Task By Name",
    description:
      "Delete a scheduled task by task_name. Default tenant can delete any task; others can only delete their own.",
    parameters: deleteTaskParams,
    execute: async (_id, params: DeleteTaskInput) => {
      const tid = params.tenantId.trim();
      const taskName = params.task_name.trim();
      if (!taskName) {
        return errResult("task_name 不能为空", {
          code: "INVALID_ARGUMENT",
          message: "task_name 不能为空",
        });
      }
      try {
        const result = await deleteTaskByNameForTenant(taskName, tid);
        if (result === "not_found") {
          return errResult(`未找到任务：${taskName}`, {
            code: "NOT_FOUND",
            message: "任务不存在",
          });
        }
        if (result === "forbidden") {
          return errResult(`无权限删除任务：${taskName}`, {
            code: "FORBIDDEN",
            message: "该任务不属于当前租户",
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

export function createReminderTaskTool(
  tenantId: string,
  channel: AgentChannel,
): ToolDefinition<
  typeof createReminderTaskParams,
  ToolDetails<{ task_name: string; task_type: string; next_run_time: string }>
> {
  return {
    name: "createReminderTask",
    label: "Create Reminder Task",
    description:
      "createReminderTask(content, scheduleType, currentChannel, currentTenantId, sendToChannel?, sendToTenantId?, runAt?, cron?, timezone?, taskName?) — create execute_reminder. currentChannel/currentTenantId must match system prompt ## Channel (enforced when registering tools). If sendToChannel or sendToTenantId is omitted, the server defaults to the runtime channel and runtime tenantId.",
    parameters: createReminderTaskParams,
    execute: async (_id, params: CreateReminderTaskInput) => {
      const content = params.content.trim();
      const scheduleType = params.scheduleType;
      const timezone = params.timezone?.trim() || "Asia/Shanghai";
      const runtimeChannel = channel;
      const runtimeTenantId = tenantId.trim();

      const sendToChannelResolved = params.sendToChannel ?? runtimeChannel;
      const sendToTenantId = params.sendToTenantId?.trim() || runtimeTenantId;
      const channels = [sendToChannelResolved] as Array<
        "qq" | "weixin" | "web"
      >;
      const taskName = params.taskName?.trim() || makeTaskName("reminder");

      const scheduleResolved = tryResolveScheduleFields({
        scheduleType,
        runAt: params.runAt,
        cron: params.cron,
        timezone,
      });
      if (!scheduleResolved.ok) {
        return errResult(scheduleResolved.text, scheduleResolved.error);
      }
      const { nextRunTime, scheduleKind, scheduleExpr } = scheduleResolved;

      const payload: Record<string, unknown> = {
        content,
        channels,
        timezone,
      };
      const tid = sendToTenantId;
      const tenantValidation = validateTaskTenant({ tenantId: tid, channels });
      if (!tenantValidation.ok) {
        return errResult(tenantValidation.message, {
          code: "INVALID_ARGUMENT",
          message: tenantValidation.message,
        });
      }
      payload.tenantId = tid;
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
          tenant_id: tid,
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

export function createAgentTaskTool(
  tenantId: string,
): ToolDefinition<
  typeof createAgentTaskParams,
  ToolDetails<{ task_name: string; task_type: string; next_run_time: string }>
> {
  return {
    name: "createAgentTask",
    label: "Create Agent Task",
    description:
      "createAgentTask(goal, scheduleType, runAt?, cron?, timezone?, notify?, channels?, mode?, title?, taskName?) — create execute_agent scheduled task for periodic agent work.",
    parameters: createAgentTaskParams,
    execute: async (_id, params: CreateAgentTaskInput) => {
      const goal = params.goal.trim();
      const scheduleType = params.scheduleType;
      const timezone = params.timezone?.trim() || "Asia/Shanghai";
      const notify = params.notify === true;
      const channels = params.channels as Array<"qq" | "weixin" | "web">;
      const mode = params.mode ?? "evolve";
      const taskTenantId = params.tenantId.trim();
      const taskName =
        params.taskName?.trim() ||
        params.title?.trim() ||
        makeTaskName("agent_task");

      const scheduleResolved = tryResolveScheduleFields({
        scheduleType,
        runAt: params.runAt,
        cron: params.cron,
        timezone,
      });
      if (!scheduleResolved.ok) {
        return errResult(scheduleResolved.text, scheduleResolved.error);
      }
      const { nextRunTime, scheduleKind, scheduleExpr } = scheduleResolved;

      const payload: Record<string, unknown> = {
        goal,
        notify,
        channels,
        timezone,
        mode,
        // 将当前租户 ID 写入 payload，执行时 watch-dog 用它路由 workspace/memory/session 和通知 bot
        tenantId: taskTenantId,
      };
      if (params.blacklistPeriods && params.blacklistPeriods.length > 0) {
        payload.blacklistPeriods = params.blacklistPeriods;
      }

      const tenantValidation = validateTaskTenant({
        tenantId: taskTenantId,
        channels: notify ? channels : ["web"],
      });
      if (!tenantValidation.ok) {
        return errResult(tenantValidation.message, {
          code: "INVALID_ARGUMENT",
          message: tenantValidation.message,
        });
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
          tenant_id: taskTenantId,
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
