import Qwen from '@lobehub/icons/es/Qwen';
import DeepSeek from '@lobehub/icons/es/DeepSeek';
import type { ComponentType } from 'react';

const QwenColor = Qwen.Color;
const DeepSeekColor = DeepSeek.Color;

type ProviderIcon = ComponentType<any> | string;

// ─── Provider icon mapping ────────────────────────────────────────
/**
 * 获取供应商图标
 */
export function getProviderIcon(providerId: string): ProviderIcon {
  const iconMap: Record<string, ProviderIcon> = {
    'qwen-portal': QwenColor,
    deepseek: DeepSeekColor,
    minimax: '🔵',
    moonshot: '🌙',
    'kimi-code': '🌟',
    xiaomi: 'MI',
    ollama: '🦙',
  };
  return iconMap[providerId] || '⚙️';
}

/**
 * 获取供应商名称
 */
export function getProviderName(
  providerId: string,
  providerInfo?: { name?: string }
): string {
  const nameMap: Record<string, string> = {
    'qwen-portal': 'Qwen',
    deepseek: 'DeepSeek',
    minimax: 'MiniMax',
    moonshot: 'Moonshot',
    'kimi-code': 'Kimi Code',
    xiaomi: 'Xiaomi',
    ollama: 'Ollama',
  };
  return nameMap[providerId] || providerInfo?.name || providerId;
}

// ─── Utility helpers ────────────────────────────────────────────────

type JsonObject = Record<string, unknown>;

/**
 * 深度获取对象属性值
 */
export function deepGet(obj: JsonObject | undefined | null, path: string): unknown {
  return path
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/**
 * 深度设置对象属性值
 */
export function deepSet(
  target: JsonObject,
  path: string,
  value: unknown
): void {
  const keys = path.split('.');
  let cursor: JsonObject = target;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = value;
      return;
    }
    if (
      typeof cursor[key] !== 'object' ||
      cursor[key] === null ||
      Array.isArray(cursor[key])
    ) {
      cursor[key] = {};
    }
    cursor = cursor[key] as JsonObject;
  });
}

/**
 * 判断是否为纯对象
 */
export function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 深度相等比较
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 深度差异比较
 */
export function deepDiff(
  current: unknown,
  base: unknown
): JsonObject | undefined {
  if (deepEqual(current, base)) return undefined;
  if (!isPlainObject(current) || !isPlainObject(base))
    return current as JsonObject;
  const out: JsonObject = {};
  Object.keys(current as JsonObject).forEach((key) => {
    const diff = deepDiff(
      (current as JsonObject)[key],
      (base as JsonObject)[key]
    );
    if (diff !== undefined) out[key] = diff;
  });
  // Keys removed from current vs base (merge-only PATCH would otherwise keep stale values)
  Object.keys(base as JsonObject).forEach((key) => {
    if (!(key in current)) {
      out[key] = null;
    }
  });
  return Object.keys(out).length ? out : undefined;
}
