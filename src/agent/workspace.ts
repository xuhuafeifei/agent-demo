import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveTenantWorkspaceDir, resolveSharedDir } from "../utils/app-path.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_DIR = path.join(__dirname, "..", "..", "docs", "reference", "template");
const SKILLS_TEMPLATE_DIR = path.join(__dirname, "..", "..", "docs", "reference", "skills");
export const SOUL_TEMPLATE_PATH = path.join(TEMPLATE_DIR, "SOUL.md");

const DEFAULT_SOUL_TEMPLATE = `# SOUL

## Identity
- Agent workspace bootstrap file.

## Purpose
- Describe the long-term behavior and principles of the agent.
`;

function readTemplateOrDefault(templatePath: string, fallback: string): string {
  try {
    const content = fs.readFileSync(templatePath, "utf8").trim();
    if (content) return `${content}\n`;
  } catch {
    // 模板文件不存在时使用内置默认值
  }
  return `${fallback.trim()}\n`;
}

function ensureFileWithContent(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, content, { mode: 0o600 });
}

/**
 * 将内置 skill 模板复制到 shared/skills/ 目录。
 * 只在文件不存在时复制，避免覆盖已有内容。
 */
function ensureSharedSkill(sharedSkillsDir: string, skillDirName: string): void {
  const srcDir = path.join(SKILLS_TEMPLATE_DIR, skillDirName);
  if (!fs.existsSync(srcDir)) return;

  const dstDir = path.join(sharedSkillsDir, skillDirName);
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true, mode: 0o700 });
  }

  const srcSkillPath = path.join(srcDir, "SKILL.md");
  const dstSkillPath = path.join(dstDir, "SKILL.md");
  if (fs.existsSync(srcSkillPath) && !fs.existsSync(dstSkillPath)) {
    fs.copyFileSync(srcSkillPath, dstSkillPath);
    fs.chmodSync(dstSkillPath, 0o600);
  }
}

/**
 * 确保共享资源目录（~/.fgbg/shared）已初始化：
 * - shared/embedding/（embedding 模型目录，空目录占位）
 * - shared/skills/（系统预置 skill，首次初始化时从模板复制）
 */
export function ensureSharedResources(): void {
  const sharedDir = resolveSharedDir();
  const embeddingDir = path.join(sharedDir, "embedding");
  const skillsDir = path.join(sharedDir, "skills");

  for (const d of [sharedDir, embeddingDir, skillsDir]) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    }
  }

  // 将内置 skill 模板复制到 shared/skills/
  ensureSharedSkill(skillsDir, "task-scheduler");
}

/**
 * 确保指定租户的 workspace 目录可用：
 * - 创建 ~/.fgbg/tenants/{tenantId}/workspace
 * - 初始化 SOUL.md、MEMORY.md（仅首次）
 * - 确保 userinfo/ 和 skills/ 子目录存在
 *
 * 注意：不再创建 SKILL.md（旧设计废弃），agent 自积累的 skill 在 workspace/skills/ 下。
 *
 * @param tenantId 租户 ID
 * @returns 租户 workspace 绝对路径
 */
export function ensureAgentWorkspace(tenantId: string): string {
  const workspaceDir = resolveTenantWorkspaceDir(tenantId);
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });
  }

  const soulContent = readTemplateOrDefault(SOUL_TEMPLATE_PATH, DEFAULT_SOUL_TEMPLATE);
  ensureFileWithContent(path.join(workspaceDir, "SOUL.md"), soulContent);
  // MEMORY.md 初始为空文件，agent 运行过程中自行维护
  ensureFileWithContent(path.join(workspaceDir, "MEMORY.md"), "");

  for (const sub of ["skills", "userinfo"]) {
    const subDir = path.join(workspaceDir, sub);
    if (!fs.existsSync(subDir)) {
      fs.mkdirSync(subDir, { recursive: true, mode: 0o700 });
    }
  }

  return workspaceDir;
}

/**
 * 读取租户 workspace 下的 SOUL.md。
 * 文件不存在时返回空字符串。
 */
export function readWorkspaceSoul(tenantId: string): string {
  const workspaceDir = ensureAgentWorkspace(tenantId);
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
 * 从 Markdown 正文解析 YAML frontmatter 中的 name / description。
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
 * 扫描租户 workspace/userinfo 下顶层 *.md，汇总 frontmatter 供 system prompt 使用。
 */
export function readWorkspaceUserinfoSummary(tenantId: string): string {
  const workspaceDir = ensureAgentWorkspace(tenantId);
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
