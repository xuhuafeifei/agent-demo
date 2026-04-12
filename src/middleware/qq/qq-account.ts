import fs from "node:fs";
import path from "node:path";
import type { QqbotChannelConfigView } from "../../types.js";
import { resolveStateDir } from "../../utils/app-path.js";

/** 主用户 QQ 机器人租户 ID */
export const QQ_DEFAULT_TENANT_ID = "default" as const;

/** QQ 机器人账号最大数量限制 */
export const MAX_QQ_BOTS = 1;

/**
 * 单条 QQ 机器人账号信息。
 * 持久化存储于 ~/.fgbg/qq/accounts.json。
 */
export type QQAccount = {
  tenantId: string;      // 租户 ID，对应 ~/.fgbg/tenants/{tenantId}
  appId: string;         // 腾讯开放平台应用ID
  clientSecret: string;  // 腾讯开放平台应用密钥
  targetOpenId: string;  // 目标用户的 OpenID（用于私聊）
};

/**
 * QQ 机器人账号存储结构。
 * primary 指向主用 bot 的 tenantId。
 */
export type QQAccountsStore = {
  bots: QQAccount[];
  primary: string;
};

/** 空账号初始值 */
const EMPTY_ACCOUNT = (): QQAccount => ({
  tenantId: QQ_DEFAULT_TENANT_ID,
  appId: "",
  clientSecret: "",
  targetOpenId: "",
});

const DEFAULT_STORE: QQAccountsStore = {
  bots: [],
  primary: QQ_DEFAULT_TENANT_ID,
};

/** 获取 QQ 账号存储目录，不存在则创建 */
function dir(): string {
  const d = path.join(resolveStateDir(), "qq");
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

/** QQ 账号存储文件路径 */
export function qqAccountsPath(): string {
  return path.join(dir(), "accounts.json");
}

/** 规范化租户 ID，空时回落到默认值 */
function normalizeTenantId(s: string): string {
  return s.trim() || QQ_DEFAULT_TENANT_ID;
}

/** 校验 QQAccount 数据结构 */
function validBotShape(x: unknown): x is QQAccount {
  if (!x || typeof x !== "object") return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.tenantId === "string" &&
    typeof v.appId === "string" &&
    typeof v.clientSecret === "string" &&
    (typeof v.targetOpenId === "string" || v.targetOpenId === undefined)
  );
}

/**
 * 加载 QQ 机器人账号存储。
 * 文件不存在或解析失败时返回空存储。
 */
export function loadQQAccounts(): QQAccountsStore {
  try {
    const p = qqAccountsPath();
    if (!fs.existsSync(p)) return { ...DEFAULT_STORE };

    const j = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<QQAccountsStore>;
    const bots = Array.isArray(j.bots)
      ? j.bots.filter(validBotShape).slice(0, MAX_QQ_BOTS)
      : [];
    const primary =
      typeof j.primary === "string" && j.primary.trim()
        ? j.primary.trim()
        : QQ_DEFAULT_TENANT_ID;

    const normalized: QQAccountsStore = {
      bots: bots.map((b) => ({
        tenantId: normalizeTenantId(b.tenantId),
        appId: b.appId.trim(),
        clientSecret: b.clientSecret.trim(),
        targetOpenId: typeof b.targetOpenId === "string" ? b.targetOpenId.trim() : "",
      })),
      primary,
    };

    // 确保 primary 指向一个存在的 bot
    if (normalized.primary && !normalized.bots.some((b) => b.tenantId === normalized.primary)) {
      normalized.primary = normalized.bots[0]?.tenantId ?? QQ_DEFAULT_TENANT_ID;
    }

    return normalized;
  } catch {
    return { ...DEFAULT_STORE };
  }
}

