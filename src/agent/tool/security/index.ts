/**
 * 工具安全模块统一导出
 */

// 常量
export {
  TEXT_EXTENSIONS,
  BINARY_EXTENSIONS,
  SHELL_ALLOWLIST,
  SHELL_DENYLIST,
  SENSITIVE_ENV_PATTERNS,
  GLOBAL_DENY_PATHS_POSIX,
  GLOBAL_DENY_PATHS_WIN,
  MODE_TOOL_SETS,
  SHELL_METACHARACTERS_REGEX,
  containsShellMetacharacters,
} from './constants.js';

// 类型
export type { ToolSecurityConfig, ApprovalConfig, AccessConfig } from './tool-security.model.js';
export { ToolMode } from './tool-security.model.js';

// 默认常量
export {
  DEFAULT_GUARD_CONFIG,
  DEFAULT_SAFETY_CONFIG,
  DEFAULT_YOLO_CONFIG,
  DEFAULT_TOOL_SECURITY_CONFIG,
} from './tool-security.defaults.js';

// 解析函数
export {
  getConfigByPreset,
  resolveToolSecurityConfig,
} from './tool-security.resolve.js';

// 路径检查
export { checkPathSafety, resolvePathInWorkspace } from './path-checker.js';
export type { PathCheckResult } from './path-checker.js';

// 文件类型检测
export { isTextFile, getFileTypeRejectReason } from './file-type-checker.js';

// Shell 预检
export { preExecuteCheck } from './shell-precheck.js';

// 参数脱敏
export { sanitizeToolArgs } from './param-sanitizer.js';
