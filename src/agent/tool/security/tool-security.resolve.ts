/**
 * 工具安全配置解析/合并逻辑
 *
 * 依赖：defaults + model
 * 输入：Partial<ToolSecurityConfig> / 原始片段
 * 输出：完整 ToolSecurityConfig
 */

import type { ToolSecurityConfig } from "./tool-security.model.js";
import type { ToolMode } from "./constants.js";
import {
  DEFAULT_GUARD_CONFIG,
  DEFAULT_SAFETY_CONFIG,
  DEFAULT_YOLO_CONFIG,
} from "./tool-security.defaults.js";

/**
 * 根据内置模式获取完整的默认配置
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
