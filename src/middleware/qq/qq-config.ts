import { readFgbgUserConfig } from "../../config/index.js";
import { getPrimaryQQBot } from "./qq-account.js";

export type ResolvedQQAccount = {
  accountId: string;
  appId: string;
  clientSecret: string;
  source: "qq-accounts";
};

export function resolveQQAccountFromConfig(): ResolvedQQAccount | null {
  const cfg = readFgbgUserConfig();
  if (!cfg.channels.qqbot.enabled) return null;
  const bot = getPrimaryQQBot();
  if (!bot?.appId?.trim() || !bot?.clientSecret?.trim()) return null;

  const appId = bot.appId.trim();
  return {
    accountId: appId,
    appId,
    clientSecret: bot.clientSecret.trim(),
    source: "qq-accounts",
  } satisfies ResolvedQQAccount;
}
