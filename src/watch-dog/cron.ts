import { CronExpressionParser } from "cron-parser";
import { formatChinaIso } from "./time.js";

/** 将五段 Unix cron 补秒为 0，或原样返回六段表达式（供 cron-parser 使用）。 */
export function normalizeCronTo6(cron: string): string {
  const parts = cron.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 5) return `0 ${parts.join(" ")}`;
  if (parts.length === 6) return parts.join(" ");
  throw new Error("cron must have 5 or 6 fields");
}

export function computeNextRunFromCron(input: {
  cron: string;
  timezone?: string;
}): string {
  const timezone = input.timezone?.trim() || "Asia/Shanghai";
  const cron6 = normalizeCronTo6(input.cron);
  // Use "now" as the base. Add 1 second to avoid returning the same slot.
  const expr = CronExpressionParser.parse(cron6, {
    tz: timezone,
    currentDate: new Date(Date.now() + 1000),
  });
  const next = expr.next();
  // Persist as the project's canonical ISO format (+08:00 string).
  return formatChinaIso(new Date(next.getTime()));
}

