/**
 * 微信账户管理模块
 *
 * 负责微信 Bot 配置的持久化和管理，所有函数以 tenantId 作为 Bot 唯一标识符。
 * 文件路径：~/.fgbg/weixin/accounts.json
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../utils/app-path.js";

export const MAX_WEIXIN_BOTS = 3;
/** tenantId 合法格式：字母、数字、下划线 */
export const TENANT_ID_RE = /^[A-Za-z0-9_]+$/;
/** 默认微信 Bot 的租户 ID */
export const WX_DEFAULT_TENANT_ID = "default" as const;

/**
 * 微信绑定 Bot 的完整配置。
 * 以 tenantId 作为唯一标识符，对应 ~/.fgbg/tenants/{tenantId}。
 */
export type WeixinBoundBot = {
  tenantId: string;              // 租户 ID，唯一标识该 bot
  token: string;                 // 微信接口调用令牌
  baseUrl: string;               // 微信接口基础 URL
  botId: string;                 // 微信 Bot 系统内部 ID
  linkedUserId: string;          // 绑定的微信用户 ID
  updateBuf: string;             // 长轮询更新缓冲区
  peerUserId: string;            // 对手方用户 ID（用于主动发送消息）
  contextToken: string;          // iLink 上下文令牌
  sessionPausedUntil: number;    // 会话暂停截止时间戳（0 表示未暂停）
  updatedAt: string;             // 最后更新时间
};

/** 微信账户存储结构，primary 存主 Bot 的 tenantId */
export type WeixinAccountsStore = {
  bots: WeixinBoundBot[];
  primary: string;
};

const DEFAULT_STORE: WeixinAccountsStore = { bots: [], primary: "" };

/** 获取微信 Bot 配置存储目录（不存在则创建） */
function dir(): string {
  const d = path.join(resolveStateDir(), "weixin");
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

const accountsPath = () => path.join(dir(), "accounts.json");

/** 规范化租户 ID */
function normalizeTenantId(tenantId: string): string {
  return tenantId.trim();
}

/** 校验 tenantId 格式 */
export function isValidTenantId(tenantId: string): boolean {
  return TENANT_ID_RE.test(normalizeTenantId(tenantId));
}

/** 校验 Bot 配置对象形状 */
function validBotShape(x: unknown): x is WeixinBoundBot {
  if (!x || typeof x !== "object") return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.tenantId === "string" &&
    isValidTenantId(v.tenantId) &&
    typeof v.token === "string" &&
    typeof v.baseUrl === "string" &&
    typeof v.botId === "string" &&
    typeof v.linkedUserId === "string"
  );
}

/**
 * 加载微信账户配置。
 * 文件不存在或解析失败则返回空存储。
 */
export function loadWeixinAccounts(): WeixinAccountsStore {
  try {
    const p = accountsPath();
    if (!fs.existsSync(p)) return DEFAULT_STORE;
    const j = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<WeixinAccountsStore>;
    const bots = Array.isArray(j.bots)
      ? j.bots.filter(validBotShape).slice(0, MAX_WEIXIN_BOTS)
      : [];
    const primary = typeof j.primary === "string" ? j.primary.trim() : "";
    const normalized = {
      bots: bots.map((b) => ({
        tenantId: normalizeTenantId(b.tenantId),
        token: b.token.trim(),
        baseUrl: b.baseUrl.trim(),
        botId: b.botId.trim(),
        linkedUserId: b.linkedUserId.trim(),
        updateBuf: (b.updateBuf ?? "").trim(),
        peerUserId: ((b as Record<string, unknown>).peerUserId as string ?? "").trim(),
        contextToken: ((b as Record<string, unknown>).contextToken as string ?? "").trim(),
        sessionPausedUntil: Number((b as Record<string, unknown>).sessionPausedUntil ?? 0) || 0,
        updatedAt: b.updatedAt || new Date().toISOString(),
      })),
      primary,
    };
    if (normalized.primary && !normalized.bots.some((b) => b.tenantId === normalized.primary)) {
      normalized.primary = normalized.bots[0]?.tenantId ?? "";
    }
    return normalized;
  } catch {
    return DEFAULT_STORE;
  }
}

/** 保存微信账户配置 */
export function saveWeixinAccounts(store: WeixinAccountsStore): void {
  const bots = store.bots.slice(0, MAX_WEIXIN_BOTS).map((b) => ({
    ...b,
    tenantId: normalizeTenantId(b.tenantId),
    updateBuf: (b.updateBuf ?? "").trim(),
    updatedAt: b.updatedAt || new Date().toISOString(),
  }));
  const primary = store.primary?.trim() || bots[0]?.tenantId || "";
  fs.writeFileSync(
    accountsPath(),
    `${JSON.stringify({ bots, primary }, null, 0)}\n`,
    { mode: 0o600 },
  );
}

/** 按 tenantId 获取微信 Bot 配置 */
export function getWeixinBotByTenantId(tenantId: string): WeixinBoundBot | null {
  const id = normalizeTenantId(tenantId);
  if (!id) return null;
  const store = loadWeixinAccounts();
  return store.bots.find((b) => b.tenantId === id) ?? null;
}

/** 设置主 Bot（primary 指向该 tenantId） */
export function setWeixinPrimary(tenantId: string): boolean {
  const id = normalizeTenantId(tenantId);
  const store = loadWeixinAccounts();
  if (!store.bots.some((b) => b.tenantId === id)) return false;
  store.primary = id;
  saveWeixinAccounts(store);
  return true;
}

/**
 * 插入或更新微信 Bot 配置（Upsert）。
 * 以 tenantId 作为唯一键。
 */
