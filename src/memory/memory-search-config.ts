import {
  getUserFgbgConfig,
  writeFgbgUserConfig,
} from "../utils/app-path.js";
import type { FgbgUserConfig } from "../agent/types.js";

/**
 * memory 模块对 fgbg.json 中 agent.memorySearch 的解读类型。
 * 补齐默认值后必填字段均存在。
 */
export type MemorySearchConfig = {
  mode: "local" | "remote";
  model: string;
  endpoint: string;
  apiKey: string;
};

const DEFAULT_MEMORY_SEARCH_MODEL = "all-MiniLM-L6-v2 GGUF";

/**
 * 补齐 agent.memorySearch 默认配置，不覆盖用户已配置字段。
 */
export function ensureMemorySearchConfig(
  cfg: FgbgUserConfig,
): FgbgUserConfig {
  const next: FgbgUserConfig = { ...cfg };
  const agent = { ...(next.agent ?? {}) };
  const raw = agent.memorySearch ?? {};
  const mode = raw.mode === "remote" ? "remote" : "local";
  const memorySearch: MemorySearchConfig = {
    mode,
    model: raw.model?.trim() || DEFAULT_MEMORY_SEARCH_MODEL,
    endpoint: raw.endpoint?.trim() ?? "",
    apiKey: raw.apiKey?.trim() ?? "",
  };
  agent.memorySearch = memorySearch;
  next.agent = agent;
  return next;
}

/**
 * 取补齐后的 memorySearch 配置（经 ensureMemorySearchConfig 后必存在）。
 */
export function getMemorySearchConfig(
  config: FgbgUserConfig,
): MemorySearchConfig {
  return ensureMemorySearchConfig(config).agent!
    .memorySearch! as MemorySearchConfig;
}

/**
 * 读取 fgbg.json → 补齐 memorySearch 默认值 → 写回，并返回补齐后的配置。
 * 由 memory 模块使用，app-path 只负责原始读写。
 */
export function ensureFgbgUserConfigMemorySearchAndWrite(): FgbgUserConfig {
  const raw = getUserFgbgConfig();
  const next = ensureMemorySearchConfig(raw);
  writeFgbgUserConfig(next);
  return next;
}
