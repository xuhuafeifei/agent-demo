/**
 * Shell 命令白名单
 *
 * 每个命令注册时自带 prechecks 校验方法列表，shellPrecheck 依次调用。
 * 校验函数独立定义，自由组合，不堆积。
 */

import path from "node:path";
import { parse } from "shell-quote";
import { SENSITIVE_ENV_PATTERNS } from "./constants.js";
import { checkPathSafety as coreCheckPathSafety } from "./path-checker.js";
import type { ToolSecurityConfig } from "./tool-security.model.js";

/** precheck 方法的入参 */
export interface PrecheckContext {
  /** 原始命令字符串，如 `git diff src/index.ts` */
  command: string;
  /** 命令名（basename），如 `git` */
  basename: string;
  /** 所有参数（不含命令名） */
  args: string[];
  /** 工作区根目录 */
  workspace: string;
  /** 安全配置 */
  config: ToolSecurityConfig;
}

/** 单个校验函数的签名 */
export type PrecheckFn = (ctx: PrecheckContext) => Promise<void> | void;

/**
 * Shell 命令 profile。
 * prechecks 按顺序执行，任一失败则终止。
 */
export interface ShellCommandProfile {
  /** 命令 basename，如 "git" */
  name: string;
  /** 校验方法列表，依次执行 */
  prechecks: PrecheckFn[];
}

// ===== 独立校验函数（可自由组合） =====

/**
 * 从命令字符串中提取所有命令根（basename），逐一校验。
 * 解决 `echo hello && rm -rf /` 只检查 echo 的漏洞。
 */
/**
 * 检查命令链中的所有命令是否都在允许列表中
 *
 * 解决了对串联命令（如 `echo hello && rm -rf /`）只检查第一个命令的安全漏洞。
 * 当命令包含 && 或 || 操作符时，每个命令段都需要单独进行检查。
 *
 * 工作原理：
 * 1. 首先将完整命令字符串按 && 和 || 操作符分割成多个命令段
 * 2. 对每个命令段进行修剪和过滤空字符串
 * 3. 使用 shell-quote 库解析命令段，处理各种 shell 语法（如引号、转义等）
 * 4. 提取每个命令段的命令名（basename）
 * 5. 检查命令名是否在允许列表中
 *
 * 使用场景：
 * 主要用于包含 `&&` 或 `||` 操作符的串联命令，确保每个子命令都是安全的
 *
 * @param ctx 预检查上下文，包含完整的命令字符串
 * @throws Error 如果命令链中的任何命令不在允许列表中
 */
export function checkAllCommandsInChain(ctx: PrecheckContext): void {
  // 按 && 和 || 分割命令链，提取各个命令段
  const segments = ctx.command.split(/\s*&&\s*|\s*\|\|\s*/);

  // 遍历每个命令段进行单独检查
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    // 解析命令段，处理引号、转义等 shell 语法
    const parsed = parse(trimmed);
    const tokens: string[] = [];

    // 遍历解析结果，提取字符串形式的令牌
    for (const token of parsed) {
      if (typeof token === "string") {
        tokens.push(token);
      } else if (typeof token === "object" && "pattern" in token) {
        tokens.push(token.pattern);
      }
    }

    // 提取命令名的 basename（如 `./script.sh` 提取为 `script.sh`）
    const segmentBasename = path.basename(tokens[0]);

    // 检查命令是否在允许列表中
    if (!SHELL_ALLOWLIST.has(segmentBasename)) {
      throw new Error(`串联命令中的 '${segmentBasename}' 不在允许列表中`);
    }
  }
}

/** 2. 危险元字符检查 */
const ALLOWED_COMBINED = ["&&", "||"];
const DANGEROUS_METACHARACTERS = /;|\$\(|`|>|<|&|\|/;

export function checkMetacharacters(ctx: PrecheckContext): void {
  let cleaned = ctx.command;
  for (const op of ALLOWED_COMBINED) {
    cleaned = cleaned.replaceAll(op, "  ");
  }
  if (DANGEROUS_METACHARACTERS.test(cleaned)) {
    if (/;/.test(cleaned)) throw new Error("不允许使用分号串联命令（;）");
    if (/\|/.test(cleaned)) throw new Error("不允许使用管道（|）");
    if (/\$\(/.test(cleaned)) throw new Error("不允许使用命令替换（$()）");
    if (/`/.test(cleaned)) throw new Error("不允许使用反引号命令替换（``）");
    if (/>/.test(cleaned)) throw new Error("不允许使用输出重定向（>）");
    if (/</.test(cleaned)) throw new Error("不允许使用输入重定向（<）");
    if (/&/.test(cleaned)) throw new Error("不允许使用后台执行（&）");
  }
}

