/**
 * 与 HANDLERS 注册表保持一致的 task_type 白名单。
 * 用于 SQL 执行后校验、以及生成示例 SQL 时的类型约束说明。
 */
export const WATCH_DOG_TASK_TYPE_KEYS = [
  "execute_script",
  "execute_reminder",
  "execute_agent",
  "cleanup_logs",
  "one_minute_heartbeat",
] as const;

export type WatchDogTaskTypeKey = (typeof WATCH_DOG_TASK_TYPE_KEYS)[number];

export const WATCH_DOG_TASK_TYPE_SET = new Set<string>(WATCH_DOG_TASK_TYPE_KEYS);
