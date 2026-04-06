/**
 * 路径安全检查模块
 * 功能：
 * 1. 拒绝相对路径（必须为绝对路径或受限的 `~` 路径）
 * 2. 临时目录全局白名单（最高优先级：先于作用域与黑名单，与 constants 中「不受 scope 限制」一致）
 * 3. 作用域检查（workspace / user-home / system）
 * 4. 全局 + 用户黑名单匹配
 * 5. 短原因错误信息（不暴露完整规则）
 */

import os from "node:os";
import path from "node:path";
import type { ToolError } from "../tool-result.js";
import {
  GLOBAL_DENY_PATHS_POSIX,
  GLOBAL_DENY_PATHS_WIN,
  TEMP_PATH_WHITELIST,
} from "./constants.js";
import type { ToolSecurityConfig } from "./tool-security.model.js";

export interface PathCheckResult {
  allowed: boolean;
  realPath: string;
  reason?: string; // 短原因，不含完整黑名单
}

/**
 * 轻量 glob 风格匹配：支持 `**` 通配
 * 简化实现：将 glob 模式转为正则，支持 `**`、`*`、`?`
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // 将 glob 模式转换为正则表达式
  const regexPattern = pattern
    // 转义正则特殊字符（除了 * 和 ?）
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // ** 匹配任意路径段
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    // * 匹配单段内的任意字符
    .replace(/\*/g, "[^/]*")
    // ? 匹配单个字符
    .replace(/\?/g, "[^/]")
    // 恢复 **
    .replace(/__DOUBLE_STAR__/g, ".*");

  try {
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  } catch {
    // 正则构建失败时回退到简单匹配
    return filePath.includes(pattern.replace(/\*/g, ""));
  }
}

/**
 * 检查路径是否匹配黑名单列表
 * 返回匹配的模式，未匹配则返回 null
 */
function matchesAnyPattern(
  normalizedPath: string,
  patterns: string[],
): string | null {
  for (const pattern of patterns) {
    if (matchesPattern(normalizedPath, pattern)) {
      return pattern;
    }
  }
  return null;
}

/**
 * 获取当前平台的全局黑名单
 */
function getGlobalDenyPaths(): string[] {
  if (process.platform === "win32") {
    return GLOBAL_DENY_PATHS_WIN;
  }
  return GLOBAL_DENY_PATHS_POSIX;
}

/**
 * 规范化工作区路径
 */
function normalizeWorkspace(workspace: string): string {
  return path.resolve(workspace);
}

/**
 * 当前用户主目录（绝对路径），与 shell 中 `~`、`cd ~` 所用规则一致（Node.js os.homedir()）。
 */
function resolveUserHomeDir(): string | null {
  try {
    const dir = os.homedir();
    if (!dir?.trim()) return null;
    return path.resolve(dir);
  } catch {
    return null;
  }
}

/**
 * 将 shell 风格的 `~` 展开为绝对路径。
 * - 等价于把前缀 `~/` 或 `~\`（Windows）换成 `os.homedir()` 再 `path.resolve`，**从不**用 workspace。
 * - 仅支持 `~`、`~/`、`~\` 及其后子路径；拒绝 `~其它`（如 `~alice`），与 `~用户名` 语义区分。
 */
function expandTildePath(
  trimmed: string,
): { ok: true; path: string } | { ok: false; reason: string } {
  const homeDir = resolveUserHomeDir();
  if (!homeDir) {
    return { ok: false, reason: "无法解析用户主目录" };
  }
  if (trimmed === "~" || trimmed === "~/" || trimmed === "~\\") {
    return { ok: true, path: homeDir };
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return { ok: true, path: path.resolve(homeDir, trimmed.slice(2)) };
  }
  return {
    ok: false,
    reason:
      "`~` 仅表示系统用户主目录（os.homedir），请使用 `~`、`~/…` 或 `~\\…`；不支持 `~用户名`",
  };
}

/**
 * 检查路径是否在指定作用域内
 * Scope 是递进包含关系：workspace ⊂ user-home ⊂ system
 */
