import fs from "node:fs";
import path from "node:path";
import {
  ensureFgbgUserConfigMemorySearchAndWrite,
  getMemorySearchConfig,
  type MemorySearchConfig,
} from "../memory-search-config.js";
import { ensureDirSync, resolveEmbeddingModelDir } from "../utils/path.js";
import type { FgbgUserConfig } from "../../agent/types.js";

type EmbeddingContextLike = {
  getEmbeddingFor: (text: string) => Promise<{ vector: readonly number[] }>;
};

/**
 * Embedding 策略：按 mode（local / remote）可插拔的实现。
 * 策略内部自行管理上下文与缓存，对外只暴露 embed 能力。
 */
export type EmbeddingStrategy = {
  embedText: (text: string) => Promise<number[]>;
  embedTextBatch: (texts: string[]) => Promise<number[][]>;
};

type StrategyMode = NonNullable<MemorySearchConfig["mode"]>;

// ---------------------------------------------------------------------------
// Local 策略：node-llama-cpp + GGUF
// ---------------------------------------------------------------------------

/**
 * 解析 local 模式下的 GGUF 模型路径。
 *
 * 支持：
 * - memorySearch.model 为绝对路径
 * - memorySearch.model 为文件名（在 embedding 目录查找）
 * - embedding 目录第一个 .gguf 作为回退
 */
function resolveConfiguredModelPath(memorySearch: MemorySearchConfig): string {
  const embeddingDir = resolveEmbeddingModelDir();
  ensureDirSync(embeddingDir);

  const maybePath = memorySearch.model.trim();

  // 已是绝对路径且文件存在，直接使用
  if (path.isAbsolute(maybePath) && fs.existsSync(maybePath)) {
    return maybePath;
  }

  // 带路径或 .gguf 后缀：视为文件名，在 embedding 目录下查找
  if (
    maybePath.includes("/") ||
    maybePath.includes("\\") ||
    maybePath.endsWith(".gguf")
  ) {
    const joined = path.join(embeddingDir, path.basename(maybePath));
    if (fs.existsSync(joined)) return joined;
  }

  // 回退：取 embedding 目录下第一个 .gguf 文件
  const all = fs.readdirSync(embeddingDir, { withFileTypes: true });
  const gguf = all
    .filter(
      (entry) =>
        entry.isFile() && entry.name.toLowerCase().endsWith(".gguf"),
    )
    .map((entry) => path.join(embeddingDir, entry.name));
  if (gguf.length > 0) return gguf[0];

  throw new Error(
    `[memory] embedding model not found in ${embeddingDir}. Put a .gguf model there (e.g. bge-small-en-v1.5-q8_0.gguf).`,
  );
}

