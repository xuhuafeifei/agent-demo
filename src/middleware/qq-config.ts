import { getUserFgbgConfig } from "../utils/app-path.js";

export type ResolvedQQAccount = {
  accountId: string;
  appId: string;
  clientSecret: string;
  source: "fgbg-config";
};

const DEFAULT_ACCOUNT_ID = "default";

export function resolveQQAccountFromConfig(): ResolvedQQAccount | null {
  const cfg = getUserFgbgConfig();
  const qqbot = cfg.channels?.qqbot;
  if (!qqbot) return null;
  if (qqbot.enabled === false) {
    return null;
  }

  const requestedAccountId = DEFAULT_ACCOUNT_ID;
  const hasDefault =
    typeof qqbot.appId === "string" &&
    qqbot.appId.trim().length > 0 &&
    typeof qqbot.clientSecret === "string" &&
    qqbot.clientSecret.trim().length > 0;

  if (requestedAccountId === DEFAULT_ACCOUNT_ID && hasDefault) {
    return {
      accountId: DEFAULT_ACCOUNT_ID,
      appId: qqbot.appId!.trim(),
      clientSecret: qqbot.clientSecret!.trim(),
      source: "fgbg-config",
    };
  }

  const account = qqbot.accounts?.[requestedAccountId];
  if (
    account &&
    account.enabled !== false &&
    typeof account.appId === "string" &&
    account.appId.trim().length > 0 &&
    typeof account.clientSecret === "string" &&
    account.clientSecret.trim().length > 0
  ) {
    return {
      accountId: requestedAccountId,
      appId: account.appId.trim(),
      clientSecret: account.clientSecret.trim(),
      source: "fgbg-config",
    };
  }

  // 自动回退到可用的 default 账号或第一个 enabled account
  if (hasDefault) {
    return {
      accountId: DEFAULT_ACCOUNT_ID,
      appId: qqbot.appId!.trim(),
      clientSecret: qqbot.clientSecret!.trim(),
      source: "fgbg-config",
    };
  }

  if (qqbot.accounts) {
    for (const [accountId, item] of Object.entries(qqbot.accounts)) {
      if (
        item.enabled !== false &&
        typeof item.appId === "string" &&
        item.appId.trim().length > 0 &&
        typeof item.clientSecret === "string" &&
        item.clientSecret.trim().length > 0
      ) {
        return {
          accountId,
          appId: item.appId.trim(),
          clientSecret: item.clientSecret.trim(),
          source: "fgbg-config",
        };
      }
    }
  }

  return null;
}
