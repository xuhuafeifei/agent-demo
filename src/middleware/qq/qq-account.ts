import fs from "node:fs";
import path from "node:path";
import type { QqbotChannelConfigView } from "../../types.js";
import { resolveStateDir } from "../../utils/app-path.js";

/** 默认 QQ 机器人标识，当前仅使用 `default`，预留多 bot 支持 */
export const QQ_DEFAULT_IDENTIFY = "default" as const;

/** QQ 机器人账号最大数量限制 */
export const MAX_QQ_BOTS = 1;

/**
 * 单条 QQ 机器人账号信息类型
 *
 * 持久化存储于 ~/.fgbg/qq/accounts.json 文件中
 */
export type QQAccount = {
  identify: string; // 机器人标识，用于区分不同的机器人账号
  appId: string; // 腾讯云应用 ID
  clientSecret: string; // 腾讯云应用密钥
  targetOpenId: string; // 目标用户的 OpenID（用于私聊）
};

/**
 * QQ 机器人账号存储结构类型
 *
 * 包含所有机器人账号和主用机器人的标识
 */
export type QQAccountsStore = {
  bots: QQAccount[]; // 所有已配置的 QQ 机器人账号列表
  primary: string; // 当前主用机器人的 identify
};

/**
 * 创建空的 QQ 机器人账号对象
 *
 * 用于初始化和默认值设置
 */
const EMPTY_ACCOUNT = (): QQAccount => ({
  identify: QQ_DEFAULT_IDENTIFY,
  appId: "",
  clientSecret: "",
  targetOpenId: "",
});

/**
 * 默认的账号存储结构
 *
 * 用于初始化空的存储
 */
const DEFAULT_STORE: QQAccountsStore = {
  bots: [],
  primary: QQ_DEFAULT_IDENTIFY,
};

/**
 * 获取 QQ 账号存储目录
 *
 * 确保目录存在并设置适当的权限
 */
function dir(): string {
  const d = path.join(resolveStateDir(), "qq");
  fs.mkdirSync(d, { recursive: true, mode: 0o700 }); // 创建目录，权限为 700（仅当前用户可访问）
  return d;
}

/**
 * 获取 QQ 账号存储文件路径
 */
export function qqAccountsPath(): string {
  return path.join(dir(), "accounts.json");
}

/**
 * 规范化机器人标识
 *
 * 如果标识为空，则返回默认标识
 */
function normalizeIdentify(s: string): string {
  return s.trim() || QQ_DEFAULT_IDENTIFY;
}

/**
 * 验证 QQAccount 类型的形状是否有效
 *
 * 用于确保读取到的数据符合预期的类型结构
 */
function validBotShape(x: unknown): x is QQAccount {
  if (!x || typeof x !== "object") return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.identify === "string" &&
    typeof v.appId === "string" &&
    typeof v.clientSecret === "string" &&
    (typeof v.targetOpenId === "string" || v.targetOpenId === undefined)
  );
}

/**
 * 加载 QQ 机器人账号存储
 *
 * 从文件中读取账号信息，处理异常情况并提供默认值
 */
export function loadQQAccounts(): QQAccountsStore {
  try {
    const p = qqAccountsPath();
    if (!fs.existsSync(p)) {
      return { ...DEFAULT_STORE }; // 文件不存在时返回默认存储
    }

    // 读取并解析存储文件
    const j = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<QQAccountsStore>;

    // 过滤和修剪机器人账号数据
    const bots = Array.isArray(j.bots)
      ? j.bots.filter(validBotShape).slice(0, MAX_QQ_BOTS) // 只保留有效的机器人账号，限制数量
      : [];

    // 规范化主用机器人标识
    const primary =
      typeof j.primary === "string" && j.primary.trim()
        ? j.primary.trim()
        : QQ_DEFAULT_IDENTIFY;

    // 规范化所有账号数据
    const normalized: QQAccountsStore = {
      bots: bots.map((b) => ({
        identify: normalizeIdentify(b.identify),
        appId: b.appId.trim(),
        clientSecret: b.clientSecret.trim(),
        targetOpenId: typeof b.targetOpenId === "string" ? b.targetOpenId.trim() : "",
      })),
      primary,
    };

    // 确保主用机器人标识是有效的
    if (
      normalized.primary &&
      !normalized.bots.some((b) => b.identify === normalized.primary)
    ) {
      normalized.primary = normalized.bots[0]?.identify ?? QQ_DEFAULT_IDENTIFY;
    }

    return normalized;
  } catch {
    return { ...DEFAULT_STORE }; // 发生任何错误时返回默认空存储
  }
}

/**
 * 保存 QQ 机器人账号存储
 *
 * 将账号信息写入文件，确保数据规范化和权限设置
 */
export function saveQQAccounts(store: QQAccountsStore): void {
  // 修剪机器人账号列表，确保数据规范化
  const bots = store.bots.slice(0, MAX_QQ_BOTS).map((b) => ({
    identify: normalizeIdentify(b.identify),
    appId: b.appId.trim(),
    clientSecret: b.clientSecret.trim(),
    targetOpenId: (b.targetOpenId ?? "").trim(),
  }));

  // 确定主用机器人标识
  const primary =
    store.primary?.trim() || bots[0]?.identify || QQ_DEFAULT_IDENTIFY;

  // 写入文件，使用 JSON 格式化输出
  fs.writeFileSync(
    qqAccountsPath(),
    `${JSON.stringify({ bots, primary }, null, 2)}\n`,
    { mode: 0o600 }, // 文件权限为 600（仅当前用户可读写）
  );
}

