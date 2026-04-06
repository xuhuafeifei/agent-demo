/**
 * 工具安全配置类型定义
 *
 * 设计原则：
 * - safety/guard/yolo 只是预设模式，展开为实际字段
 * - 系统最终只看实际字段，不直接读 mode
 * - 支持前端查看/修改实际字段（非预设模式时）
 */

import type { ToolMode } from "./constants.js";

export { ToolMode };

/** 审批确认配置 */
export interface ApprovalConfig {
  /** 是否启用审批（guard 默认 true，safety 默认 true，yolo 默认 false） */
  enabled: boolean;

  /** 需要审批的工具列表（白名单：在此列表中的工具执行前需要用户确认） */
  requireApprovalFor?: string[];

  /** 超时时间（毫秒），超时后自动拒绝（默认 5 分钟） */
  timeoutMs?: number;
}

/** 访问范围配置 */
export interface AccessConfig {
  /**
   * 允许的作用域（递进包含）：
   * - workspace：仅 FGBG 工具传入的 workspace 根之下
   * - user-home：当前用户主目录（与 shell `~` / os.homedir() 一致）之下，并 ∪ workspace 根之下
   * - system：整机路径（仍受黑名单约束）
   */
  scope: "workspace" | "user-home" | "system";

  /** 是否允许访问隐藏文件（以 . 开头） */
  allowHiddenFiles: boolean;

  /** 是否允许跟随符号链接 */
  allowSymlinks: boolean;
}

/** 工具安全配置（对应 fgbg.json 中的 toolSecurity 字段） */
export interface ToolSecurityConfig {
  /** 预设模式（仅用于快速配置，系统最终看下面的实际字段） */
  preset?: ToolMode;

  /** 启用的工具列表（替代旧的 tools/customTools/innerTools 分组） */
  enabledTools: string[];

  /** 用户自定义拒绝路径列表 */
  denyPaths: string[];

  /** 访问范围配置 */
  access: AccessConfig;

  /** 审批确认配置 */
  approval: ApprovalConfig;
}

/** 默认 guard 模式的完整配置 */
export const DEFAULT_GUARD_CONFIG: ToolSecurityConfig = {
  preset: "guard",
  enabledTools: [
    "read",
    "write",
    "memorySearch",
    "persistKnowledge",
    "loadSkill",
    "createReminderTask",
    "createAgentTask",
    "compactContext",
    "getNow",
    "shiftTime",
    "listTaskSchedules",
    "runTaskByName",
    "deleteTaskByName",
  ],
  denyPaths: [],
  access: {
    scope: "user-home",
    allowHiddenFiles: false,
    allowSymlinks: false,
  },
  approval: {
    enabled: true,
    requireApprovalFor: ["read", "write", "shellExecute"],
    timeoutMs: 5 * 60 * 1000, // 5 分钟
  },
};

/** 默认 safety 模式的完整配置 */
export const DEFAULT_SAFETY_CONFIG: ToolSecurityConfig = {
  preset: "safety",
  enabledTools: [
    "read",
    "write",
    "memorySearch",
    "persistKnowledge",
    "loadSkill",
    "getNow",
    "shiftTime",
    "createReminderTask",
    "listTaskSchedules",
  ],
  denyPaths: [],
  access: {
    scope: "workspace",
    allowHiddenFiles: false,
    allowSymlinks: false,
  },
  approval: {
    enabled: true,
    requireApprovalFor: ["read", "write"],
    timeoutMs: 5 * 60 * 1000,
  },
};

/** 默认 yolo 模式的完整配置 */
export const DEFAULT_YOLO_CONFIG: ToolSecurityConfig = {
  preset: "yolo",
  enabledTools: [
    "read",
    "write",
    "memorySearch",
    "persistKnowledge",
    "loadSkill",
    "createReminderTask",
    "createAgentTask",
    "compactContext",
    "shellExecute",
    "getNow",
    "shiftTime",
    "listTaskSchedules",
    "runTaskByName",
    "deleteTaskByName",
  ],
  denyPaths: [],
  access: {
    scope: "system",
    allowHiddenFiles: true,
    allowSymlinks: true,
  },
  approval: {
    enabled: false,
    requireApprovalFor: [],
    timeoutMs: 5 * 60 * 1000,
  },
};

/** 默认配置（guard 模式） */
export const DEFAULT_TOOL_SECURITY_CONFIG: ToolSecurityConfig =
  DEFAULT_GUARD_CONFIG;

/**
 * 根据预设模式获取完整的默认配置
 */
export function getConfigByPreset(mode: ToolMode): ToolSecurityConfig {
  switch (mode) {
    case "safety":
      return DEFAULT_SAFETY_CONFIG;
    case "yolo":
      return DEFAULT_YOLO_CONFIG;
    case "guard":
    default:
      return DEFAULT_GUARD_CONFIG;
  }
}

/**
 * 解析并规范化安全配置
 * 如果 preset 有值，以 preset 为准填充默认值
 * 如果有自定义字段，覆盖默认值
 */
export function resolveToolSecurityConfig(
  raw?: Partial<ToolSecurityConfig>,
): ToolSecurityConfig {
  if (!raw || Object.keys(raw).length === 0) {
    return DEFAULT_GUARD_CONFIG;
  }

  // 如果有 preset，获取该模式的默认配置
  const preset = raw.preset || "guard";
  const baseConfig = getConfigByPreset(preset);

  // 用用户配置覆盖默认值（仅覆盖非 undefined 的字段）
  return {
    preset,
    enabledTools: raw.enabledTools || baseConfig.enabledTools,
    denyPaths: raw.denyPaths ?? baseConfig.denyPaths,
    access: raw.access
      ? { ...baseConfig.access, ...raw.access }
      : baseConfig.access,
    approval: raw.approval
      ? { ...baseConfig.approval, ...raw.approval }
      : baseConfig.approval,
  };
}
