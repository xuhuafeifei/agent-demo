/**
 * 微信账户管理模块
 *
 * 该模块负责微信 Bot 配置的持久化和管理，提供了完整的 CRUD 操作接口。
 * 主要功能包括：
 * - Bot 配置的读取与保存
 * - 主 Bot 管理
 * - Bot 状态维护（contextToken、updateBuf 等）
 * - 会话暂停管理
 * - 遗留配置文件迁移
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../utils/app-path.js";

// 最大允许绑定的微信 Bot 数量
export const MAX_WEIXIN_BOTS = 3;
// 标识符验证正则表达式（仅允许英文、数字、下划线）
export const IDENTIFY_RE = /^[A-Za-z0-9_]+$/;
// 默认 Bot 标识符
export const WX_DEFAULT_IDENTIFY = "default" as const;

/**
 * 微信绑定 Bot 的完整配置类型
 */
export type WeixinBoundBot = {
  identify: string;                      // Bot 唯一标识符
  token: string;                         // 微信接口调用令牌
  baseUrl: string;                       // 微信接口基础 URL
  botId: string;                        // 微信 Bot 系统内部 ID
  linkedUserId: string;                 // 绑定的微信用户 ID
  updateBuf: string;                    // 长轮询更新缓冲区（用于增量获取消息）
  peerUserId: string;                   // 对手方用户 ID（用于主动发送消息）
  contextToken: string;                 // iLink 上下文令牌（用于维持会话连续性）
  sessionPausedUntil: number;           // 会话暂停截止时间戳（0 表示未暂停）
  updatedAt: string;                    // 最后更新时间
};

/**
 * 微信账户存储结构
 */
export type WeixinAccountsStore = {
  bots: WeixinBoundBot[];               // Bot 配置列表
  primary: string;                      // 主 Bot 的标识符
};

// 默认存储结构
const DEFAULT_STORE: WeixinAccountsStore = { bots: [], primary: "" };

/**
 * 获取微信 Bot 配置存储目录
 *
 * 确保目录存在（不存在则创建），并设置适当的权限（只读）
 * @returns 配置存储目录路径
 */
function dir(): string {
  const d = path.join(resolveStateDir(), "weixin");
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

// 配置文件路径
const accountsPath = () => path.join(dir(), "accounts.json");
const legacyAccountPath = () => path.join(dir(), "account.json"); // 旧版本配置文件
const legacySyncPath = () => path.join(dir(), "get_updates.buf"); // 旧版本同步状态文件

/**
 * 规范化 Bot 标识符
 * @param identify 原始标识符
 * @returns 规范化后的标识符
 */
function normalizeIdentify(identify: string): string {
  return identify.trim();
}

/**
 * 验证标识符格式的有效性
 * @param identify 要验证的标识符
 * @returns 格式有效返回 true，否则返回 false
 */
export function isValidIdentify(identify: string): boolean {
  return IDENTIFY_RE.test(normalizeIdentify(identify));
}

/**
 * 验证 Bot 配置对象的形状是否符合要求
 * @param x 要验证的对象
 * @returns 对象形状符合要求返回 true，否则返回 false
 */
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

/**
 * 读取旧版本的单个 Bot 配置（用于迁移）
 *
 * 处理从早期版本的配置格式（单个 Bot）到新版本（多个 Bot）的迁移
 * @returns 旧版本配置的存储结构（或默认结构）
 */
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
    const identify = WX_DEFAULT_IDENTIFY;
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
          peerUserId: "",
          contextToken: "",
          sessionPausedUntil: 0,
          updatedAt: new Date().toISOString(),
        },
      ],
    };
  } catch {
    return DEFAULT_STORE;
  }
}

/**
 * 加载微信账户配置
 *
 * 负责读取微信 Bot 配置，处理：
 * - 配置文件的存在性检查
 * - 旧版本配置的迁移
 * - 配置的规范化和验证
 * - 主 Bot 配置的一致性检查
 *
 * @returns 微信账户存储结构
 */
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
        peerUserId: ((b as Record<string, unknown>).peerUserId as string ?? "").trim(),
        contextToken: ((b as Record<string, unknown>).contextToken as string ?? "").trim(),
        sessionPausedUntil: Number((b as Record<string, unknown>).sessionPausedUntil ?? 0) || 0,
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