/** 创建 node-llama-cpp embedding 上下文（加载 GGUF 模型）。 */
async function createLocalContext(
  memorySearch: MemorySearchConfig,
): Promise<EmbeddingContextLike> {
  const modelPath = resolveConfiguredModelPath(memorySearch);

  let getLlamaFn:
    | undefined
    | (() =>
        Promise<{
          loadModel: (options: { modelPath: string }) => Promise<{
            createEmbeddingContext: () => Promise<EmbeddingContextLike>;
          }>;
        }>);

  // 动态 import，避免未安装 node-llama-cpp 时构建阶段就报错
  try {
    const module = (await import("node-llama-cpp")) as {
      getLlama: typeof getLlamaFn;
    };
    getLlamaFn = module.getLlama;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[memory] node-llama-cpp is unavailable (${message}). Install it with native arm64 Node on macOS.`,
    );
  }

  if (!getLlamaFn) {
    throw new Error("[memory] node-llama-cpp getLlama() not found");
  }

  const llama = await getLlamaFn();
  const model = await llama.loadModel({ modelPath });
  return model.createEmbeddingContext();
}

/** Local 策略：闭包内懒加载并缓存 context，对外只暴露 embed。 */
function createLocalStrategy(
  memorySearch: MemorySearchConfig,
): EmbeddingStrategy {
  let contextPromise: Promise<EmbeddingContextLike> | null = null;

  async function getContext(): Promise<EmbeddingContextLike> {
    if (!contextPromise) {
      contextPromise = createLocalContext(memorySearch);
    }
    return contextPromise;
  }

  return {
    async embedText(text: string): Promise<number[]> {
      const context = await getContext();
      const result = await context.getEmbeddingFor(text);
      return Array.from(result.vector); // 转为可变数组返回
    },
    async embedTextBatch(texts: string[]): Promise<number[][]> {
      const context = await getContext();
      const results = await Promise.all(
        texts.map((text) => context.getEmbeddingFor(text)),
      );
      return results.map((r) => Array.from(r.vector)); // 每条转为一维向量
    },
  };
}

// ---------------------------------------------------------------------------
// Remote 策略：占位，后续接 HTTP API
// ---------------------------------------------------------------------------

/** Remote 策略占位：后续可接 endpoint + apiKey 的 HTTP 调用。 */
function createRemoteStrategy(_memorySearch: MemorySearchConfig): EmbeddingStrategy {
  const message =
    "[memory] remote embedding mode is not implemented yet. Use mode: 'local' or implement remote strategy.";
  return {
    async embedText(): Promise<number[]> {
      throw new Error(message);
    },
    async embedTextBatch(): Promise<number[][]> {
      throw new Error(message);
    },
  };
}

// ---------------------------------------------------------------------------
// 单例：当前生效的策略（按最新 config 懒选取）
// ---------------------------------------------------------------------------

// 进程级缓存，mode 不变则复用同一策略，避免重复加载 GGUF
let cachedStrategy: EmbeddingStrategy | null = null;
let cachedMode: StrategyMode | null = null;

/**
 * 直接用 map 维护 mode -> 策略构造函数，入参统一为 MemorySearchConfig。
 */
const strategyByMode: Record<
  StrategyMode,
  (memorySearch: MemorySearchConfig) => EmbeddingStrategy
> = {
  local: (memorySearch) => createLocalStrategy(memorySearch),
  remote: (memorySearch) => createRemoteStrategy(memorySearch),
};

/** 按 mode 缓存策略实例，mode 不变则复用（local 的 context 也只建一次）。 */
function getOrCreateStrategy(config: FgbgUserConfig): EmbeddingStrategy {
  const memorySearch = getMemorySearchConfig(config);
  const mode = memorySearch.mode;

  if (cachedStrategy && cachedMode === mode) {
    return cachedStrategy;
  }
  const builder = strategyByMode[mode] ?? strategyByMode.local;
  cachedStrategy = builder(memorySearch);
  cachedMode = mode;
  return cachedStrategy;
}

// ---------------------------------------------------------------------------
// 对外 API（不变）
// ---------------------------------------------------------------------------

/**
 * 校验并补齐 embedding provider 运行条件，并写回 fgbg.json。
 */
export function ensureEmbeddingProviderReady(): FgbgUserConfig {
  const next = ensureFgbgUserConfigMemorySearchAndWrite();

  // 仅 local 模式需要本地 GGUF 模型目录，确保目录存在
  if ((next.agent?.memorySearch?.mode ?? "local") === "local") {
    ensureDirSync(resolveEmbeddingModelDir());
  }
  return next;
}

/**
 * 单文本 embedding。内部按当前配置选用 local / remote 策略。
 */
export async function embeddingText(text: string): Promise<number[]> {
  const config = ensureEmbeddingProviderReady();
  const strategy = getOrCreateStrategy(config);
  return strategy.embedText(text);
}

/**
 * 批量 embedding。
 */
export async function batchEmbeddingText(texts: string[]): Promise<number[][]> {
  const config = ensureEmbeddingProviderReady();
  const strategy = getOrCreateStrategy(config);
  return strategy.embedTextBatch(texts);
}
