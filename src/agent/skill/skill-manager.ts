import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getEventBus, TOPPIC_HEART_BEAT } from "../../event-bus/index.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { resolveTenantWorkspaceDir, resolveSharedSkillsDir } from "../../utils/app-path.js";
import { parseFrontmatterMeta } from "../workspace.js";

/**
 * 技能元信息类型
 *
 * 每个 skill 对应一个子目录，目录内需包含 SKILL.md 文件。
 * SKILL.md 的 YAML frontmatter 中定义 name 和 description。
 * skillDir 标识该技能的来源路径，带前缀区分 shared/tenant（见 scanMetaInfos）。
 */
export type SkillMetaInfo = {
  skillDir: string;     // 相对于所在 skills 目录的路径（如 "task-scheduler"），带来源前缀
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
 *
 * 技能加载管线的核心步骤：
 * 1. 递归遍历 skillsDir，找出所有包含 SKILL.md 的子目录
 * 2. 读取每个 SKILL.md 的 frontmatter，提取 name 和 description
 * 3. 为每个技能的 skillDir 加上 prefix 前缀，标记来源（如 "shared:task-scheduler"）
 * 4. 按 skillDir 字典序排序后返回
 *
 * @param skillsDir 要扫描的 skills 根目录
 * @param prefix 结果中 skillDir 字段的前缀（用于区分 shared/ 和 tenant/）
 *              注意：当前调用方未传 prefix，所以 tenant 技能无前缀，shared 技能也无前缀
 */
function scanMetaInfos(skillsDir: string, prefix = ""): SkillMetaInfo[] {
  if (!fs.existsSync(skillsDir)) return [];
  const result: SkillMetaInfo[] = [];

  // 递归读取所有条目，用 Set 去重：同一目录可能出现多个文件，只保留 SKILL.md 所在目录
  const entries = fs.readdirSync(skillsDir, { recursive: true, withFileTypes: true });

  const skillDirs = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() || entry.name !== "SKILL.md") continue;
    // parentPath 是 Node.js 20+ 的 Dirent 属性，回退到 skillsDir 保证兼容
    const parentPath = (entry as fs.Dirent & { parentPath?: string }).parentPath ?? skillsDir;
    skillDirs.add(parentPath);
  }

  // 对每个找到的 SKILL.md 目录，解析 frontmatter 元信息
  for (const dirPath of skillDirs) {
    const meta = readSkillMetaFromMarkdown(dirPath);
    if (!meta) continue;
    // 计算相对于 skills 根目录的路径，统一用正斜杠（兼容 Windows）
    const relativeDir = path.relative(skillsDir, dirPath).replace(/\\/g, "/");
    // 带前缀区分来源（如 "shared:task-scheduler" vs 直接 "my-workflow"）
    meta.skillDir = prefix ? `${prefix}:${relativeDir}` : relativeDir;
    result.push(meta);
  }

  // 按 skillDir 排序，确保每次扫描结果顺序一致
  result.sort((a, b) => a.skillDir.localeCompare(b.skillDir));
  return result;
}

/**
 * 计算目录内所有 SKILL.md 的内容哈希，用于检测 skills 是否发生变更。
 *
 * 变更检测机制：
 * - 收集所有 SKILL.md 的相对路径 + 文件内容，统一计算 SHA-256
 * - 文件路径排序后逐个追加到 hash 输入，确保相同内容产生相同哈希
 * - 目录不存在时返回 "missing"，避免误触发重载
 *
 * 此哈希在心跳监听中使用，任一 skill 文件增删改都会导致哈希变化，从而触发 loadMetaInfos()。
 */
function computeSkillsHash(skillsDir: string): string {
  if (!fs.existsSync(skillsDir)) return "missing";
  const h = crypto.createHash("sha256");
  const filePaths: string[] = [];

  // 收集所有 SKILL.md 的绝对路径
  const entries = fs.readdirSync(skillsDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name !== "SKILL.md") continue;
    const parentPath = (entry as fs.Dirent & { parentPath?: string }).parentPath ?? skillsDir;
    filePaths.push(path.join(parentPath, entry.name));
  }

  // 路径排序保证哈希输入顺序确定性
  filePaths.sort();
  for (const filePath of filePaths) {
    h.update(path.relative(skillsDir, filePath));  // 相对路径作为标识
    h.update(fs.readFileSync(filePath, "utf8"));    // 文件内容
  }
  return h.digest("hex");
}