/**
 * 保存微信账户配置
 *
 * 负责将配置写入文件，处理：
 * - 配置的规范化
 * - Bot 数量限制
 * - 主 Bot 的有效性检查
 * - 文件权限设置
 *
 * @param store 要保存的微信账户存储结构
 */
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

/**
 * 根据标识符获取微信 Bot 配置
 *
 * @param identify Bot 标识符
 * @returns 找到的 Bot 配置（或 null）
 */
export function getWeixinBotByIdentify(identify: string): WeixinBoundBot | null {
  const id = normalizeIdentify(identify);
  if (!id) return null;
  const store = loadWeixinAccounts();
  return store.bots.find((b) => b.identify === id) ?? null;
}

/**
 * 设置主 Bot
 *
 * 主 Bot 是默认的消息发送者，也是会话状态共享的 Bot
 *
 * @param identify 要设置为主 Bot 的标识符
 * @returns 设置成功返回 true，失败返回 false
 */
export function setWeixinPrimary(identify: string): boolean {
  const id = normalizeIdentify(identify);
  const store = loadWeixinAccounts();
  if (!store.bots.some((b) => b.identify === id)) return false;
  store.primary = id;
  saveWeixinAccounts(store);
  return true;
}

/**
 * 插入或更新微信 Bot 配置（Upsert 操作）
 *
 * 该函数负责管理微信 Bot 的注册、更新和维护，确保 Bot 配置的一致性和有效性。
 * 支持新增 Bot、更新现有 Bot 信息，以及处理 Bot 重新绑定等场景。
 *
 * @param params Bot 配置参数
 * @returns 操作结果，包含成功/失败信息和 Bot 对象
 */
