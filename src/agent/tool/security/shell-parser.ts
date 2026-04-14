/**
 * Shell 命令解析器（独立工具，不依赖白名单）
 *
 * 基于 shell-quote 解析命令字符串，提取命令名和参数。
 * 与 shellPrecheck 内部的 tokenize 逻辑一致，供外部需要单独解析的场景使用。
 */

import { parse } from "shell-quote";

export interface ParsedCommand {
  /** 命令 basename，如 "git" */
  command: string;
  /** 所有参数（不含命令名） */
  args: string[];
}

/**
 * 解析 Shell 命令
 * @param command 命令字符串
 * @returns 解析结果
 */
export function parseShellCommand(command: string): ParsedCommand {
  const parsed = parse(command);
  const tokens: string[] = [];

  for (const token of parsed) {
    if (typeof token === "string") {
      tokens.push(token);
    } else if (typeof token === "object" && "pattern" in token) {
      tokens.push(token.pattern);
    }
    // 忽略控制操作符和注释
  }

  return {
    command: tokens[0] ?? "",
    args: tokens.slice(1),
  };
}