/** 3. 敏感环境变量检查
 *
 * 检测命令字符串中是否引用了敏感环境变量，防止泄露机密信息。
 *
 * 工作原理：
 * 1. 使用正则表达式匹配命令中的环境变量引用，支持两种格式：$VAR 和 ${VAR}
 * 2. 将匹配到的变量名转换为大写，确保匹配的一致性
 * 3. 检查变量名是否包含敏感模式（如 API_KEY、PASSWORD 等）
 * 4. 如果发现敏感变量引用，立即抛出错误终止命令执行
 *
 * 敏感模式定义在 constants.ts 文件的 SENSITIVE_ENV_PATTERNS 数组中
 *
 * @param ctx 预检查上下文，包含原始命令字符串
 * @throws Error 如果命令引用了敏感环境变量
 */
export function checkSensitiveEnvRef(ctx: PrecheckContext): void {
  // 匹配环境变量引用的正则表达式：支持 $VAR 和 ${VAR} 两种格式
  const varRefRegex = /\$\{?([a-zA-Z_][a-zA-Z0-9_]*)\}?/g;
  let match;

  // 遍历所有匹配到的环境变量引用
  while ((match = varRefRegex.exec(ctx.command)) !== null) {
    // 提取变量名并转换为大写，确保匹配的一致性
    const varName = match[1].toUpperCase();

    // 检查变量名是否包含任何敏感模式
    if (SENSITIVE_ENV_PATTERNS.some((pattern) => varName.includes(pattern))) {
      throw new Error(`命令引用了敏感环境变量 '${match[1]}'，不允许执行`);
    }
  }
}

/** 4. 路径安全检查 */
/**
 * 判断字符串是否像文件路径
 *
 * 该辅助函数用于识别命令参数中可能是文件路径的字符串，以便进一步进行路径安全检查。
 * 它通过多种模式匹配来区分路径和其他类型的字符串（如 URL、普通文本等）。
 *
 * 设计思路：
 * - 首先排除明显不是路径的字符串（如 HTTP/HTTPS URL）
 * - 然后识别典型的路径模式（如以 . 开头、包含路径分隔符、以 ~ 开头的用户主目录路径）
 * - 最后通过常见文件扩展名来辅助判断可能的文件路径
 *
 * @param token 要检查的字符串令牌
 * @returns true 如果字符串看起来像文件路径，否则返回 false
 */
