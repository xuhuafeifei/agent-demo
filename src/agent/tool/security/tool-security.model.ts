/**
 * 工具安全配置类型定义（仅接口，无默认常量、无 resolve 函数）
 *
 * 设计原则：
 * - safety/guard/yolo 只是内置模式，展开为实际字段
 * - 系统最终只看实际字段，不直接读 mode
 * - 支持前端查看/修改实际字段（非内置模式时）
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

/** 不可审批时的策略（用于 QQ 等无法交互的渠道） */
export type UnapprovableStrategy = "skip" | "reject";

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
  /** 内置模式（仅用于快速配置，系统最终看下面的实际字段） */
  preset?: ToolMode;

  /** 启用的工具列表（替代旧的 tools/customTools/innerTools 分组） */
  enabledTools: string[];

  /** 用户自定义拒绝路径列表 */
  denyPaths: string[];

  /** 访问范围配置 */
  access: AccessConfig;

  /** 审批确认配置 */
  approval: ApprovalConfig;

  /** 不可审批时的策略（QQ 等无法交互的渠道）：skip=跳过审批直接执行，reject=拒绝执行 */
  unapprovableStrategy?: UnapprovableStrategy;
}
