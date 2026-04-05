import { CronExpressionParser } from "cron-parser";
import { BLACKLIST_PRESET_CRONS } from "./blacklist-presets.js";
import { normalizeCronTo6 } from "./cron.js";
import type { BlacklistPeriodRule, TaskPayload } from "./types.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";

const log = getSubsystemConsoleLogger("watch-dog:blacklist");

/** 从 payload 解析 `blacklistPeriods`（结构不合法则忽略） */
export function parseBlacklistPeriodsFromPayload(
  payload: TaskPayload,
): BlacklistPeriodRule[] {
  const raw = payload.blacklistPeriods;
  if (!Array.isArray(raw)) return [];
  const out: BlacklistPeriodRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as { type?: unknown; content?: unknown };
    const type = typeof o.type === "string" ? o.type : "";
    const content = typeof o.content === "string" ? o.content : "";
    if (!type || !content.trim()) continue;
    out.push({ type, content });
  }
  return out;
}

/**
 * 若当前时刻命中任一黑名单规则，handler 应跳过业务并返回 success（由 runSingleTask 照常 finalize）。
 */
export function shouldSkipTaskForBlacklistNow(params: {
  payload: TaskPayload;
  timezone: string;
}): boolean {
  const rules = parseBlacklistPeriodsFromPayload(params.payload);
  if (rules.length === 0) return false;
  return isBlacklistedNow({
    at: new Date(),
    timezone: params.timezone,
    rules,
  });
}

/**
 * 先与 `BLACKLIST_PRESET_CRONS` 某项的 `cron` 做 trim 后全等匹配；命中则返回该预设的 cron 字面量；
 * 否则返回 trim 后的自定义五段表达式。
 */
export function resolveBlacklistRuleCron(content: string): string {
  const t = content.trim();
  for (const p of BLACKLIST_PRESET_CRONS) {
    if (p.cron === t) return p.cron;
  }
  return t;
}

/**
 * 判断时刻 `at` 是否为该 cron 的一次「触发点」（与调度器触发到 handler 的 fire time 对齐，秒级对齐）。
 * 先用 {@link resolveBlacklistRuleCron} 对齐预设常量，再解析。
 */
export function isMomentMatchingCronFire(params: {
  at: Date;
  cronExpression: string;
  timezone: string;
}): boolean {
  const { at } = params;
  const cronExpression = resolveBlacklistRuleCron(params.cronExpression);
  let cron6: string;
  try {
    cron6 = normalizeCronTo6(cronExpression);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("invalid blacklist cron: %s", msg);
    return false;
  }
  const tz = params.timezone.trim() || "Asia/Shanghai";
  const atPlus = new Date(at.getTime() + 1500);
  try {
    const expr = CronExpressionParser.parse(cron6, {
      tz,
      currentDate: atPlus,
    });
    const prev = expr.prev();
    // 判断是否在2秒内，避免误判
    return Math.abs(prev.getTime() - at.getTime()) < 2000;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("blacklist cron parse failed: %s", msg);
    return false;
  }
}

export type IsBlacklistedNowInput = {
  at: Date;
  timezone: string;
  rules: BlacklistPeriodRule[];
};

/**
 * 任一规则命中则当前时刻视为黑名单内（应跳过业务逻辑）。
 * 仅处理 `type === "cron"`；其余 type 忽略（预留未来扩展）。
 */
export function isBlacklistedNow(input: IsBlacklistedNowInput): boolean {
  const { at, timezone, rules } = input;
  if (!rules.length) return false;
  const tz = timezone.trim() || "Asia/Shanghai";

  for (const rule of rules) {
    if (rule.type !== "cron") continue;
    const raw = typeof rule.content === "string" ? rule.content.trim() : "";
    if (!raw) continue;
    if (
      isMomentMatchingCronFire({
        at,
        cronExpression: raw,
        timezone: tz,
      })
    ) {
      return true;
    }
  }
  return false;
}
