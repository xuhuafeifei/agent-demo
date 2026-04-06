/**
 * 工具安全配置默认常量（仅数据，可依赖 model 做 satisfies 校验）
 */

import type { ToolSecurityConfig } from "./tool-security.model.js";

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
  unapprovableStrategy: "skip",
} satisfies ToolSecurityConfig;

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
  unapprovableStrategy: "reject",
} satisfies ToolSecurityConfig;

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
  unapprovableStrategy: "skip",
} satisfies ToolSecurityConfig;

/** 默认配置（guard 模式） */
export const DEFAULT_TOOL_SECURITY_CONFIG: ToolSecurityConfig =
  DEFAULT_GUARD_CONFIG;