export function upsertWeixinBot(params: {
  identify: string;        // Bot 唯一标识符（用于区分不同 Bot）
  token: string;          // 微信接口调用令牌
  baseUrl: string;        // 微信接口基础 URL
  botId: string;          // 微信 Bot 系统内部 ID
  linkedUserId: string;   // 绑定的微信用户 ID
}): { ok: true; bot: WeixinBoundBot } | { ok: false; error: string } {
  // 规范化标识符格式
  const identify = normalizeIdentify(params.identify);

  // 验证标识符格式的有效性
  if (!isValidIdentify(identify)) {
    return { ok: false, error: "identify 仅允许英文、数字、下划线" };
  }

  // 加载已存储的微信 Bot 配置
  const store = loadWeixinAccounts();

  // 查找是否已存在相同标识符的 Bot
  const idx = store.bots.findIndex((b) => b.identify === identify);

  // 查找是否已存在相同 botId 的 Bot（同一 Bot 可能被不同标识符绑定）
  const existingByBotId = store.bots.find((b) => b.botId === params.botId);

  // 检查 Bot 数量限制
  if (idx < 0 && !existingByBotId && store.bots.length >= MAX_WEIXIN_BOTS) {
    return { ok: false, error: `最多绑定 ${MAX_WEIXIN_BOTS} 个微信 bot` };
  }

  // 保留已有的更新缓冲区和对手方用户 ID（确保消息接收的连续性）
  const currentUpdateBuf =
    idx >= 0 ? store.bots[idx].updateBuf : existingByBotId?.updateBuf ?? "";
  const currentPeerUserId =
    idx >= 0 ? store.bots[idx].peerUserId : existingByBotId?.peerUserId ?? "";

  // 判断是否为新会话（Bot 第一次绑定或 token 已变更）
  // 重新绑定时需要重置会话相关状态
  const isNewSession = idx < 0 || store.bots[idx].token !== params.token;
  const currentContextToken = isNewSession
    ? ""  // 新会话重置上下文令牌
    : store.bots[idx].contextToken;  // 旧会话保留上下文令牌
  const currentSessionPausedUntil = isNewSession
    ? 0  // 新会话重置暂停时间
    : store.bots[idx].sessionPausedUntil;  // 旧会话保留暂停时间

  // 构建 Bot 配置对象
  const bot: WeixinBoundBot = {
    identify,
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

  // 执行插入或更新操作
  if (idx >= 0) {
    // 更新现有 Bot 配置
    store.bots[idx] = bot;
  } else if (existingByBotId) {
    // 存在相同 botId 的 Bot，替换旧配置
    const oldIdx = store.bots.findIndex((b) => b.botId === params.botId);
    if (oldIdx >= 0) store.bots[oldIdx] = bot;
  } else {
    // 新增 Bot 配置
    store.bots.push(bot);
  }

  // 如果是第一个 Bot，自动设置为主 Bot
  if (!store.primary) store.primary = identify;

  // 保存更新后的配置到文件
  saveWeixinAccounts(store);

  return { ok: true, bot };
}

/**
 * 更新微信 Bot 的长轮询缓冲区位置
 *
 * 长轮询缓冲区用于增量获取消息，确保消息不会重复或遗漏
 *
 * @param identify Bot 标识符
 * @param buf 新的缓冲区位置
 */
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

/**
 * 更新指定 Bot 的对手方用户 ID（from_user_id）
 *
 * 用于入站消息记录，以便后续主动私聊
 *
 * @param identify Bot 标识符
 * @param peerUserId 对手方用户 ID
 */
export function updateWeixinBotPeerUserId(identify: string, peerUserId: string): void {
  const id = normalizeIdentify(identify);
  if (!id || !peerUserId) return;
  const store = loadWeixinAccounts();
  const idx = store.bots.findIndex((b) => b.identify === id);
  if (idx < 0) return;
  if (store.bots[idx].peerUserId === peerUserId) return;
  store.bots[idx] = {
    ...store.bots[idx],
    peerUserId,
    updatedAt: new Date().toISOString(),
  };
  saveWeixinAccounts(store);
}

/**
 * 更新指定 Bot 的会话暂停截止时间（用于会话过期后暂停轮询）
 *
 * 设为 0 表示恢复轮询
 *
 * @param identify Bot 标识符
 * @param pausedUntil 暂停截止时间戳
 */
export function updateWeixinBotSessionPause(identify: string, pausedUntil: number): void {
  const id = normalizeIdentify(identify);
  if (!id) return;
  const store = loadWeixinAccounts();
  const idx = store.bots.findIndex((b) => b.identify === id);
  if (idx < 0) return;
  if (store.bots[idx].sessionPausedUntil === pausedUntil) return;
  store.bots[idx] = {
    ...store.bots[idx],
    sessionPausedUntil: pausedUntil,
    updatedAt: new Date().toISOString(),
  };
  saveWeixinAccounts(store);
}

/**
 * 更新指定 Bot 的上下文 context_token
 *
 * 用于维持微信会话的连续性
 *
 * @param identify Bot 标识符
 * @param contextToken 新的上下文令牌
 */
export function updateWeixinBotContextToken(identify: string, contextToken: string): void {
  const id = normalizeIdentify(identify);
  if (!id) return;
  const store = loadWeixinAccounts();
  const idx = store.bots.findIndex((b) => b.identify === id);
  if (idx < 0) return;
  if (store.bots[idx].contextToken === contextToken) return;
  store.bots[idx] = {
    ...store.bots[idx],
    contextToken,
    updatedAt: new Date().toISOString(),
  };
  saveWeixinAccounts(store);
}

/**
 * 移除指定标识符的微信 Bot
 *
 * @param identify Bot 标识符
 * @returns 移除成功返回 true，失败返回 false
 */
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

/**
 * 清除所有微信账户配置
 *
 * 用于重置配置，支持重新绑定 Bot
 */
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

/**
 * 对用户 ID 进行掩码处理（用于日志输出）
 *
 * 用于保护用户隐私，只显示用户 ID 的前 3 位和后 3 位
 *
 * @param id 原始用户 ID
 * @returns 掩码后的用户 ID
 */
export function maskUserId(id: string): string {
  if (id.length <= 6) return "****";
  return `${id.slice(0, 3)}…${id.slice(-3)}`;
}
