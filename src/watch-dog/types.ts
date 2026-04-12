// 任务 payload 基础类型，允许按 task_type 定制扩展
export type TaskPayload = Record<string, unknown>;

export {
  BLACKLIST_PRESET_CRONS,
  formatBlacklistPresetLines,
} from "./blacklist-presets.js";

/** 黑名单时段单条规则；当前仅 `type: "cron"` 生效 */
export type BlacklistPeriodRule = {
  type: string;
  content: string;
};

/** 可选黑名单：与 `BLACKLIST_PRESET_CRONS` 中某项 `cron` 完全一致，或自定义五段 Unix cron */
export type BlacklistPayloadFields = {
  blacklistPeriods?: BlacklistPeriodRule[];
};

// execute_script 专用负载
export type ScriptTaskPayload = BlacklistPayloadFields & {
  script: string;
  args?: string[];
  timeoutMs?: number;
};

export type ReminderTaskPayload = BlacklistPayloadFields & {
  content: string;
  channels: Array<"qq" | "weixin" | "web">;
  /**
   * 目标租户 ID，用于路由到对应的 bot 账号（qq/weixin accounts.json 中 bot.tenantId）。
   * channels 含 qq 或 weixin 时必填。
   */
  tenantId?: string;
  timezone?: string;
};

export type AgentTaskPayload = BlacklistPayloadFields & {
  goal: string;
  notify?: boolean;
  channels?: Array<"qq" | "weixin" | "web">;
  /**
   * 执行该任务时使用的租户 ID，决定加载哪个租户的 workspace/memory/session。
   * 通知时也用于路由到对应的 bot 账号。
   */
  tenantId?: string;
  timezone?: string;
  mode?: "evolve" | "analyze_then_notify"; // todo: 我他娘忘了设计这个字段目的是啥了, 以后有时间调研一下
};
