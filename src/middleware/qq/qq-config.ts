import { readFgbgUserConfig } from "../../config/index.js";

export type ResolvedQQAccount = {
  accountId: string;
  appId: string;
  clientSecret: string;
  source: "fgbg-config";
};

export function resolveQQAccountFromConfig(): ResolvedQQAccount | null {
  const cfg = readFgbgUserConfig();
  const qqbot = cfg.channels.qqbot;
  if (!qqbot) return null;
  if (qqbot.enabled === false) {
    return null;
  }

  return {
    accountId: qqbot.appId.trim(),
    appId: qqbot.appId.trim(),
    clientSecret: qqbot.clientSecret.trim(),
    source: "fgbg-config",
  } as ResolvedQQAccount;
}
