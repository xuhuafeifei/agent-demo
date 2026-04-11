import type { FgbgUserConfig } from "../../../types.js";
import {
  evicateFgbgUserConfigCache,
  getDefaultFgbgUserConfig,
  readFgbgUserConfig,
  writeFgbgUserConfig,
} from "../../../config/index.js";
import {
  clearQQAccounts,
  getPrimaryQQBot,
  mergePrimaryQQBotCredentials,
  setQQBotTargetOpenIdByAppId,
} from "../../qq/qq-account.js";

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
/**
 * PATCH 中空字符串的 qqbot appId/clientSecret 表示「不修改」，不参与 apply。
 */
function omitEmptyQQCredentialFields(
  patch: RecursivePartial<FgbgUserConfig>,
): RecursivePartial<FgbgUserConfig> {
  if (!patch.channels?.qqbot) return patch;
  const qq = { ...(patch.channels.qqbot as Record<string, unknown>) };
  if (qq.appId === "") delete qq.appId;
  if (qq.clientSecret === "") delete qq.clientSecret;
  if (qq.targetOpenid === "" || qq.targetOpenid == null) delete qq.targetOpenid;
  return {
    ...patch,
    channels: {
      ...patch.channels,
      qqbot: qq as FgbgUserConfig["channels"]["qqbot"],
    },
  };
}

export function applyConfigPatch(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  Object.keys(patch).forEach((key) => {
    const newValue = patch[key];
    if (newValue === null) {
      delete target[key];
      return;
    }
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
export function patchConfig(patch: RecursivePartial<FgbgUserConfig>): {
  config: FgbgUserConfig;
  metadata: ReturnType<typeof buildConfigMetadata>;
} {
  if (hasProtectedPath(patch as Record<string, unknown>)) {
    throw new Error("尝试修改受保护字段（例如 qwen API Key），操作被拒绝。");
  }

  const qqPatch = patch.channels?.qqbot as Record<string, unknown> | undefined;
  if (qqPatch && typeof qqPatch === "object") {
    const cred: { appId?: string; clientSecret?: string } = {};
    if (typeof qqPatch.appId === "string" && qqPatch.appId.trim() !== "") {
      cred.appId = qqPatch.appId.trim();
    }
    if (
      typeof qqPatch.clientSecret === "string" &&
      qqPatch.clientSecret.trim() !== ""
    ) {
      cred.clientSecret = qqPatch.clientSecret.trim();
    }
    if (Object.keys(cred).length > 0) {
      mergePrimaryQQBotCredentials(cred);
    }
    if (
      typeof qqPatch.targetOpenid === "string" &&
      qqPatch.targetOpenid.trim() !== ""
    ) {
      const appIdForTarget =
        typeof qqPatch.appId === "string" && qqPatch.appId.trim() !== ""
          ? qqPatch.appId.trim()
          : getPrimaryQQBot()?.appId?.trim() ?? "";
      if (appIdForTarget) {
        setQQBotTargetOpenIdByAppId(
          appIdForTarget,
          qqPatch.targetOpenid.trim(),
        );
      }
    }
  }

  const patchForApply = omitEmptyQQCredentialFields(patch);

  const current = readFgbgUserConfig();
  const updated = cloneConfig(current);
  applyConfigPatch(
    updated as Record<string, unknown>,
    patchForApply as Record<string, unknown>,
  );

  updated.channels.qqbot = {
    enabled: updated.channels.qqbot.enabled,
  };

  // 校验：保护 qwen-portal 不被删除
  if (current.models?.providers?.["qwen-portal"]) {
    const updatedProviders = updated.models?.providers as
      | Record<string, unknown>
      | undefined;
    if (!updatedProviders || !updatedProviders["qwen-portal"]) {
      throw new Error("qwen-portal 是内置核心配置，不允许删除。");
    }
  }

  writeFgbgUserConfig(updated);
  evicateFgbgUserConfigCache();

  return readConfigWithMetadata();
}

/**
 * Reset config to defaults.
 */
export function resetConfig(): {
  config: FgbgUserConfig;
  metadata: ReturnType<typeof buildConfigMetadata>;
} {
  clearQQAccounts();
  const defaults = getDefaultFgbgUserConfig();
  writeFgbgUserConfig(defaults);
  evicateFgbgUserConfigCache();

  return readConfigWithMetadata();
}

/**
 * 恢复指定配置模块的默认值，不影响其他配置模块。
 * @param sectionPath - 点分路径指定要恢复的配置模块（例如 "channels.qqbot"）
 */
export function resetConfigSection(sectionPath: string): {
  config: FgbgUserConfig;
  metadata: ReturnType<typeof buildConfigMetadata>;
} {
  // 读取当前配置和默认配置
  const current = readFgbgUserConfig();
  const defaults = getDefaultFgbgUserConfig();

  // 解析路径（例如 "channels.qqbot" -> ["channels", "qqbot"]）
  const pathParts = sectionPath.split(".");

  // 从默认配置中提取指定部分的默认值
  let defaultSection: unknown = defaults;
  for (const part of pathParts) {
    if (
      defaultSection &&
      typeof defaultSection === "object" &&
      part in (defaultSection as Record<string, unknown>)
    ) {
      defaultSection = (defaultSection as Record<string, unknown>)[part];
    } else {
      throw new Error(`默认配置中不存在路径: ${sectionPath}`);
    }
  }

  // 深拷贝当前配置，避免修改原对象
  const updated = cloneConfig(current);
  const updatedObj = updated as Record<string, unknown>;

  // 在当前配置中找到目标路径的父节点
  let targetSection: unknown = updatedObj;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const part = pathParts[i];
    if (
      !targetSection ||
      typeof targetSection !== "object" ||
      !(part in (targetSection as Record<string, unknown>))
    ) {
      throw new Error(
        `当前配置中不存在路径: ${pathParts.slice(0, i + 1).join(".")}`,
      );
    }
    targetSection = (targetSection as Record<string, unknown>)[part];
  }

  // 将最后一级的值替换为默认值
  const lastPart = pathParts[pathParts.length - 1];
  (targetSection as Record<string, unknown>)[lastPart] = defaultSection;

  if (sectionPath === "channels.qqbot") {
    clearQQAccounts();
  }

  // 写入磁盘并清除缓存
  writeFgbgUserConfig(updated);
  evicateFgbgUserConfigCache();

  // 返回更新后的配置及元信息
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
    mode:
      (partial.mode as FgbgUserConfig["agents"]["memorySearch"]["mode"]) ??
      ms.mode,
    model: partialModel ?? ms.model,
    endpoint: partial.endpoint ?? ms.endpoint,
    apiKey: partial.apiKey ?? ms.apiKey,
    chunkMaxChars: partial.chunkMaxChars ?? ms.chunkMaxChars,
    embeddingDimensions: partial.embeddingDimensions ?? ms.embeddingDimensions,
    download: {
      url: partial.download?.url ?? ms.download.url,
      timeout: partial.download?.timeout ?? ms.download.timeout,
      enabled: partial.download?.enabled ?? ms.download.enabled,
    },
  };
}
