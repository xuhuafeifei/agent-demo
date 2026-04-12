import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveTenantMemoryDir,
  resolveTenantWorkspaceDir,
  resolveSharedEmbeddingDir,
} from "../../utils/app-path.js";

/**
 * 租户 memory 根目录：~/.fgbg/tenants/{tenantId}/memory。
 */
export function resolveMemoryRootDir(tenantId: string): string {
  return resolveTenantMemoryDir(tenantId);
}

/**
 * 租户 SQLite 记忆数据库路径：~/.fgbg/tenants/{tenantId}/memory/memory.db。
 */
export function resolveMemoryDbPath(tenantId: string): string {
  return path.join(resolveMemoryRootDir(tenantId), "memory.db");
}

/**
 * 租户 workspace 下的 MEMORY.md 路径：~/.fgbg/tenants/{tenantId}/workspace/MEMORY.md。
 * 该文件由 agent 手动维护，作为长期记忆摘要。
 */
export function resolveWorkspaceMemoryPath(tenantId: string): string {
  return path.join(resolveTenantWorkspaceDir(tenantId), "MEMORY.md");
}

/**
 * 租户 workspace/memory/ 目录：~/.fgbg/tenants/{tenantId}/workspace/memory。
 * 存放 agent 写入的结构化记忆 *.md 文件，参与 memorySearch 向量索引。
 */
export function resolveWorkspaceMemoryDir(tenantId: string): string {
  return path.join(resolveTenantWorkspaceDir(tenantId), "memory");
}

/**
 * 租户 workspace/userinfo/ 目录：~/.fgbg/tenants/{tenantId}/workspace/userinfo。
 * 存放扁平 *.md 用户信息文件（含 YAML frontmatter），参与 memorySearch 索引。
 */
export function resolveWorkspaceUserinfoDir(tenantId: string): string {
  return path.join(resolveTenantWorkspaceDir(tenantId), "userinfo");
}

/**
 * 租户 workspace/skills/ 目录：~/.fgbg/tenants/{tenantId}/workspace/skills。
 * 存放 agent 自积累的可复用经验（skill），由 agent 写入，通过 loadSkill 工具加载。
 * 区别于 ~/.fgbg/shared/skills（系统预置，只读）。
 */
export function resolveWorkspaceSkillsDir(tenantId: string): string {
  return path.join(resolveTenantWorkspaceDir(tenantId), "skills");
}

/**
 * 共享 embedding 模型目录：~/.fgbg/shared/embedding。
 * 所有租户共用同一份 GGUF 模型文件，此函数无需 tenantId。
 */
export function resolveEmbeddingModelDir(): string {
  return resolveSharedEmbeddingDir();
}

/**
 * 确保目录存在并返回目录路径。仅当前用户可读写（权限 0o700）。
 */
export function ensureDirSync(dir: string): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

/**
 * 确保指定租户的 memory 相关目录存在（memory.db 所在目录 + embedding 模型目录）。
 */
export function ensureMemoryPaths(tenantId: string): void {
  ensureDirSync(resolveMemoryRootDir(tenantId));
  ensureDirSync(resolveEmbeddingModelDir());
}

/**
 * 将 ~/ 开头的路径展开为绝对路径。
 */
export function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