export function upsertWeixinBot(params: {
  tenantId: string;
  token: string;
  baseUrl: string;
  botId: string;
  linkedUserId: string;
}): { ok: true; bot: WeixinBoundBot } | { ok: false; error: string } {
  const tenantId = normalizeTenantId(params.tenantId);
  if (!isValidTenantId(tenantId)) {
    return { ok: false, error: "tenantId 仅允许英文、数字、下划线" };
  }

  const store = loadWeixinAccounts();
  const idx = store.bots.findIndex((b) => b.tenantId === tenantId);
  const existingByBotId = store.bots.find((b) => b.botId === params.botId);

  if (idx < 0 && !existingByBotId && store.bots.length >= MAX_WEIXIN_BOTS) {
    return { ok: false, error: `最多绑定 ${MAX_WEIXIN_BOTS} 个微信 bot` };
  }

  const currentUpdateBuf = idx >= 0 ? store.bots[idx].updateBuf : existingByBotId?.updateBuf ?? "";
  const currentPeerUserId = idx >= 0 ? store.bots[idx].peerUserId : existingByBotId?.peerUserId ?? "";
  const isNewSession = idx < 0 || store.bots[idx].token !== params.token;
  const currentContextToken = isNewSession ? "" : store.bots[idx].contextToken;
  const currentSessionPausedUntil = isNewSession ? 0 : store.bots[idx].sessionPausedUntil;

  const bot: WeixinBoundBot = {
    tenantId,
    token: params.token.trim(),
    baseUrl: params.baseUrl.trim(),
    botId: params.botId.trim(),
    linkedUserId: params.linkedUserId.trim(),
    updateBuf: currentUpdateBuf,
    peerUserId: currentPeerUserId,
    contextToken: currentContextToken,
    sessionPausedUntil: currentSessionPausedUntil,
    updatedAt: new Date().toISOString(),
  };

  if (idx >= 0) {
    store.bots[idx] = bot;
  } else if (existingByBotId) {
    const oldIdx = store.bots.findIndex((b) => b.botId === params.botId);
    if (oldIdx >= 0) store.bots[oldIdx] = bot;
  } else {
    store.bots.push(bot);
  }

  if (!store.primary) store.primary = tenantId;
  saveWeixinAccounts(store);
  return { ok: true, bot };
}

/** 更新指定 Bot 的长轮询缓冲区位置 */
export function updateWeixinBotBuf(tenantId: string, buf: string): void {
  const id = normalizeTenantId(tenantId);
  if (!id) return;
  const store = loadWeixinAccounts();
  const idx = store.bots.findIndex((b) => b.tenantId === id);
  if (idx < 0) return;
  if ((store.bots[idx].updateBuf ?? "") === buf) return;
  store.bots[idx] = { ...store.bots[idx], updateBuf: buf, updatedAt: new Date().toISOString() };
  saveWeixinAccounts(store);
}

/** 更新指定 Bot 的对手方用户 ID（from_user_id，用于主动私聊） */
export function updateWeixinBotPeerUserId(tenantId: string, peerUserId: string): void {
  const id = normalizeTenantId(tenantId);
  if (!id || !peerUserId) return;
  const store = loadWeixinAccounts();
  const idx = store.bots.findIndex((b) => b.tenantId === id);
  if (idx < 0) return;
  if (store.bots[idx].peerUserId === peerUserId) return;
  store.bots[idx] = { ...store.bots[idx], peerUserId, updatedAt: new Date().toISOString() };
  saveWeixinAccounts(store);
}

/** 更新指定 Bot 的会话暂停截止时间（0 表示恢复轮询） */
export function updateWeixinBotSessionPause(tenantId: string, pausedUntil: number): void {
  const id = normalizeTenantId(tenantId);
  if (!id) return;
  const store = loadWeixinAccounts();
  const idx = store.bots.findIndex((b) => b.tenantId === id);
  if (idx < 0) return;
  if (store.bots[idx].sessionPausedUntil === pausedUntil) return;
  store.bots[idx] = { ...store.bots[idx], sessionPausedUntil: pausedUntil, updatedAt: new Date().toISOString() };
  saveWeixinAccounts(store);
}

/** 更新指定 Bot 的 iLink 上下文 context_token */
export function updateWeixinBotContextToken(tenantId: string, contextToken: string): void {
  const id = normalizeTenantId(tenantId);
  if (!id) return;
  const store = loadWeixinAccounts();
  const idx = store.bots.findIndex((b) => b.tenantId === id);
  if (idx < 0) return;
  if (store.bots[idx].contextToken === contextToken) return;
  store.bots[idx] = { ...store.bots[idx], contextToken, updatedAt: new Date().toISOString() };
  saveWeixinAccounts(store);
}

/** 移除指定 tenantId 的微信 Bot */
export function removeWeixinBot(tenantId: string): boolean {
  const id = normalizeTenantId(tenantId);
  const store = loadWeixinAccounts();
  const before = store.bots.length;
  store.bots = store.bots.filter((b) => b.tenantId !== id);
  if (store.bots.length === before) return false;
  if (store.primary === id) store.primary = store.bots[0]?.tenantId ?? "";
  saveWeixinAccounts(store);
  return true;
}

/** 清除所有微信账户配置 */
export function clearWeixinAccounts(): void {
  try { if (fs.existsSync(accountsPath())) fs.unlinkSync(accountsPath()); } catch { /* ignore */ }
}

/** 对用户 ID 进行掩码处理（用于日志输出） */
export function maskUserId(id: string): string {
  if (id.length <= 6) return "****";
  return `${id.slice(0, 3)}…${id.slice(-3)}`;
}
