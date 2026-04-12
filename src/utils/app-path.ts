import os from "node:os";
import path from "node:path";

/**
 * 应用状态根目录，固定为 ~/.fgbg。
 * 所有租户数据、共享资源、系统配置均在此目录下，不支持环境变量覆盖。
 */
export function resolveStateDir(): string {
  return path.join(os.homedir(), ".fgbg");
}

/**
 * 全局用户配置文件路径：~/.fgbg/fgbg.json。
 */
export function resolveGlobalConfigPath(): string {
  return path.join(resolveStateDir(), "fgbg.json");
}

/**
 * 共享资源根目录：~/.fgbg/shared。
 * 存放跨租户共用的只读资源（embedding 模型、系统预置 skill）。
 */
export function resolveSharedDir(): string {
  return path.join(resolveStateDir(), "shared");
}

/**
 * 共享 embedding 模型目录：~/.fgbg/shared/embedding。
 * 所有租户共用同一份 GGUF 模型文件，不复制到租户目录。
 */
export function resolveSharedEmbeddingDir(): string {
  return path.join(resolveSharedDir(), "embedding");
}

/**
 * 共享 skills 目录：~/.fgbg/shared/skills。
 * 存放系统预置的 skill 定义，所有租户只读引用。
 * 区别于租户 workspace/skills（agent 自积累的可复用经验）。
 */
export function resolveSharedSkillsDir(): string {
  return path.join(resolveSharedDir(), "skills");
}

/**
 * 租户根目录：~/.fgbg/tenants/{tenantId}。
 * tenantId 格式约定：字母、数字、下划线，例如 "default"、"userA"。
 */
export function resolveTenantDir(tenantId: string): string {
  return path.join(resolveStateDir(), "tenants", tenantId);
}

/**
 * 租户 workspace 目录：~/.fgbg/tenants/{tenantId}/workspace。
 * 存放 SOUL.md、MEMORY.md、userinfo/、skills/ 等租户私有内容。
 */
export function resolveTenantWorkspaceDir(tenantId: string): string {
  return path.join(resolveTenantDir(tenantId), "workspace");
}

/**
 * 租户 session 目录：~/.fgbg/tenants/{tenantId}/session。
 * 存放 session.json 索引和 *.jsonl 对话文件。
 */
export function resolveTenantSessionDir(tenantId: string): string {
  return path.join(resolveTenantDir(tenantId), "session");
}

/**
 * 租户 memory 目录：~/.fgbg/tenants/{tenantId}/memory。
 * 存放 memory.db（SQLite 向量索引）。
 */
export function resolveTenantMemoryDir(tenantId: string): string {
  return path.join(resolveTenantDir(tenantId), "memory");
}

/**
 * 共享 embedding 缓存数据库路径：~/.fgbg/shared/embedding-cache.db。
 * embedding 向量是纯文本内容的函数，与租户无关，全局共用一份缓存以提升命中率。
 */
export function resolveSharedEmbeddingCacheDbPath(): string {
  return path.join(resolveSharedDir(), "embedding-cache.db");
}
