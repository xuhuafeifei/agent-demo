/**
 * 工具安全模块统一导出
 */

// 常量
export {
  TEXT_EXTENSIONS,
  BINARY_EXTENSIONS,
  SENSITIVE_ENV_PATTERNS,
  GLOBAL_DENY_PATHS_POSIX,
  GLOBAL_DENY_PATHS_WIN,
  MODE_TOOL_SETS,
} from "./constants.js";

// 类型
export type {
  ToolSecurityConfig,
  ApprovalConfig,
  AccessConfig,
} from "./tool-security.model.js";
export { ToolMode } from "./tool-security.model.js";

// 默认常量
export {
  DEFAULT_GUARD_CONFIG,
  DEFAULT_SAFETY_CONFIG,
  DEFAULT_YOLO_CONFIG,
  DEFAULT_TOOL_SECURITY_CONFIG,
} from "./tool-security.defaults.js";

// 解析函数
export {
  getConfigByPreset,
  resolveToolSecurityConfig,
} from "./tool-security.resolve.js";

// 路径检查
export { checkPathSafety } from "./path-checker.js";
export type { PathCheckResult } from "./path-checker.js";

// 文件类型检测
export { isTextFile, getFileTypeRejectReason } from "./file-type-checker.js";

// Shell 安全（预检 + 解析 + 白名单）
export { shellPrecheck } from "./shell-precheck.js";
export type { ShellPrecheckResult } from "./shell-precheck.js";
export { parseShellCommand, type ParsedCommand } from "./shell-parser.js";
export {
  SHELL_ALLOWLIST,
  containsSensitiveEnvRef,
  checkMetacharacters,
  checkSensitiveEnvRef,
  checkPaths,
  type ShellCommandProfile,
  type PrecheckContext,
  type PrecheckFn,
} from "./shell-allowlist.js";

// 参数脱敏
export { sanitizeToolArgs } from "./param-sanitizer.js";
