import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkspaceDir } from "../utils/app-path.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_DIR = path.join(__dirname, "..", "..", "docs", "reference", "template");
const SKILLS_TEMPLATE_DIR = path.join(__dirname, "..", "..", "docs", "reference", "skills");
export const SOUL_TEMPLATE_PATH = path.join(TEMPLATE_DIR, "SOUL.md");
export const USER_TEMPLATE_PATH = path.join(TEMPLATE_DIR, "USER.md");

const DEFAULT_SOUL_TEMPLATE = `# SOUL

## Identity
- Agent workspace bootstrap file.

## Purpose
- Describe the long-term behavior and principles of the agent.
`;

const DEFAULT_SKILL_TEMPLATE = `# SKILL

> Global skill guidance file. Keep it concise.
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
 * 写入内置的 skill
 */
function ensureBuiltinSkill(
  workspaceDir: string,
  skillDirName: string,
): void {
  const srcSkillDir = path.join(SKILLS_TEMPLATE_DIR, skillDirName);
  if (!fs.existsSync(srcSkillDir)) return;

  const dstSkillDir = path.join(workspaceDir, "skills", skillDirName);
  if (!fs.existsSync(dstSkillDir)) {
    fs.mkdirSync(dstSkillDir, { recursive: true, mode: 0o700 });
  }

  const srcSkillPath = path.join(srcSkillDir, "SKILL.md");
  const dstSkillPath = path.join(dstSkillDir, "SKILL.md");

  if (fs.existsSync(srcSkillPath) && !fs.existsSync(dstSkillPath)) {
    fs.copyFileSync(srcSkillPath, dstSkillPath);
    fs.chmodSync(dstSkillPath, 0o600);
  }
}

/**
 * 确保 Agent workspace 可用：
 * 1) 创建 ~/.fgbg/workspace（或环境变量覆盖路径）
 * 2) 初始化 SOUL.md / SKILL.md（仅首次创建）、userinfo/ 与 skills/
 */
export function ensureAgentWorkspace(): string {
  const workspaceDir = resolveWorkspaceDir();
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });
  }

  const soulContent = readTemplateOrDefault(SOUL_TEMPLATE_PATH, DEFAULT_SOUL_TEMPLATE);

  ensureFileWithContent(path.join(workspaceDir, "SOUL.md"), soulContent);
  ensureFileWithContent(path.join(workspaceDir, "SKILL.md"), DEFAULT_SKILL_TEMPLATE);

  const skillsDir = path.join(workspaceDir, "skills");
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true, mode: 0o700 });
  }

  const userinfoDir = path.join(workspaceDir, "userinfo");
  if (!fs.existsSync(userinfoDir)) {
    fs.mkdirSync(userinfoDir, { recursive: true, mode: 0o700 });
  }

  ensureBuiltinSkill(workspaceDir, "task-scheduler");

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

/** 从 Markdown 文件中提取 YAML frontmatter 的 name/description */
export type FrontmatterMeta = {
  name: string;
  description: string;
};

function yamlDoubleQuotedScalar(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

export function buildMarkdownWithFrontmatter(params: {
  name: string;
  description: string;
  body: string;
}): string {
  const header = [
    "---",
    `name: ${yamlDoubleQuotedScalar(params.name)}`,
    `description: ${yamlDoubleQuotedScalar(params.description)}`,
    "---",
    "",
  ].join("\n");
  const body = params.body.trimEnd();
  return body ? `${header}${body}\n` : `${header}\n`;
}

/**
 * 从 Markdown 正文解析 `---` ... `---` YAML frontmatter 中的 name / description。
 * 支持两种格式：
 * - 无引号：`name: Some Name`
 * - 双引号：`name: "Some Name"`
 */
export function parseFrontmatterMeta(content: string): FrontmatterMeta | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const frontmatterText = match[1];
  
  // 支持无引号或双引号格式
  const nameMatch = frontmatterText.match(/^name:\s*"(.+?)"\s*$/m) ?? frontmatterText.match(/^name:\s*(.+?)\s*$/m);
  const descMatch = frontmatterText.match(/^description:\s*"(.+?)"\s*$/m) ?? frontmatterText.match(/^description:\s*(.+?)\s*$/m);

  if (!nameMatch || !descMatch) return null;

  const name = nameMatch[1].trim();
  const description = descMatch[1].trim();

  if (!name || !description) return null;

  return { name, description };
}

/** @deprecated 使用 parseFrontmatterMeta 替代 */
export type UserinfoFrontmatter = FrontmatterMeta;

/** @deprecated 使用 parseFrontmatterMeta 替代 */
export function parseUserinfoFrontmatter(content: string): UserinfoFrontmatter | null {
  return parseFrontmatterMeta(content);
}

/**
 * 扫描 workspace/userinfo 下顶层 *.md，汇总 frontmatter 中的 name/description 供 system prompt ## User 使用。
 */
export function readWorkspaceUserinfoSummary(): string {
  const workspaceDir = ensureAgentWorkspace();
  const userinfoDir = path.join(workspaceDir, "userinfo");
  if (!fs.existsSync(userinfoDir)) return "";

  const names = fs
    .readdirSync(userinfoDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => e.name)
    .sort();

  const blocks: string[] = [];
  for (const fileName of names) {
    const filePath = path.join(userinfoDir, fileName);
    let raw = "";
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseUserinfoFrontmatter(raw);
    if (parsed) {
      blocks.push(
        `- **${parsed.name}**\n  description: ${parsed.description}\n  file: userinfo/${fileName}`,
      );
    } else {
      blocks.push(
        `- **${path.basename(fileName, ".md")}** (add YAML frontmatter with name/description)\n  file: userinfo/${fileName}`,
      );
    }
  }

  return blocks.join("\n");
}
