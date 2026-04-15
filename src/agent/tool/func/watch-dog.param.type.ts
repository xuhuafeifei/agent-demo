// 源文件 watch-dog太长了，拆分
import type { TaskScheduleRow } from "../../../watch-dog/store.js";

export type TaskChannel = "qq" | "weixin" | "web";

export type BlacklistPeriod = {
  type: "cron";
  content: string;
};

export type ListTasksInput = {
  tenantId: string;
};

export type ListTasksOutput = {
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

export type RunTaskInput = {
  task_name: string;
  tenantId: string;
};

export type DeleteTaskInput = {
  task_name: string;
  tenantId: string;
};

export type GetNowInput = {
  timezone?: string;
};

export type GetNowOutput = {
  now_iso: string;
  now_ms: number;
  timezone: string;
};

export type CreateReminderTaskInput = {
  content: string;
  scheduleType: "cron" | "once";
  runAt?: string;
  cron?: string;
  timezone?: string;
  currentChannel: TaskChannel;
  currentTenantId: string;
  sendToChannel?: TaskChannel;
  sendToTenantId?: string;
  taskName?: string;
  blacklistPeriods?: BlacklistPeriod[];
};

export type CreateAgentTaskInput = {
  goal: string;
  scheduleType: "cron" | "once";
  runAt?: string;
  cron?: string;
  timezone?: string;
  notify?: boolean;
  channels: TaskChannel[];
  tenantId: string;
  mode?: "evolve" | "analyze_then_notify";
  title?: string;
  taskName?: string;
  blacklistPeriods?: BlacklistPeriod[];
};
