/**
 * Shell 命令预检编排器
 *
 * 不做任何具体校验，只负责：
 * 1. parse 命令 → 提取 tokens
 * 2. 在白名单中找到对应 profile
 * 3. 依次调用 profile.prechecks 中的校验方法
 * 4. 返回解析结果供执行器使用
 */

import path from "node:path";
import { parse } from "shell-quote";
import { SHELL_ALLOWLIST } from "./shell-allowlist.js";
import type { ToolSecurityConfig } from "./tool-security.model.js";

export interface ShellPrecheckResult {
  /** 命令 basename，可直接用于 execFile 的第一个参数 */
  command: string;
  /** 所有参数（不含命令名），可直接用于 execFile 的第二个参数 */
  args: string[];
}

/**
 * Shell 命令预检编排
 *
 * @param command   命令字符串，如 `git diff src/index.ts`
 * @param workspace 工作区根目录
 * @param config    安全配置（传给 precheck 方法使用）
 * @returns         解析后的命令名和参数数组，可用于 execFile 执行
 * @throws          任一 precheck 方法抛出 Error
 */
export async function shellPrecheck(
  command: string,
  workspace: string,
  config: ToolSecurityConfig,
): Promise<ShellPrecheckResult> {
  // ===== 一次 parse，提取全部 tokens =====
  const tokens = tokenize(command);
  if (tokens.length === 0 || !tokens[0]) {
    throw new Error("命令不能为空");
  }

  const basename = path.basename(tokens[0]);
  const args = tokens.slice(1);

  // ===== 找到白名单 profile，依次调用 prechecks =====
  const profile = SHELL_ALLOWLIST.get(basename);
  if (!profile) {
    throw new Error(`命令 '${basename}' 不在允许列表中`);
  }

  const ctx = { command, basename, args, workspace, config };
  for (const fn of profile.prechecks) {
    await fn(ctx);
  }

  return { command: basename, args };
}

/**
 * 将命令字符串解析为 tokens 数组。
 * 基于 shell-quote，正确处理引号、转义和 glob 模式。
 */
function tokenize(command: string): string[] {
  const parsed = parse(command);
  const tokens: string[] = [];
  for (const token of parsed) {
    if (typeof token === "string") {
      tokens.push(token);
    } else if (typeof token === "object" && "pattern" in token) {
      tokens.push(token.pattern);
    }
  }
  return tokens;
}
