/**
 * 工具层统一导出
 *
 * 模块职责：
 * - tool-result.ts: Pi 工具返回协议
 * - tool-security.model/defaults/resolve: 安全配置
 * - tool-catalog.ts: 静态工具目录
 * - tool-bundle.ts: 装配与策略查询
 * - tool-approval.ts: 审批策略
 */

// 工具执行结果协议
export {
  okResult,
  errResult,
  type ToolError,
  type ToolErrorCode,
  type ToolDetails,
} from "./tool-result.js";

// 工具安全配置
export type {
  ToolSecurityConfig,
  ApprovalConfig,
  AccessConfig,
} from "./security/tool-security.model.js";
export { ToolMode } from "./security/tool-security.model.js";
export {
  DEFAULT_GUARD_CONFIG,
  DEFAULT_SAFETY_CONFIG,
  DEFAULT_YOLO_CONFIG,
  DEFAULT_TOOL_SECURITY_CONFIG,
} from "./security/tool-security.defaults.js";
export {
  getConfigByPreset,
  resolveToolSecurityConfig,
} from "./security/tool-security.resolve.js";

// 工具目录与装配
export { TOOL_CATALOG, type ToolCatalogName } from "./tool-catalog.js";
export {
  createToolBundle,
  getFilterContextToolNames,
  type ToolBundle,
} from "./tool-bundle.js";

// 审批策略
export {
  requiresApproval,
  getApprovalConfigFromResolved,
} from "./tool-approval.js";
