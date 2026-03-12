import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../utils/app-path.js";

const WATCH_DOG_DIR = "watch-dog";
const TASK_DB_FILE = "task-schedule.db";

/**
 * 解析 watch-dog 目录的完整路径
 * @returns watch-dog 目录的绝对路径
 */
export function resolveWatchDogDir(): string {
  return path.join(resolveStateDir(), WATCH_DOG_DIR);
}

/**
 * 确保 watch-dog 目录存在，如果不存在则创建
 * 目录权限设置为 0o700（仅所有者可读写执行）
 * @returns watch-dog 目录的绝对路径
 */
export function ensureWatchDogDir(): string {
  const dir = resolveWatchDogDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

/**
 * 解析任务调度数据库文件的完整路径
 * 会自动确保 watch-dog 目录存在
 * @returns 任务数据库文件的绝对路径
 */
export function resolveTaskDbPath(): string {
  return path.join(ensureWatchDogDir(), TASK_DB_FILE);
}
