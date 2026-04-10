import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
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

export function buildMarkdownWithFrontmatter(params: {
  name: string;
  description: string;
  body: string;
}): string {
  // `yaml`（YAML 1.2）与 Java 侧 SnakeYAML 类似：多行会用 `|`/`>` 等块标量，特殊字符会自动加引号。
  const yamlBlock = stringifyYaml(
    { name: params.name, description: params.description },
    { lineWidth: 0 },
  ).trimEnd();
  const header = `---\n${yamlBlock}\n---\n\n`;
  const body = params.body.trimEnd();
  return body ? `${header}${body}\n` : `${header}\n`;
}

function frontmatterScalarToTrimmedString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s.length ? s : null;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/**
 * 从 Markdown 正文解析 `---` ... `---` YAML frontmatter 中的 name / description。
 * 使用 YAML 1.2 解析（多行块标量、引号转义等均按规范处理）。
 */
export function parseFrontmatterMeta(content: string): FrontmatterMeta | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  let data: unknown;
  try {
    data = parseYaml(match[1]);
  } catch {
    return null;
  }
  if (data == null || typeof data !== "object" || Array.isArray(data)) return null;

  const rec = data as Record<string, unknown>;
  const name = frontmatterScalarToTrimmedString(rec.name);
  const description = frontmatterScalarToTrimmedString(rec.description);
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