/** 保存 QQ 机器人账号存储 */
export function saveQQAccounts(store: QQAccountsStore): void {
  const bots = store.bots.slice(0, MAX_QQ_BOTS).map((b) => ({
    tenantId: normalizeTenantId(b.tenantId),
    appId: b.appId.trim(),
    clientSecret: b.clientSecret.trim(),
    targetOpenId: (b.targetOpenId ?? "").trim(),
  }));
  const primary = store.primary?.trim() || bots[0]?.tenantId || QQ_DEFAULT_TENANT_ID;

  fs.writeFileSync(
    qqAccountsPath(),
    `${JSON.stringify({ bots, primary }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

/**
 * 获取主用 QQ 机器人账号。
 * 优先匹配 primary，其次 tenantId=default，最后第一个。
 */
export function getPrimaryQQBot(): QQAccount | null {
  const s = loadQQAccounts();
  if (s.bots.length === 0) return null;

  const want = s.primary?.trim() || QQ_DEFAULT_TENANT_ID;
  return (
    s.bots.find((b) => b.tenantId === want) ??
    s.bots.find((b) => b.tenantId === QQ_DEFAULT_TENANT_ID) ??
    s.bots[0] ??
    null
  );
}

/** 按 tenantId 查找 bot */
export function getQQBotByTenantId(tenantId: string): QQAccount | null {
  const id = normalizeTenantId(tenantId);
  const s = loadQQAccounts();
  return s.bots.find((b) => b.tenantId === id) ?? null;
}

/** 确保默认 bot 存在于存储中 */
function ensureDefaultBot(store: QQAccountsStore): QQAccount {
  let b = store.bots.find((x) => x.tenantId === QQ_DEFAULT_TENANT_ID);
  if (!b) {
    b = EMPTY_ACCOUNT();
    store.bots = [...store.bots, b];
  }
  if (!store.primary?.trim()) store.primary = QQ_DEFAULT_TENANT_ID;
  return b;
}

/**
 * 更新主用 QQ 机器人的应用凭证（appId / clientSecret）。
 */
export function mergePrimaryQQBotCredentials(params: {
  appId?: string;
  clientSecret?: string;
}): void {
  const store = loadQQAccounts();
  const bot = ensureDefaultBot(store);
  if (params.appId !== undefined) bot.appId = params.appId.trim();
  if (params.clientSecret !== undefined) bot.clientSecret = params.clientSecret.trim();
  saveQQAccounts(store);
}

/**
 * 按 appId 更新对应机器人的私聊目标 OpenID。
 * 收到私聊消息时调用，跟踪和更新目标用户的 OpenID。
 */
export function setQQBotTargetOpenIdByAppId(appId: string, targetOpenId: string): void {
  const aid = appId.trim();
  const tid = targetOpenId.trim();
  if (!aid || !tid) return;

  const store = loadQQAccounts();
  const hit = store.bots.find((b) => b.appId === aid);
  if (hit) {
    hit.targetOpenId = tid;
    saveQQAccounts(store);
    return;
  }

  // 未找到时写入默认 bot
  const bot = ensureDefaultBot(store);
  bot.appId = aid;
  bot.targetOpenId = tid;
  saveQQAccounts(store);
}

/** 按 appId 查询目标用户的 OpenID */
export function getQQTargetOpenIdForAppId(appId: string): string {
  const id = appId.trim();
  if (!id) return "";
  const b = loadQQAccounts().bots.find((x) => x.appId === id);
  return b?.targetOpenId?.trim() ?? "";
}

/** 清除 QQ 机器人账号信息 */
export function clearQQAccounts(): void {
  try {
    const p = qqAccountsPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* 忽略删除错误 */
  }
}

/** 检查是否已配置 QQ 机器人凭证 */
export function hasQQAccountCredentials(): boolean {
  const b = getPrimaryQQBot();
  return Boolean(b && (b.appId.length > 0 || b.clientSecret.length > 0));
}

/** GET /config/fgbg 接口：把 accounts 中的字段拼成展示对象 */
export function getQqbotChannelForApi(enabled: boolean): QqbotChannelConfigView {
  const bot = getPrimaryQQBot();
  return {
    enabled,
    appId: bot?.appId ?? "",
    clientSecret: bot?.clientSecret ?? "",
    hasCredentials: hasQQAccountCredentials(),
    targetOpenid: bot?.targetOpenId ?? "",
  };
}
