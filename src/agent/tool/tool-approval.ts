/**
 * 工具审批策略（纯函数）
 *
 * 只依赖已 resolve 的 approval 段，不持有单例，便于单测。
 */

import type { ApprovalConfig } from "./security/tool-security.model.js";

/**
 * 检查某个工具是否需要审批
 * @param toolName 工具名称
 * @param approvalConfig 已解析的审批配置
 */
export function requiresApproval(
  toolName: string,
  approvalConfig: ApprovalConfig,
): boolean {
  if (!approvalConfig.enabled) return false;
  return approvalConfig.requireApprovalFor?.includes(toolName) || false;
}

/**
 * 从已解析的安全配置中提取审批配置
 * （此函数为便利函数，调用方也可直接访问 resolved.approval）
 */
export function getApprovalConfigFromResolved(resolved: {
  approval: ApprovalConfig;
}): ApprovalConfig {
  return resolved.approval;
}
