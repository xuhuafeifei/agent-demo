import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../utils/app-path.js";

export const MAX_WEIXIN_BOTS = 3;
export const IDENTIFY_RE = /^[A-Za-z0-9_]+$/;

export type WeixinBoundBot = {
  identify: string;
  token: string;
  baseUrl: string;
  botId: string;
  linkedUserId: string;
  updateBuf: string;
  updatedAt: string;
};

export type WeixinAccountsStore = {
  bots: WeixinBoundBot[];
  primary: string;
};

const DEFAULT_STORE: WeixinAccountsStore = { bots: [], primary: "" };

function dir(): string {
  const d = path.join(resolveStateDir(), "weixin");
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

const accountsPath = () => path.join(dir(), "accounts.json");
const legacyAccountPath = () => path.join(dir(), "account.json");
const legacySyncPath = () => path.join(dir(), "get_updates.buf");

function normalizeIdentify(identify: string): string {
  return identify.trim();
}

export function isValidIdentify(identify: string): boolean {
  return IDENTIFY_RE.test(normalizeIdentify(identify));
}

function validBotShape(x: unknown): x is WeixinBoundBot {
  if (!x || typeof x !== "object") return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.identify === "string" &&
    isValidIdentify(v.identify) &&
    typeof v.token === "string" &&
    typeof v.baseUrl === "string" &&
    typeof v.botId === "string" &&
    typeof v.linkedUserId === "string"
  );
}

function readLegacySingle(): WeixinAccountsStore {
  try {
    const p = legacyAccountPath();
    if (!fs.existsSync(p)) return DEFAULT_STORE;
    const j = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    const token = String(j.token ?? "").trim();
    const baseUrl = String(j.baseUrl ?? "").trim();
    const botId = String(j.botId ?? "").trim();
    const linkedUserId = String(j.linkedUserId ?? "").trim();
    if (!token || !baseUrl || !botId || !linkedUserId) return DEFAULT_STORE;
    let updateBuf = "";
    const sp = legacySyncPath();
    if (fs.existsSync(sp)) {
      updateBuf = fs.readFileSync(sp, "utf-8").trim();
    }
    const identify = "default";
    return {
      primary: identify,
      bots: [
        {
          identify,
          token,
          baseUrl,
          botId,
          linkedUserId,
          updateBuf,
          updatedAt: new Date().toISOString(),
        },
      ],
    };
  } catch {
    return DEFAULT_STORE;
  }
}

export function loadWeixinAccounts(): WeixinAccountsStore {
  try {
    const p = accountsPath();
    if (!fs.existsSync(p)) {
      return readLegacySingle() ?? DEFAULT_STORE;
    }
    const j = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<WeixinAccountsStore>;
    const bots = Array.isArray(j.bots) ? j.bots.filter(validBotShape).slice(0, MAX_WEIXIN_BOTS) : [];
    const primary = typeof j.primary === "string" ? j.primary.trim() : "";
    const normalized = {
      bots: bots.map((b) => ({
        identify: normalizeIdentify(b.identify),
        token: b.token.trim(),
        baseUrl: b.baseUrl.trim(),
        botId: b.botId.trim(),
        linkedUserId: b.linkedUserId.trim(),
        updateBuf: (b.updateBuf ?? "").trim(),
        updatedAt: b.updatedAt || new Date().toISOString(),
      })),
      primary,
    };
    if (
      normalized.primary &&
      !normalized.bots.some((b) => b.identify === normalized.primary)
    ) {
      normalized.primary = normalized.bots[0]?.identify ?? "";
    }
    return normalized;
  } catch {
    return DEFAULT_STORE;
  }
}

export function saveWeixinAccounts(store: WeixinAccountsStore): void {
  const bots = store.bots.slice(0, MAX_WEIXIN_BOTS).map((b) => ({
    ...b,
    identify: normalizeIdentify(b.identify),
    updateBuf: (b.updateBuf ?? "").trim(),
    updatedAt: b.updatedAt || new Date().toISOString(),
  }));
  const primary = store.primary?.trim() || bots[0]?.identify || "";
  fs.writeFileSync(
    accountsPath(),
    `${JSON.stringify({ bots, primary }, null, 0)}\n`,
    { mode: 0o600 },
  );
}

export function getWeixinBotByIdentify(identify: string): WeixinBoundBot | null {
  const id = normalizeIdentify(identify);
  if (!id) return null;
  const store = loadWeixinAccounts();
  return store.bots.find((b) => b.identify === id) ?? null;
}

export function setWeixinPrimary(identify: string): boolean {
  const id = normalizeIdentify(identify);
  const store = loadWeixinAccounts();
  if (!store.bots.some((b) => b.identify === id)) return false;
  store.primary = id;
  saveWeixinAccounts(store);
  return true;
}

export function upsertWeixinBot(params: {
  identify: string;
  token: string;
  baseUrl: string;
  botId: string;
  linkedUserId: string;
}): { ok: true; bot: WeixinBoundBot } | { ok: false; error: string } {
  const identify = normalizeIdentify(params.identify);
  if (!isValidIdentify(identify)) {
    return { ok: false, error: "identify 仅允许英文、数字、下划线" };
  }
  const store = loadWeixinAccounts();
  const idx = store.bots.findIndex((b) => b.identify === identify);
  const existingByBotId = store.bots.find((b) => b.botId === params.botId);
  if (idx < 0 && !existingByBotId && store.bots.length >= MAX_WEIXIN_BOTS) {
    return { ok: false, error: `最多绑定 ${MAX_WEIXIN_BOTS} 个微信 bot` };
  }
  const currentUpdateBuf =
    idx >= 0 ? store.bots[idx].updateBuf : existingByBotId?.updateBuf ?? "";
  const bot: WeixinBoundBot = {
    identify,
    token: params.token.trim(),
    baseUrl: params.baseUrl.trim(),
    botId: params.botId.trim(),
    linkedUserId: params.linkedUserId.trim(),
    updateBuf: currentUpdateBuf,
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
  if (!store.primary) store.primary = identify;
  saveWeixinAccounts(store);
  return { ok: true, bot };
}

export function updateWeixinBotBuf(identify: string, buf: string): void {
  const id = normalizeIdentify(identify);
  if (!id) return;
  const store = loadWeixinAccounts();
  const idx = store.bots.findIndex((b) => b.identify === id);
  if (idx < 0) return;
  if ((store.bots[idx].updateBuf ?? "") === buf) return;
  store.bots[idx] = {
    ...store.bots[idx],
    updateBuf: buf,
    updatedAt: new Date().toISOString(),
  };
  saveWeixinAccounts(store);
}

export function removeWeixinBot(identify: string): boolean {
  const id = normalizeIdentify(identify);
  const store = loadWeixinAccounts();
  const before = store.bots.length;
  store.bots = store.bots.filter((b) => b.identify !== id);
  if (store.bots.length === before) return false;
  if (store.primary === id) store.primary = store.bots[0]?.identify ?? "";
  saveWeixinAccounts(store);
  return true;
}

export function clearWeixinAccounts(): void {
  try {
    if (fs.existsSync(accountsPath())) fs.unlinkSync(accountsPath());
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(legacyAccountPath())) fs.unlinkSync(legacyAccountPath());
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(legacySyncPath())) fs.unlinkSync(legacySyncPath());
  } catch {
    /* ignore */
  }
}

export function maskUserId(id: string): string {
  if (id.length <= 6) return "****";
  return `${id.slice(0, 3)}…${id.slice(-3)}`;
}
