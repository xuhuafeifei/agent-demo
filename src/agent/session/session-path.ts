import path from "node:path";
import { resolveTenantSessionDir } from "../../utils/app-path.js";

/**
 * 租户的 session 目录：~/.fgbg/tenants/{tenantId}/session。
 */
export function resolveSessionDir(tenantId: string): string {
  return resolveTenantSessionDir(tenantId);
}

/**
 * 租户 session 索引文件：~/.fgbg/tenants/{tenantId}/session/session.json。
 * 文件内以 sessionKey（如 "session:main:{tenantId}"）为键，记录每个会话的 jsonl 文件路径。
 */
export function resolveSessionIndexPath(tenantId: string): string {
  return path.join(resolveSessionDir(tenantId), "session.json");
}