/**
 * 渲染 skills 元信息为提示文本，供 system prompt 使用。
 *
 * getMetaPromptText 的最终输出格式示例：
 * ```
 * - task-scheduler
 *   description: Schedule and manage recurring tasks
 *   loader_input: task-scheduler
 * - report-generator
 *   description: Generate analytics reports
 *   loader_input: shared:report-generator
 * ```
 *
 * LLM 通过这段文本了解当前可用的 skills 列表，每行包含：
 * - name: 技能名称，供 LLM 识别和引用
 * - description: 技能描述，帮助 LLM 判断何时调用
 * - loader_input: 技能目录路径（带来源前缀），告知 LLM 从何处加载完整指令
 */
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
 *
 * tenantId 隔离机制：
 * - 每个租户拥有独立的 skills 目录：workspace/<tenantId>/skills/
 * - 所有租户共享同一全局 skills 目录：shared/skills/
 * - 两者合并后形成该租户的完整技能集，tenant 私有技能排前面（优先展示）
 *
 * 技能加载管线：
 *   1. 扫描 tenantSkillsDir → 获取租户私有 skills
 *   2. 扫描 sharedSkillsDir  → 获取全局共享 skills
 *   3. 合并 [...tenantMetas, ...sharedMetas] → tenant 优先
 *   4. 计算两个目录的内容哈希，用于后续变更检测
 *
 * 合并与去重策略：
 * - 当前实现采用简单拼接（concat），不做 name 级别的去重
 * - 如果 tenant 和 shared 有同名 skill，两者都会出现在列表中
 * - skillDir 前缀机制可区分来源（但当前调用 scanMetaInfos 时未传 prefix，故无效果）
 * - 如需去重，需在上层或 scanMetaInfos 中按 name 做 dedup
 *
 * 热重载机制：
 * - 通过心跳事件（TOPPIC_HEART_BEAT）周期性检测
 * - 分别计算 tenant 和 shared 目录的哈希，任一变化即触发全量重载
 * - 避免频繁无效重载：只有哈希真正变化时才执行 loadMetaInfos
 *
 * @param tenantId 租户 ID
 */
function createSkillManager(tenantId: string): SkillManager {
  // 解析租户私有 skills 目录和全局共享 skills 目录
  const tenantSkillsDir = path.join(resolveTenantWorkspaceDir(tenantId), "skills");
  const sharedSkillsDir = resolveSharedSkillsDir();

  // 当前快照：两个目录的内容哈希 + 合并后的元信息列表
  let currentTenantHash = "";
  let currentSharedHash = "";
  let currentMetaInfos: SkillMetaInfo[] = [];

  const loadMetaInfos = (): SkillMetaInfo[] => {
    // 分别扫描两个目录，合并结果（租户私有优先展示）
    // tenantMetas 在前，sharedMetas 在后 → system prompt 中租户私有 skill 先出现
    const tenantMetas = scanMetaInfos(tenantSkillsDir);
    const sharedMetas = scanMetaInfos(sharedSkillsDir);
    currentMetaInfos = [...tenantMetas, ...sharedMetas];

    // 更新快照哈希，用于下次心跳时对比
    currentTenantHash = computeSkillsHash(tenantSkillsDir);
    currentSharedHash = computeSkillsHash(sharedSkillsDir);
    logger.info(
      "[skills] tenant=%s loaded count=%d",
      tenantId,
      currentMetaInfos.length,
    );
    return [...currentMetaInfos];
  };

  // 返回当前缓存的元信息副本（防止外部修改内部状态）
  const getMetaInfos = (): SkillMetaInfo[] => [...currentMetaInfos];
  // 将元信息渲染为 LLM 可读的文本格式
  const getMetaPromptText = (): string => renderMetaPrompt(currentMetaInfos);

  // 监听心跳事件，检测 skills 目录文件变更后自动刷新
  // 这是热重载的核心：无需重启，skills 文件修改后下一次心跳即生效
  eventBus.on(TOPPIC_HEART_BEAT, () => {
    const nextTenantHash = computeSkillsHash(tenantSkillsDir);
    const nextSharedHash = computeSkillsHash(sharedSkillsDir);
    // 两个目录都没变化 → 跳过，避免无谓的磁盘读取
    if (nextTenantHash === currentTenantHash && nextSharedHash === currentSharedHash) return;
    logger.info("[skills] tenant=%s hash changed, reloading", tenantId);
    loadMetaInfos();
  });

  // 初始化时立即加载一次，确保管理器创建后就有完整的 skills 列表
  loadMetaInfos();

  return { getMetaInfos, loadMetaInfos, getMetaPromptText };
}

/**
 * 全局 skill manager 缓存，按 tenantId 隔离。
 *
 * 租户隔离的关键设计：
 * - Map<tenantId, SkillManager> 确保每个租户有独立的实例
 * - 不同租户的 skills 互不干扰：各自扫描各自的 workspace/skills/ 目录
 * - 共享 skills 目录对所有租户相同，但每个租户的合并结果独立缓存
 * - 实例创建后永久缓存（无淘汰机制），适合租户数可控的场景
 */
const managerMap = new Map<string, SkillManager>();

/**
 * 获取指定租户的技能管理器（按需创建，单例复用）。
 *
 * 首次调用：创建 SkillManager → 扫描两个目录 → 注册心跳监听 → 缓存到 managerMap
 * 后续调用：直接从 managerMap 返回，无重复扫描开销
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
