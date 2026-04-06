/**
 * 工具参数脱敏工具
 * 用于在 SSE 返回给前端时，对敏感参数进行脱敏展示
 */

import { SENSITIVE_ENV_PATTERNS } from "./constants.js";

/**
 * 敏感键匹配（复用环境变量敏感模式）
 */
function isSensitiveKey(key: string): boolean {
  const upperKey = key.toUpperCase();
  return SENSITIVE_ENV_PATTERNS.some((pattern) =>
    upperKey.includes(pattern)
  );
}

/**
 * 值脱敏：将字符串值替换为 ***，其他类型保留原始值
 */
function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length === 0) return value;
    return "***";
  }
  // 数字、布尔值等直接返回
  return value;
}

/**
 * 深度脱敏对象/数组
 * 递归处理嵌套结构
 */
function sanitizeDeep(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeDeep);
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (isSensitiveKey(key)) {
        result[key] = "***";
      } else {
        result[key] = sanitizeDeep(val);
      }
    }
    return result;
  }

  // 基本类型直接返回
  return value;
}

/**
 * 对工具参数进行脱敏处理
 * 
 * @param args - 工具入参对象
 * @returns 脱敏后的参数对象
 * 
 * @example
 * sanitizeToolArgs({ path: "/app/config", apiKey: "sk-xxx123" })
 * // 返回: { path: "/app/config", apiKey: "***" }
 * 
 * @example
 * sanitizeToolArgs({ 
 *   command: "ls -la",
 *   env: { API_KEY: "sk-xxx", PATH: "/usr/bin" }
 * })
 * // 返回: { command: "ls -la", env: { API_KEY: "***", PATH: "/usr/bin" } }
 */
export function sanitizeToolArgs(args: unknown): unknown {
  if (args === null || args === undefined) {
    return args;
  }

  if (typeof args !== "object") {
    // 非对象类型直接返回（基本类型不需要脱敏）
    return args;
  }

  if (Array.isArray(args)) {
    return args.map(sanitizeDeep);
  }

  return sanitizeDeep(args);
}
