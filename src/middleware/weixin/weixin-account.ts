/**
 * 微信账号管理模块
 *
 * 该模块负责微信账号信息的持久化存储和加载，包括：
 * - 绑定的微信账号信息（token、baseUrl、botId、linkedUserId）
 * - iLink 消息同步缓冲区
 * - 账号信息的增删查操作
 */
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../utils/app-path.js";

/** 绑定的微信账号信息类型 */
export type WeixinBoundAccount = {
  token: string; // 机器人令牌
  baseUrl: string; // API 基础地址
  botId: string; // 机器人 ID
  linkedUserId: string; // 关联的微信用户 ID
};

/**
 * 获取微信状态目录
 *
 * 确保状态目录存在，权限设置为 0o700（只有当前用户可读写）。
 *
 * @returns 微信状态目录路径
 */
function dir(): string {
  const d = path.join(resolveStateDir(), "weixin");
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

/** 获取账号信息存储路径 */
const accountPath = () => path.join(dir(), "account.json");
/** 获取消息同步缓冲区存储路径 */
const syncPath = () => path.join(dir(), "get_updates.buf");

/**
 * 加载已绑定的微信账号信息
 *
 * @returns 微信账号信息，未绑定则返回 null
 */
export function loadWeixinAccount(): WeixinBoundAccount | null {
  try {
    const p = accountPath();
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, "utf-8")) as WeixinBoundAccount;
    // 验证账号信息完整性
    if (!j.token || !j.baseUrl || !j.botId || !j.linkedUserId) return null;
    return j;
  } catch {
    return null;
  }
}

/**
 * 保存微信账号信息
 *
 * @param a - 要保存的微信账号信息
 */
export function saveWeixinAccount(a: WeixinBoundAccount): void {
  fs.writeFileSync(accountPath(), `${JSON.stringify(a, null, 0)}\n`, {
    mode: 0o600,
  });
}

/**
 * 清除微信账号信息
 *
 * 删除已保存的账号信息和同步缓冲区。
 */
export function clearWeixinAccount(): void {
  try {
    if (fs.existsSync(accountPath())) fs.unlinkSync(accountPath());
  } catch {
    /* 忽略删除错误 */
  }
  try {
    if (fs.existsSync(syncPath())) fs.unlinkSync(syncPath());
  } catch {
    /* 忽略删除错误 */
  }
}

/**
 * 加载消息同步缓冲区
 *
 * @returns 同步缓冲区内容，不存在则返回空字符串
 */
export function loadSyncBuf(): string {
  try {
    if (!fs.existsSync(syncPath())) return "";
    return fs.readFileSync(syncPath(), "utf-8").trim();
  } catch {
    return "";
  }
}

/**
 * 保存消息同步缓冲区
 *
 * @param buf - 要保存的同步缓冲区内容
 */
export function saveSyncBuf(buf: string): void {
  fs.writeFileSync(syncPath(), buf, { mode: 0o600 });
}

/**
 * 脱敏用户 ID（用于显示）
 *
 * 将用户 ID 中间部分替换为省略号，保留前 3 位和后 3 位。
 *
 * @param id - 原始用户 ID
 * @returns 脱敏后的用户 ID
 */
export function maskUserId(id: string): string {
  if (id.length <= 6) return "****";
  return `${id.slice(0, 3)}…${id.slice(-3)}`;
}
