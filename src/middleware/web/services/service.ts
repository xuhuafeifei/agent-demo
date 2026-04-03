import type { FgbgUserConfig } from "../../../types.js";
import {
  evicateFgbgUserConfigCache,
  getDefaultFgbgUserConfig,
  readFgbgUserConfig,
  writeFgbgUserConfig,
} from "../../../config/index.js";

/**
 * Utility type for partial config patches.
 */
export type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends Array<infer U>
    ? RecursivePartial<U>[]
    : T[P] extends object
      ? RecursivePartial<T[P]>
      : T[P];
};

/** Protected config paths (currently empty, reserved for future use) */
const PROTECTED_PATHS = new Set<string>();

/**
 * Check if a value is a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Deep equality comparison.
 */
function deepEqual(value: unknown, expectation: unknown): boolean {
  if (value === expectation) return true;
  if (
    value === undefined ||
    expectation === undefined ||
    value === null ||
    expectation === null
  ) {
    return value === expectation;
  }
  if (Array.isArray(value) && Array.isArray(expectation)) {
    if (value.length !== expectation.length) return false;
    return value.every((item, idx) => deepEqual(item, expectation[idx]));
  }
  if (isPlainObject(value) && isPlainObject(expectation)) {
    const keys = new Set([...Object.keys(value), ...Object.keys(expectation)]);
    return Array.from(keys).every((key) =>
      deepEqual(value[key], expectation[key]),
    );
  }
  return false;
}

/**
 * Collect paths that have default values.
 */
function collectDefaultPaths(
  current: Record<string, unknown>,
  defaults: Record<string, unknown>,
  prefix: string,
  acc: Set<string>,
) {
  Object.keys(current).forEach((key) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    const currentValue = current[key];
    const defaultValue = defaults[key];
    if (isPlainObject(currentValue) && isPlainObject(defaultValue)) {
      collectDefaultPaths(currentValue, defaultValue, nextPrefix, acc);
      return;
    }
    if (defaultValue !== undefined && deepEqual(currentValue, defaultValue)) {
      acc.add(nextPrefix);
    }
  });
}

/**
 * Build metadata for config including default and protected paths.
 */
export function buildConfigMetadata(config: FgbgUserConfig) {
  const defaults = getDefaultFgbgUserConfig();
  const defaultPaths = new Set<string>();
  collectDefaultPaths(config, defaults, "", defaultPaths);
  return {
    defaultPaths: Array.from(defaultPaths),
    protectedPaths: Array.from(PROTECTED_PATHS),
  };
}

/**
 * Deep clone a config object.
 */
export function cloneConfig(config: FgbgUserConfig): FgbgUserConfig {
  if (typeof structuredClone === "function") {
    return structuredClone(config);
  }
  return JSON.parse(JSON.stringify(config));
}

/**
 * Apply a patch to a config object (mutates target).
 */
export function applyConfigPatch(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  Object.keys(patch).forEach((key) => {
    const newValue = patch[key];
    if (isPlainObject(newValue)) {
      if (!isPlainObject(target[key])) {
        target[key] = {};
      }
      applyConfigPatch(
        target[key] as Record<string, unknown>,
        newValue as Record<string, unknown>,
      );
      return;
    }
    target[key] = newValue;
  });
}

/**
 * Check if a patch touches any protected paths.
 */
export function hasProtectedPath(
  node: Record<string, unknown>,
  path: string[] = [],
): boolean {
  return Object.keys(node).some((key) => {
    const nested = node[key];
    const nextPath = [...path, key];
    if (PROTECTED_PATHS.has(nextPath.join("."))) {
      return true;
    }
    if (isPlainObject(nested)) {
      return hasProtectedPath(nested as Record<string, unknown>, nextPath);
    }
    return false;
  });
}

/**
 * Read current config with metadata.
 */
export function readConfigWithMetadata() {
  const config = readFgbgUserConfig();
  return {
    config,
    metadata: buildConfigMetadata(config),
  };
}

/**
 * Patch config with a partial object.
 */
export function patchConfig(
  patch: RecursivePartial<FgbgUserConfig>,
): { config: FgbgUserConfig; metadata: ReturnType<typeof buildConfigMetadata> } {
  if (hasProtectedPath(patch as Record<string, unknown>)) {
    throw new Error("尝试修改受保护字段（例如 qwen API Key），操作被拒绝。");
  }

  const current = readFgbgUserConfig();
  const updated = cloneConfig(current);
  applyConfigPatch(
    updated as Record<string, unknown>,
    patch as Record<string, unknown>,
  );
  writeFgbgUserConfig(updated);
  evicateFgbgUserConfigCache();
  
  return readConfigWithMetadata();
}

/**
 * Reset config to defaults.
 */
export function resetConfig(): { config: FgbgUserConfig; metadata: ReturnType<typeof buildConfigMetadata> } {
  const defaults = getDefaultFgbgUserConfig();
  writeFgbgUserConfig(defaults);
  evicateFgbgUserConfigCache();
  
  return readConfigWithMetadata();
}

/**
 * Merge memory search config for testing.
 */
export function mergeMemorySearchForTest(
  base: FgbgUserConfig,
  partial?: RecursivePartial<FgbgUserConfig["agents"]["memorySearch"]>,
): FgbgUserConfig["agents"]["memorySearch"] {
  const ms = base.agents.memorySearch;
  if (!partial) {
    return ms;
  }
  const partialModel =
    typeof partial.model === "string" && partial.model.trim() !== ""
      ? partial.model.trim()
      : undefined;
  return {
    mode: (partial.mode as FgbgUserConfig["agents"]["memorySearch"]["mode"]) ??
      ms.mode,
    model: partialModel ?? ms.model,
    endpoint: partial.endpoint ?? ms.endpoint,
    apiKey: partial.apiKey ?? ms.apiKey,
    chunkMaxChars: partial.chunkMaxChars ?? ms.chunkMaxChars,
    embeddingDimensions:
      partial.embeddingDimensions ?? ms.embeddingDimensions,
    download: {
      url: partial.download?.url ?? ms.download.url,
      timeout: partial.download?.timeout ?? ms.download.timeout,
      enabled: partial.download?.enabled ?? ms.download.enabled,
    },
  };
}
