import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FgbgUserConfig } from "../types.js";

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
