import { getUserFgbgConfig, writeFgbgUserConfig } from "../utils/app-path.js";
import type { FgbgUserConfig } from "../types.js";

/**
 * memory 模块对 fgbg.json 中 agents.memorySearch 的解读类型。
 * 补齐默认值后必填字段均存在。
 */
export type MemorySearchConfig = {
  mode: "local" | "remote";
  model: string;
  endpoint: string;
  apiKey: string;
  chunkMaxChars: number;
  embeddingDimensions: number;
};

// 默认写“模型名”，由 embedding provider 在目录内解析到实际 .gguf 文件。
const DEFAULT_MEMORY_SEARCH_MODEL = "nomic-embed-text-v1.5.Q4_K_M";
const DEFAULT_MEMORY_CHUNK_MAX_CHARS = 500;
const DEFAULT_MEMORY_EMBEDDING_DIMENSIONS = 768;

function normalizeChunkMaxChars(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MEMORY_CHUNK_MAX_CHARS;
  }
  const rounded = Math.floor(value);
  if (rounded < 100) return 100;
  if (rounded > 4000) return 4000;
  return rounded;
}

function normalizeEmbeddingDimensions(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MEMORY_EMBEDDING_DIMENSIONS;
  }
  const rounded = Math.floor(value);
  if (rounded < 64) return 64;
  if (rounded > 4096) return 4096;
  return rounded;
}

/**
 * 补齐 agents.memorySearch 默认配置，不覆盖用户已配置字段。
 */
export function ensureMemorySearchConfig(cfg: FgbgUserConfig): FgbgUserConfig {
  const next: FgbgUserConfig = { ...cfg };
  const agents = { ...(next.agents ?? {}) };
  const raw = agents.memorySearch ?? {};
  const mode = raw.mode === "remote" ? "remote" : "local";
  const memorySearch: MemorySearchConfig = {
    mode,
    model: raw.model?.trim() || DEFAULT_MEMORY_SEARCH_MODEL,
    endpoint: raw.endpoint?.trim() ?? "",
    apiKey: raw.apiKey?.trim() ?? "",
    chunkMaxChars: normalizeChunkMaxChars(raw.chunkMaxChars),
    embeddingDimensions: normalizeEmbeddingDimensions(raw.embeddingDimensions),
  };
  agents.memorySearch = memorySearch;
  next.agents = agents;
  return next;
}

/**
 * 取补齐后的 memorySearch 配置（经 ensureMemorySearchConfig 后必存在）。
 */
export function getMemorySearchConfig(
  config: FgbgUserConfig,
): MemorySearchConfig {
  return ensureMemorySearchConfig(config).agents!
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
