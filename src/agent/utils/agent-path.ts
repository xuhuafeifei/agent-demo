import fs from "node:fs";
import path from "node:path";
import { resolveTenantWorkspaceDir } from "../../utils/app-path.js";

/**
 * Pi / runtime 内部数据目录（如 auth.json、models.json）。
 *
 * - 默认：`~/.fgbg/tenants/{tenantId}/workspace/.pi-agent`（按租户隔离，不再使用全局 ~/.fgbg/agent）
 * - 可通过 `FGBG_AGENT_DIR` 覆盖为任意路径。
 */
export function resolveAgentDir(tenantId: string): string {
  const override = process.env.FGBG_AGENT_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(resolveTenantWorkspaceDir(tenantId), ".pi-agent");
}

/**
 * 确保 Pi runtime 数据目录存在，不存在则创建（权限 0o700）。
 * 调用方应先保证对应租户的 workspace 已存在（例如先调用 `ensureAgentWorkspace`）。
 */
export function ensureAgentDir(tenantId: string): string {
  const agentDir = resolveAgentDir(tenantId);
  if (!fs.existsSync(agentDir)) {
    fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  }
  return agentDir;
}
