/**
 * 黑名单「预设」：每项为完整五段 Unix cron（分 时 日 月 周）。
 * 大模型填入 payload.blacklistPeriods[].content 时须与某条 `cron` 字段 **完全一致**（trim 后 ===），
 * 系统据此识别语义；勿用自然语言别名。
 */
export const BLACKLIST_PRESET_CRONS = [
  {
    key: "weekend",
    description: "周末（周六、周日每分钟均视为命中黑名单时段）",
    cron: "* * * * 0,6",
  },
  {
    key: "lunch",
    description: "午休（每日 12:00–13:59，每分钟命中）",
    cron: "* 12-13 * * *",
  },
  {
    key: "evening",
    description: "晚间（每日 22:00–23:59，每分钟命中）",
    cron: "* 22-23 * * *",
  },
] as const;

export type BlacklistPreset = (typeof BLACKLIST_PRESET_CRONS)[number];

/** 供工具 / 文档：列出预设的 cron 字面量与中文说明 */
export function formatBlacklistPresetLines(): string {
  return BLACKLIST_PRESET_CRONS.map(
    (p) => `- \`${p.cron}\` — ${p.description}（key=${p.key}）`,
  ).join("\n");
}
