const CN_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/**
 * 将 Date 格式化为中国时区 ISO 字符串（固定 +08:00）。
 * 示例：2026-03-24T20:57:11.771+08:00
 */
export function formatChinaIso(date: Date): string {
  const cn = new Date(date.getTime() + CN_OFFSET_MS);
  const y = cn.getUTCFullYear();
  const m = pad2(cn.getUTCMonth() + 1);
  const d = pad2(cn.getUTCDate());
  const hh = pad2(cn.getUTCHours());
  const mm = pad2(cn.getUTCMinutes());
  const ss = pad2(cn.getUTCSeconds());
  const ms = pad3(cn.getUTCMilliseconds());
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}.${ms}+08:00`;
}

/** 当前中国时区时间字符串（+08:00） */
export function nowChinaIso(): string {
  return formatChinaIso(new Date());
}

/** 在指定基准时间（毫秒）上增加 seconds，返回中国时区字符串 */
export function addSecondsChinaIso(baseMs: number, seconds: number): string {
  return formatChinaIso(new Date(baseMs + seconds * 1000));
}

/**
 * 中国时区（Asia/Shanghai）下「某个 UTC 时刻」对应的日历日的起止时间字符串。
 * 用于按 `create_time` 等字段做闭区间过滤；与库中 +08:00 格式一致。
 */
export function chinaCalendarDayBoundsFromUtcMs(
  utcMs: number,
): { day: string; fromIso: string; toIso: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  const day = `${y}-${m}-${d}`;
  return {
    day,
    fromIso: `${day}T00:00:00.000+08:00`,
    toIso: `${day}T23:59:59.999+08:00`,
  };
}