/**
 * 获取主用 QQ 机器人账号
 *
 * 优先使用 primary 指定的机器人，其次使用 identify=default 的机器人，最后使用第一个机器人
 */
export function getPrimaryQQBot(): QQAccount | null {
  const s = loadQQAccounts();
  if (s.bots.length === 0) return null; // 没有配置任何机器人时返回 null

  const want = s.primary?.trim() || QQ_DEFAULT_IDENTIFY;

  // 查找主用机器人
  return (
    s.bots.find((b) => b.identify === want) ?? // 优先查找 primary 指定的机器人
    s.bots.find((b) => b.identify === QQ_DEFAULT_IDENTIFY) ?? // 其次查找 identify=default 的机器人
    s.bots[0] ?? // 最后使用第一个机器人
    null
  );
}

/** 按 identify 取 bot（与 `accounts.json` 中条目一一对应） */
export function getQQBotByIdentify(identify: string): QQAccount | null {
  const id = normalizeIdentify(identify);
  const s = loadQQAccounts();
  return s.bots.find((b) => b.identify === id) ?? null;
}

/**
 * 确保默认机器人账号存在于存储中
 *
 * 如果没有默认机器人，则创建一个空的默认机器人账号
 */
function ensureDefaultBot(store: QQAccountsStore): QQAccount {
  // 查找默认机器人账号
  let b = store.bots.find((x) => x.identify === QQ_DEFAULT_IDENTIFY);

  // 如果不存在，则创建一个空的默认机器人账号
  if (!b) {
    b = EMPTY_ACCOUNT();
    store.bots = [...store.bots, b];
  }

  // 确保 primary 字段不为空
  if (!store.primary?.trim()) {
    store.primary = QQ_DEFAULT_IDENTIFY;
  }

  return b;
}

/**
 * 更新主用 QQ 机器人的应用凭证
 *
 * 合并写入主 bot（identify=default）的 appId / clientSecret
 */
export function mergePrimaryQQBotCredentials(params: {
  appId?: string;
  clientSecret?: string;
}): void {
  const store = loadQQAccounts(); // 加载当前账号存储
  const bot = ensureDefaultBot(store); // 确保默认机器人账号存在

  // 更新应用凭证
  if (params.appId !== undefined) bot.appId = params.appId.trim();
  if (params.clientSecret !== undefined) bot.clientSecret = params.clientSecret.trim();

  saveQQAccounts(store); // 保存更新后的账号信息
}

/**
 * 按 appId 更新对应机器人的私聊目标 OpenID
 *
 * 在收到私聊消息时调用，用于跟踪和更新目标用户的 OpenID
 */
export function setQQBotTargetOpenIdByAppId(
  appId: string,
  targetOpenId: string,
): void {
  const aid = appId.trim();
  const tid = targetOpenId.trim();
  if (!aid || !tid) return;

  const store = loadQQAccounts();
  const hit = store.bots.find((b) => b.appId === aid);

  if (hit) {
    // 如果找到对应的机器人，更新其目标 OpenID
    hit.targetOpenId = tid;
    saveQQAccounts(store);
    return;
  }

  // 如果未找到对应的机器人，创建或更新默认机器人
  const bot = ensureDefaultBot(store);
  bot.appId = aid;
  bot.targetOpenId = tid;
  saveQQAccounts(store);
}

/**
 * 按 appId 查询目标用户的 OpenID
 *
 * 用于根据应用 ID 获取对应的私聊目标 OpenID
 */
export function getQQTargetOpenIdForAppId(appId: string): string {
  const id = appId.trim();
  if (!id) return "";

  const b = loadQQAccounts().bots.find((x) => x.appId === id);
  return b?.targetOpenId?.trim() ?? "";
}

/**
 * 清除 QQ 机器人账号信息
 *
 * 删除存储文件，重置为初始状态
 */
export function clearQQAccounts(): void {
  try {
    const p = qqAccountsPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* 忽略删除文件时的错误 */
  }
}

/**
 * 检查是否已配置 QQ 机器人账号凭证
 *
 * 用于判断磁盘上是否已有主机器人的 appId 或密钥
 */
export function hasQQAccountCredentials(): boolean {
  const b = getPrimaryQQBot();
  return Boolean(b && (b.appId.length > 0 || b.clientSecret.length > 0));
}

/** GET /config/fgbg：把 accounts 中的字段拼成与旧前端一致的 qqbot 对象（不落 fgbg） */
export function getQqbotChannelForApi(enabled: boolean): QqbotChannelConfigView {
  const bot = getPrimaryQQBot();
  return {
    enabled,
    appId: bot?.appId ?? "",
    clientSecret: "",
    hasCredentials: hasQQAccountCredentials(),
    targetOpenid: bot?.targetOpenId ?? "",
  };
}
