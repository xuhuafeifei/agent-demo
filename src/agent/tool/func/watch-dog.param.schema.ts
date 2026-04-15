// 源文件太长了，单独拆分schema文件
import { Type } from "@sinclair/typebox";
import { formatBlacklistPresetLines } from "../../../watch-dog/blacklist-presets.js";
import { CHANNEL_TOOL_PARAM_DESC } from "../utils/channel-tool-param-desc.js";
import { reminderTaskChannelParamProperties } from "../utils/channel-tool-params.schema.js";

const BLACKLIST_TOOL_PRESET_BLOCK = formatBlacklistPresetLines();

export const blacklistPeriodsSchema = Type.Optional(
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

export const listTasksParams = Type.Object({
  tenantId: Type.String({
    minLength: 1,
    description: CHANNEL_TOOL_PARAM_DESC.tenantIdForSessionTools,
  }),
});

export const runTaskParams = Type.Object({
  task_name: Type.String({
    minLength: 1,
    description: "Scheduled task name (task_schedule.task_name).",
  }),
  tenantId: Type.String({
    minLength: 1,
    description: CHANNEL_TOOL_PARAM_DESC.tenantIdForSessionTools,
  }),
});

export const deleteTaskParams = Type.Object({
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

export const getNowParams = Type.Object({
  timezone: Type.Optional(
    Type.String({
      minLength: 1,
      description: "Timezone. Defaults to Asia/Shanghai.",
    }),
  ),
});

export const createReminderTaskParams = Type.Object({
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
  ...reminderTaskChannelParamProperties,
  taskName: Type.Optional(
    Type.String({
      minLength: 1,
      description: "Optional task name. Auto-generated when omitted.",
    }),
  ),
  blacklistPeriods: blacklistPeriodsSchema,
});

export const createAgentTaskParams = Type.Object({
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