function isPathInScope(
  targetPath: string,
  scope: "workspace" | "user-home" | "system",
  workspace: string,
): boolean {
  const normalizedTarget = path.resolve(targetPath);

  switch (scope) {
    case "system":
      // system 包含所有路径（谨慎使用）
      return true;

    case "user-home": {
      // user-home：用户主目录（~）∪ 当前 FGBG workspace 根
      const normalizedHome = resolveUserHomeDir();
      if (normalizedHome) {
        const relToHome = path.relative(normalizedHome, normalizedTarget);
        const inHome =
          relToHome === "" ||
          (!relToHome.startsWith("..") && !path.isAbsolute(relToHome));
        if (inHome) return true;
      }
      // 回退：检查是否在 workspace 内
      const root = path.resolve(workspace);
      const relToWs = path.relative(root, normalizedTarget);
      return (
        relToWs === "" ||
        (!relToWs.startsWith("..") && !path.isAbsolute(relToWs))
      );
    }

    case "workspace":
    default: {
      // workspace 仅检查工作区
      const root = path.resolve(workspace);
      const rel = path.relative(root, normalizedTarget);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    }
  }
}

/**
 * 获取作用域描述文本
 */
function getScopeDescription(scope: string): string {
  switch (scope) {
    case "system":
      return "系统范围";
    case "user-home":
      return "用户目录";
    case "workspace":
    default:
      return "工作区";
  }
}

/**
 * 核心路径安全检查
 * 只关注路径是否安全、符合配置要求，不关心具体用途（read/write）
 *
 * @param inputPath 用户输入的路径
 * @param workspace 工作区根目录
 * @param config 安全配置
 * @returns 检查结果
 */
export async function checkPathSafety(
  inputPath: string,
  workspace: string,
  config?: ToolSecurityConfig,
): Promise<PathCheckResult> {
  // 1. 基本校验
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return { allowed: false, realPath: "", reason: "路径不能为空" };
  }

  // 2. 根据配置确定作用域范围
  const scope = config?.access?.scope || "workspace";

  // 3. 规范化路径（仅允许绝对路径和 ~ 路径，拒绝相对路径）
  let target: string;

  if (path.isAbsolute(trimmed)) {
    // 绝对路径：直接使用
    target = path.resolve(trimmed);
  } else if (trimmed.startsWith("~")) {
    const expanded = expandTildePath(trimmed);
    if (!expanded.ok) {
      return { allowed: false, realPath: "", reason: expanded.reason };
    }
    target = expanded.path;
  } else {
    // 相对路径：直接拒绝
    return { allowed: false, realPath: "", reason: "请使用绝对路径" };
  }

  // 4. 临时目录白名单（最高优先级：先于作用域与黑名单，不受 scope 限制）
  const matchedTempWhitelist = matchesAnyPattern(target, TEMP_PATH_WHITELIST);
  if (matchedTempWhitelist) {
    return { allowed: true, realPath: target };
  }

  // 5. 检查是否在作用域内
  const inScope = isPathInScope(target, scope, workspace);
  if (!inScope) {
    const scopeDesc = getScopeDescription(scope);
    return {
      allowed: false,
      realPath: target,
      reason: `路径超出允许的${scopeDesc}范围`,
    };
  }

  // 6. 全局黑名单检查
  const globalDenyPaths = getGlobalDenyPaths();
  const matchedGlobal = matchesAnyPattern(target, globalDenyPaths);
  if (matchedGlobal) {
    return { allowed: false, realPath: target, reason: "路径不允许访问" };
  }

  // 7. 用户自定义黑名单检查
  const userDenyPaths = config?.denyPaths || [];
  const matchedUser = matchesAnyPattern(target, userDenyPaths);
  if (matchedUser) {
    return { allowed: false, realPath: target, reason: "路径不允许访问" };
  }

  return { allowed: true, realPath: target };
}

/**
 * 保留旧的 API 以兼容现有代码
 * @deprecated 使用 checkPathSafety 替代
 */
export function resolvePathInWorkspace(
  workspace: string,
  inputPath: string,
): { ok: true; value: string } | { ok: false; error: ToolError } {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "path 不能为空" },
    };
  }

  const root = normalizeWorkspace(workspace);
  const target = path.resolve(root, trimmed);
  const rel = path.relative(root, target);
  const inWorkspace =
    rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));

  if (!inWorkspace) {
    return {
      ok: false,
      error: {
        code: "PATH_OUT_OF_WORKSPACE",
        message: `路径超出工作区: ${inputPath}`,
      },
    };
  }

  return { ok: true, value: target };
}
