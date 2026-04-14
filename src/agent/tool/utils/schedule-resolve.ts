import { computeNextRunFromCron } from "../../../watch-dog/cron.js";
import { formatChinaIso } from "../../../watch-dog/time.js";
import type { ToolError } from "../tool-result.js";

export type TryResolveScheduleFieldsResult =
  | {
      ok: true;
      nextRunTime: string;
      scheduleKind: "once" | "cron";
      scheduleExpr: string;
    }
  | { ok: false; text: string; error: ToolError };

/**
 * once / cron 共用：根据 scheduleType、runAt、cron、timezone 解析出下次执行时间与 schedule 元数据。
 * 供 createReminderTask、createAgentTask 等调度类工具复用。
 */
export function tryResolveScheduleFields(params: {
  scheduleType: "cron" | "once";
  runAt?: string;
  cron?: string;
  timezone: string;
}): TryResolveScheduleFieldsResult {
  const { scheduleType, timezone } = params;
  if (scheduleType === "once") {
    const runAt = params.runAt?.trim() || "";
    const ts = Date.parse(runAt);
    if (!runAt || Number.isNaN(ts)) {
      return {
        ok: false,
        text: "once 需要合法 runAt（ISO 时间）",
        error: { code: "INVALID_ARGUMENT", message: "invalid runAt" },
      };
    }
    if (ts <= Date.now()) {
      return {
        ok: false,
        text: "once 的 runAt 必须晚于当前时间",
        error: {
          code: "INVALID_ARGUMENT",
          message: "runAt must be in the future",
        },
      };
    }
    const nextRunTime = formatChinaIso(new Date(ts));
    return {
      ok: true,
      nextRunTime,
      scheduleKind: "once",
      scheduleExpr: nextRunTime,
    };
  }
  const cron = params.cron?.trim() || "";
  if (!cron) {
    return {
      ok: false,
      text: "cron 需要合法 cron 表达式（5 段）",
      error: { code: "INVALID_ARGUMENT", message: "invalid cron" },
    };
  }
  const scheduleExpr = `0 ${cron.replace(/\s+/g, " ").trim()}`;
  try {
    const nextRunTime = computeNextRunFromCron({
      cron: scheduleExpr,
      timezone,
    });
    return {
      ok: true,
      nextRunTime,
      scheduleKind: "cron",
      scheduleExpr,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      text: `cron 表达式不合法: ${message}`,
      error: { code: "INVALID_ARGUMENT", message },
    };
  }
}