function isPathLike(token: string): boolean {
  const normalized = token.trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();

  // 排除 URL（以 http:// 或 https:// 开头）
  if (lower.startsWith("http://") || lower.startsWith("https://")) return false;
  // 排除其他协议类型的 URL（如 file://、ftp:// 等）
  if (/^[a-z]:\/\//.test(normalized)) return false;

  // 典型的路径模式判断
  if (normalized.startsWith(".")) return true; // 以 . 开头的路径（如 .gitignore、./src）
  if (normalized.includes("/") || normalized.includes("\\")) return true; // 包含路径分隔符
  if (normalized.startsWith("~")) return true; // 用户主目录路径（如 ~/Documents）
  if (normalized.startsWith("./") || normalized.startsWith("../")) return true; // 相对路径

  // 通过常见文件扩展名辅助判断
  if (normalized.includes(".") && normalized.length > 3) {
    const ext = normalized.split(".").pop() || "";
    const commonExtensions = new Set([
      "txt", "md", "json", "yaml", "yml", "js", "ts", "tsx", "jsx",
      "py", "sh", "bash", "zsh", "html", "css", "scss", "c", "cpp",
      "h", "java", "go", "rs", "rb", "php", "lua", "sql", "vue",
      "svelte", "astro", "log", "xml", "toml", "ini", "cfg", "conf",
    ]);
    if (commonExtensions.has(ext)) return true;
  }

  return false;
}

// 检测shell 指令携带的路径是否合法
export async function checkPaths(ctx: PrecheckContext): Promise<void> {
  const pathCandidates = [...new Set(ctx.args.filter(isPathLike))];
  for (const rawPath of pathCandidates) {
    const result = await coreCheckPathSafety(rawPath, ctx.workspace, ctx.config);
    if (!result.allowed) {
      throw new Error(`路径 '${rawPath}' 不允许访问`);
    }
  }
}

/** 导出给外部单独使用 */
export function containsSensitiveEnvRef(command: string): string | null {
  const varRefRegex = /\$\{?([a-zA-Z_][a-zA-Z0-9_]*)\}?/g;
  let match;
  while ((match = varRefRegex.exec(command)) !== null) {
    const varName = match[1].toUpperCase();
    if (SENSITIVE_ENV_PATTERNS.some((pattern) => varName.includes(pattern))) {
      return `命令引用了敏感环境变量 '${match[1]}'，不允许执行`;
    }
  }
  return null;
}

// ===== 白名单（自由组合校验） =====

export const SHELL_ALLOWLIST: ReadonlyMap<string, ShellCommandProfile> = new Map(
  [
    // 文件与文本 → 元字符 + 路径检查
    ["cat",    { name: "cat",    prechecks: [checkMetacharacters, checkPaths] }],
    ["head",   { name: "head",   prechecks: [checkMetacharacters, checkPaths] }],
    ["tail",   { name: "tail",   prechecks: [checkMetacharacters, checkPaths] }],
    ["wc",     { name: "wc",     prechecks: [checkMetacharacters, checkPaths] }],
    ["sort",   { name: "sort",   prechecks: [checkMetacharacters, checkPaths] }],
    ["uniq",   { name: "uniq",   prechecks: [checkMetacharacters, checkPaths] }],
    ["grep",   { name: "grep",   prechecks: [checkMetacharacters, checkPaths] }],

    // 路径与目录 → 元字符 + 路径检查
    ["pwd",    { name: "pwd",    prechecks: [checkMetacharacters] }],
    ["ls",     { name: "ls",     prechecks: [checkMetacharacters, checkPaths] }],
    ["dirname",{ name: "dirname",prechecks: [checkMetacharacters, checkPaths] }],
    ["basename",{ name: "basename",prechecks:[checkMetacharacters, checkPaths] }],
    ["find",   { name: "find",   prechecks: [checkMetacharacters, checkPaths] }],
    ["tree",   { name: "tree",   prechecks: [checkMetacharacters, checkPaths] }],

    // 运行时与包管理 → 元字符
    ["node",   { name: "node",   prechecks: [checkMetacharacters, checkPaths] }],
    ["npm",    { name: "npm",    prechecks: [checkMetacharacters] }],
    ["npx",    { name: "npx",    prechecks: [checkMetacharacters] }],
    ["corepack",{ name: "corepack",prechecks:[checkMetacharacters] }],
    ["pnpm",   { name: "pnpm",   prechecks: [checkMetacharacters] }],
    ["yarn",   { name: "yarn",   prechecks: [checkMetacharacters] }],

    // 版本控制 → 元字符 + 路径检查
    ["git",    { name: "git",    prechecks: [checkMetacharacters, checkPaths] }],

    // 系统与调试信息 → 元字符
    ["uname",  { name: "uname",  prechecks: [checkMetacharacters] }],
    ["hostname",{ name: "hostname",prechecks:[checkMetacharacters] }],
    ["date",   { name: "date",   prechecks: [checkMetacharacters] }],
    ["whoami", { name: "whoami", prechecks: [checkMetacharacters] }],
    ["which",  { name: "which",  prechecks: [checkMetacharacters] }],
    ["where",  { name: "where",  prechecks: [checkMetacharacters] }],
    ["type",   { name: "type",   prechecks: [checkMetacharacters] }],
    ["command",{ name: "command",prechecks: [checkMetacharacters] }],

    // 输出类 → 元字符 + 敏感环境变量
    ["echo",   { name: "echo",   prechecks: [checkMetacharacters, checkSensitiveEnvRef] }],
    ["printf", { name: "printf", prechecks: [checkMetacharacters, checkSensitiveEnvRef] }],
    ["test",   { name: "test",   prechecks: [checkMetacharacters, checkPaths] }],
    ["[",      { name: "[",      prechecks: [checkMetacharacters, checkPaths] }],
    ["sleep",  { name: "sleep",  prechecks: [checkMetacharacters] }],
    ["true",   { name: "true",   prechecks: [checkMetacharacters] }],
    ["false",  { name: "false",  prechecks: [checkMetacharacters] }],
    ["jq",     { name: "jq",     prechecks: [checkMetacharacters, checkPaths] }],

    // 网络（受限）→ 元字符
    ["curl",   { name: "curl",   prechecks: [checkMetacharacters] }],
    ["wget",   { name: "wget",   prechecks: [checkMetacharacters] }],
  ],
);
