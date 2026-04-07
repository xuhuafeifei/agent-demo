import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getEventBus, TOPPIC_HEART_BEAT } from "../../event-bus/index.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { resolveWorkspaceDir } from "../../utils/app-path.js";
import { parseFrontmatterMeta } from "../workspace.js";

/**
 * 技能元信息类型
 * @property skillDir - 技能所在的目录名称
 * @property name - 技能名称
 * @property description - 技能描述
 */
export type SkillMetaInfo = {
  skillDir: string;
  name: string;
  description: string;
};

/**
 * 读取技能目录的 SKILL.md 并提取元信息
 * @param skillDirPath - 技能目录路径
 * @returns 元信息对象，如果读取失败则返回 null
 */
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

/**
 * 技能管理器类型
 * @property getMetaInfos - 获取当前加载的技能元信息列表
 * @property loadMetaInfos - 重新加载技能元信息
 * @property getMetaPromptText - 获取技能元信息的提示文本
 */
type SkillManager = {
  getMetaInfos: () => SkillMetaInfo[];
  loadMetaInfos: () => SkillMetaInfo[];
  getMetaPromptText: () => string;
};

// 获取技能管理器专用的日志记录器
const logger = getSubsystemConsoleLogger("skill-manager");
// 获取事件总线实例
const eventBus = getEventBus();

/**
 * 获取技能目录的路径
 * @returns 技能目录的绝对路径
 */
function getSkillsDir(): string {
  return path.join(resolveWorkspaceDir(), "skills");
}

/**
 * 扫描技能目录并获取技能元信息
 * @param skillsDir - 技能目录路径
 * @returns 技能元信息列表
 */
function scanMetaInfos(skillsDir: string): SkillMetaInfo[] {
  if (!fs.existsSync(skillsDir)) return [];
  const result: SkillMetaInfo[] = [];
  // 递归遍历目录，查找包含 SKILL.md 的目录
  const entries = fs.readdirSync(skillsDir, {
    recursive: true,
    withFileTypes: true,
  });

  // 收集所有 SKILL.md 所在的目录
  const skillDirs = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() || entry.name !== "SKILL.md") continue;
    
    const parentPath =
      (entry as fs.Dirent & { parentPath?: string }).parentPath ?? skillsDir;
    skillDirs.add(parentPath);
  }

  // 读取每个目录的元信息
  for (const dirPath of skillDirs) {
    const meta = readSkillMetaFromMarkdown(dirPath);
    if (!meta) continue;

    const relativeDir = path.relative(skillsDir, dirPath).replace(/\\/g, "/");
    meta.skillDir = relativeDir;
    result.push(meta);
  }

  result.sort((a, b) => a.skillDir.localeCompare(b.skillDir));

  return result;
}

/**
 * 计算技能目录的哈希值
 * @param skillsDir - 技能目录路径
 * @returns 技能目录的哈希值
 * @description 用于检测技能目录内容是否发生变化
 */
function computeSkillsHash(skillsDir: string): string {
  if (!fs.existsSync(skillsDir)) return "missing";

  const h = crypto.createHash("sha256");
  const filePaths: string[] = [];
  const entries = fs.readdirSync(skillsDir, {
    recursive: true,
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name !== "SKILL.md") continue;

    const parentPath =
      (entry as fs.Dirent & { parentPath?: string }).parentPath ?? skillsDir;
    filePaths.push(path.join(parentPath, entry.name));
  }

  filePaths.sort();
  for (const filePath of filePaths) {
    h.update(path.relative(skillsDir, filePath));
    h.update(fs.readFileSync(filePath, "utf8"));
  }

  return h.digest("hex");
}

/**
 * 渲染技能元信息的提示文本
 * @param metaInfos - 技能元信息列表
 * @returns 格式化后的提示文本
 */
function renderMetaPrompt(metaInfos: SkillMetaInfo[]): string {
  if (metaInfos.length === 0) return "No skills loaded.";

  return metaInfos
    .map(
      (m) =>
        `- ${m.name}\n  description: ${m.description}\n  loader_input: ${m.skillDir}`,
    )
    .join("\n");
}

/**
 * 创建技能管理器实例
 * @returns 技能管理器对象
 */
function createSkillManager(): SkillManager {
  const skillsDir = getSkillsDir();
  let currentHash = "";
  let currentMetaInfos: SkillMetaInfo[] = [];

  /**
   * 加载技能元信息
   * @returns 技能元信息列表
   */
  const loadMetaInfos = (knownHash?: string): SkillMetaInfo[] => {
    currentMetaInfos = scanMetaInfos(skillsDir);
    currentHash = knownHash ?? computeSkillsHash(skillsDir);
    logger.info(
      "[skills] loaded count=%d hash=%s",
      currentMetaInfos.length,
      currentHash.slice(0, 12),
    );
    return [...currentMetaInfos];
  };

  /**
   * 获取当前加载的技能元信息
   * @returns 技能元信息列表
   */
  const getMetaInfos = (): SkillMetaInfo[] => [...currentMetaInfos];

  /**
   * 获取技能元信息的提示文本
   * @returns 格式化后的提示文本
   */
  const getMetaPromptText = (): string => renderMetaPrompt(currentMetaInfos);

  // 监听心跳事件，定期检查技能目录是否发生变化
  eventBus.on(TOPPIC_HEART_BEAT, () => {
    const nextHash = computeSkillsHash(skillsDir);
    if (nextHash === currentHash) return;
    logger.info("[skills] hash changed, reloading");
    loadMetaInfos(nextHash);
  });

  // 初始化时加载技能元信息
  loadMetaInfos();

  return { getMetaInfos, loadMetaInfos, getMetaPromptText };
}

// 技能管理器单例实例
let managerSingleton: SkillManager | null = null;

/**
 * 获取技能管理器实例（单例模式）
 * @returns 技能管理器对象
 */
export function getSkillManager(): SkillManager {
  if (!managerSingleton) managerSingleton = createSkillManager();
  return managerSingleton;
}
