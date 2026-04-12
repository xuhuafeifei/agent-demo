import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getEventBus, TOPPIC_HEART_BEAT } from "../../event-bus/index.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { resolveTenantWorkspaceDir, resolveSharedSkillsDir } from "../../utils/app-path.js";
import { parseFrontmatterMeta } from "../workspace.js";

/**
 * 技能元信息类型
 */
export type SkillMetaInfo = {
  skillDir: string;     // 相对于所在 skills 目录的路径（如 "task-scheduler"）
  name: string;         // YAML frontmatter 中的 name 字段
  description: string;  // YAML frontmatter 中的 description 字段
};

/** 读取指定目录下的 SKILL.md 并提取元信息 */
function readSkillMetaFromMarkdown(skillDirPath: string): SkillMetaInfo | null {
  const skillPath = path.join(skillDirPath, "SKILL.md");
  try {
    const content = fs.readFileSync(skillPath, "utf8");
    const frontmatter = parseFrontmatterMeta(content);
    if (!frontmatter) return null;
    return { name: frontmatter.name, description: frontmatter.description, skillDir: "" };
  } catch {
    return null;
  }
}

/** 技能管理器接口 */
type SkillManager = {
  getMetaInfos: () => SkillMetaInfo[];
  loadMetaInfos: () => SkillMetaInfo[];
  getMetaPromptText: () => string;
};

const logger = getSubsystemConsoleLogger("skill-manager");
const eventBus = getEventBus();

/**
 * 扫描指定 skills 目录，收集所有子目录下的 SKILL.md 元信息。
 * @param skillsDir 要扫描的 skills 根目录
 * @param prefix 结果中 skillDir 字段的前缀（用于区分 shared/ 和 tenant/）
 */
function scanMetaInfos(skillsDir: string, prefix = ""): SkillMetaInfo[] {
  if (!fs.existsSync(skillsDir)) return [];
  const result: SkillMetaInfo[] = [];
  const entries = fs.readdirSync(skillsDir, { recursive: true, withFileTypes: true });

  const skillDirs = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() || entry.name !== "SKILL.md") continue;
    const parentPath = (entry as fs.Dirent & { parentPath?: string }).parentPath ?? skillsDir;
    skillDirs.add(parentPath);
  }

  for (const dirPath of skillDirs) {
    const meta = readSkillMetaFromMarkdown(dirPath);
    if (!meta) continue;
    const relativeDir = path.relative(skillsDir, dirPath).replace(/\\/g, "/");
    // 带前缀区分来源（如 "shared:task-scheduler" vs 直接 "my-workflow"）
    meta.skillDir = prefix ? `${prefix}:${relativeDir}` : relativeDir;
    result.push(meta);
  }

  result.sort((a, b) => a.skillDir.localeCompare(b.skillDir));
  return result;
}

/** 计算目录内所有 SKILL.md 的内容哈希，用于检测变更 */
function computeSkillsHash(skillsDir: string): string {
  if (!fs.existsSync(skillsDir)) return "missing";
  const h = crypto.createHash("sha256");
  const filePaths: string[] = [];
  const entries = fs.readdirSync(skillsDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name !== "SKILL.md") continue;
    const parentPath = (entry as fs.Dirent & { parentPath?: string }).parentPath ?? skillsDir;
    filePaths.push(path.join(parentPath, entry.name));
  }
  filePaths.sort();
  for (const filePath of filePaths) {
    h.update(path.relative(skillsDir, filePath));
    h.update(fs.readFileSync(filePath, "utf8"));
  }
  return h.digest("hex");
}

/** 渲染 skills 元信息为提示文本，供 system prompt 使用 */
function renderMetaPrompt(metaInfos: SkillMetaInfo[]): string {
  if (metaInfos.length === 0) return "No skills loaded.";
  return metaInfos
    .map(
      (m) => `- ${m.name}\n  description: ${m.description}\n  loader_input: ${m.skillDir}`,
    )
    .join("\n");
}

/**
 * 创建租户技能管理器实例。
 * 同时扫描两个目录：
 *   1. 租户私有 workspace/skills/（agent 自积累的可复用经验）
 *   2. 全局共享 shared/skills/（系统预置，所有租户共用）
 *
 * @param tenantId 租户 ID
 */
function createSkillManager(tenantId: string): SkillManager {
  const tenantSkillsDir = path.join(resolveTenantWorkspaceDir(tenantId), "skills");
  const sharedSkillsDir = resolveSharedSkillsDir();

  let currentTenantHash = "";
  let currentSharedHash = "";
  let currentMetaInfos: SkillMetaInfo[] = [];

  const loadMetaInfos = (): SkillMetaInfo[] => {
    // 分别扫描两个目录，合并结果（租户私有优先展示）
    const tenantMetas = scanMetaInfos(tenantSkillsDir);
    const sharedMetas = scanMetaInfos(sharedSkillsDir);
    currentMetaInfos = [...tenantMetas, ...sharedMetas];
    currentTenantHash = computeSkillsHash(tenantSkillsDir);
    currentSharedHash = computeSkillsHash(sharedSkillsDir);
    logger.info(
      "[skills] tenant=%s loaded count=%d",
      tenantId,
      currentMetaInfos.length,
    );
    return [...currentMetaInfos];
  };

  const getMetaInfos = (): SkillMetaInfo[] => [...currentMetaInfos];
  const getMetaPromptText = (): string => renderMetaPrompt(currentMetaInfos);

  // 监听心跳，检测 skills 目录变更后自动刷新
  eventBus.on(TOPPIC_HEART_BEAT, () => {
    const nextTenantHash = computeSkillsHash(tenantSkillsDir);
    const nextSharedHash = computeSkillsHash(sharedSkillsDir);
    if (nextTenantHash === currentTenantHash && nextSharedHash === currentSharedHash) return;
    logger.info("[skills] tenant=%s hash changed, reloading", tenantId);
    loadMetaInfos();
  });

  // 初始化时立即加载
  loadMetaInfos();

  return { getMetaInfos, loadMetaInfos, getMetaPromptText };
}

/**
 * 全局 skill manager 缓存，按 tenantId 隔离。
 * 每个租户首次调用时创建实例，后续复用。
 */
const managerMap = new Map<string, SkillManager>();

/**
 * 获取指定租户的技能管理器（按需创建，单例复用）。
 *
 * @param tenantId 租户 ID
 */
export function getSkillManager(tenantId: string): SkillManager {
  let manager = managerMap.get(tenantId);
  if (!manager) {
    manager = createSkillManager(tenantId);
    managerMap.set(tenantId, manager);
  }
  return manager;
}
