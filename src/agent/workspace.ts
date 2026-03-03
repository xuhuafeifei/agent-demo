import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkspaceDir } from "../utils/app-path.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_DIR = path.join(__dirname, "..", "..", "docs", "reference", "template");
export const SOUL_TEMPLATE_PATH = path.join(TEMPLATE_DIR, "SOUL.md");
export const USER_TEMPLATE_PATH = path.join(TEMPLATE_DIR, "USER.md");

const DEFAULT_SOUL_TEMPLATE = `# SOUL

## Identity
- Agent workspace bootstrap file.

## Purpose
- Describe the long-term behavior and principles of the agent.
`;

const DEFAULT_USER_TEMPLATE = `# USER

## Profile
- Add user preferences and constraints here.

## Working Style
- Add collaboration conventions here.
`;

function readTemplateOrDefault(templatePath: string, fallback: string): string {
  try {
    const content = fs.readFileSync(templatePath, "utf8").trim();
    if (content) return `${content}\n`;
  } catch {
    // Fallback to builtin template when docs template is missing.
  }
  return `${fallback.trim()}\n`;
}

function ensureFileWithContent(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, content, { mode: 0o600 });
}

/**
 * 确保 Agent workspace 可用：
 * 1) 创建 ~/.fgbg/workspace（或环境变量覆盖路径）
 * 2) 初始化 SOUL.md / USER.md（仅首次创建）
 */
export function ensureAgentWorkspace(): string {
  const workspaceDir = resolveWorkspaceDir();
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });
  }

  const soulContent = readTemplateOrDefault(SOUL_TEMPLATE_PATH, DEFAULT_SOUL_TEMPLATE);
  const userContent = readTemplateOrDefault(USER_TEMPLATE_PATH, DEFAULT_USER_TEMPLATE);

  ensureFileWithContent(path.join(workspaceDir, "SOUL.md"), soulContent);
  ensureFileWithContent(path.join(workspaceDir, "USER.md"), userContent);

  return workspaceDir;
}

/**
 * 读取 workspace 下的 SOUL.md。
 * 文件不存在时返回空字符串。
 */
export function readWorkspaceSoul(): string {
  const workspaceDir = ensureAgentWorkspace();
  const soulPath = path.join(workspaceDir, "SOUL.md");
  try {
    return fs.readFileSync(soulPath, "utf8");
  } catch {
    return "";
  }
}

/**
 * 读取 workspace 下的 USER.md。
 * 文件不存在时返回空字符串。
 */
export function readWorkspaceUser(): string {
  const workspaceDir = ensureAgentWorkspace();
  const userPath = path.join(workspaceDir, "USER.md");
  try {
    return fs.readFileSync(userPath, "utf8");
  } catch {
    return "";
  }
}
