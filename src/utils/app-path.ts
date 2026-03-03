import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FgbgUserConfig } from "../agent/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * 应用状态根目录（~/.fgbg 或 FGBG_STATE_DIR）。
 * 全局配置、agent 数据、会话等均在此目录下。
 */
export function resolveStateDir(): string {
  const override = process.env.FGBG_STATE_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), ".fgbg");
}

/**
 * 全局用户配置文件路径（默认 ~/.fgbg/fgbg.json）。
 * 可通过环境变量 FGBG_CONFIG_PATH 覆盖。
 */
export function resolveGlobalConfigPath(): string {
  const override = process.env.FGBG_CONFIG_PATH?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(resolveStateDir(), "fgbg.json");
}

/**
 * Workspace 目录（默认 ~/.fgbg/workspace）。
 * 可通过环境变量 FGBG_WORKSPACE_DIR 覆盖。
 */
export function resolveWorkspaceDir(): string {
  const override = process.env.FGBG_WORKSPACE_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(resolveStateDir(), "workspace");
}

/**
 * 读取用户级 fgbg.json，返回原始配置对象（不解读字段含义）。
 * 文件不存在或解析失败时返回空对象。
 */
export function getUserFgbgConfig(): FgbgUserConfig {
  const filePath = resolveGlobalConfigPath();
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    return isRecord(raw) ? (raw as FgbgUserConfig) : {};
  } catch {
    return {};
  }
}

/**
 * 将配置写回 fgbg.json（不解读字段含义）。
 * 若目录不存在会先创建（权限 0o700），文件权限 0o600。
 */
export function writeFgbgUserConfig(cfg: FgbgUserConfig): void {
  const cfgPath = resolveGlobalConfigPath();
  const cfgDir = path.dirname(cfgPath);
  if (!fs.existsSync(cfgDir)) {
    fs.mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, {
    mode: 0o600,
  });
}
