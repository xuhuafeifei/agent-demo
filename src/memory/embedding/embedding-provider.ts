import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { pipeline } from "node:stream/promises";
import {
  ensureDirSync,
  expandHome,
  resolveEmbeddingModelDir,
} from "../utils/path.js";
import { sha256 } from "../utils/hash.js";
import type { FgbgUserConfig } from "../../types.js";
import { readFgbgUserConfig, writeFgbgUserConfig } from "../../config/index.js";
import { getMemoryIndexManager } from "../index.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import {
  batchUpsertEmbeddingCache,
  batchQueryEmbeddingCache,
} from "../store.js";

const memoryLogger = getSubsystemConsoleLogger("memory");

// 类型声明
type MemorySearchConfig = FgbgUserConfig["agents"]["memorySearch"];

type EmbeddingContextLike = {
  getEmbeddingFor: (text: string) => Promise<{ vector: readonly number[] }>;
};

/** 多数 GGUF embedding 模型（如 nomic）max 512 tokens，按字符保守截断避免 "Input is longer than the context size"。 */
const EMBEDDING_MAX_INPUT_CHARS = 500;

function truncateForEmbedding(text: string): string {
  if (text.length <= EMBEDDING_MAX_INPUT_CHARS) return text;
  return text.slice(0, EMBEDDING_MAX_INPUT_CHARS);
}

/**
 * Embedding 策略：按 mode（local / remote）可插拔的实现。
 * 策略内部自行管理上下文与缓存，对外只暴露 embed 能力。
 */
export type EmbeddingStrategy = {
  embedText: (text: string) => Promise<number[]>;
  embedTextBatch: (texts: string[]) => Promise<number[][]>;
};

type StrategyMode = NonNullable<MemorySearchConfig["mode"]>;

// 模型下载配置
const MODEL_DOWNLOAD_CONFIG = {
  "nomic-embed-text-v1.5.Q4_K_M": {
    url: "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf",
    filename: "nomic-embed-text-v1.5.Q4_K_M.gguf",
  },
};

/**
 * 检查是否正在修复
 */
export function isModelDownloading(): boolean {
  return getMemoryIndexManager().isRepairing();
}

/**
 * 下载文件函数（支持重定向，使用 stream.pipeline 优化，添加重定向深度限制）
 * @param url 下载地址
 * @param destPath 目标路径
 * @param config 下载配置
 * @param redirectDepth 当前重定向深度（内部使用）
 * @returns Promise<boolean> 下载是否成功
 */
async function downloadFile(
  url: string,
  destPath: string,
  config?: FgbgUserConfig["agents"]["memorySearch"]["download"],
  redirectDepth: number = 0,
): Promise<boolean> {
  const MAX_REDIRECT_DEPTH = 3;

  if (redirectDepth > MAX_REDIRECT_DEPTH) {
    throw new Error(`重定向次数过多（超过 ${MAX_REDIRECT_DEPTH} 次）`);
  }

  const timeout = config?.timeout || 5 * 60 * 1000;
  const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 5,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`下载超时 (${timeout}ms)`));
    }, timeout);

    const req = https.get(
      url,
      {
        agent,
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      },
      async (res) => {
        clearTimeout(timer);
        memoryLogger.info("download file statusCode: %s", res.statusCode);

        if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
          const redirectUrl = res.headers.location;
          if (!redirectUrl) {
            reject(new Error("重定向但没有 location header"));
            return;
          }

          memoryLogger.info(
            "redirect to %s (depth: %d)",
            redirectUrl,
            redirectDepth + 1,
          );
          try {
            const result = await downloadFile(
              redirectUrl,
              destPath,
              config,
              redirectDepth + 1,
            );
            resolve(result);
          } catch (error) {
            reject(error);
          }
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`下载失败: HTTP ${res.statusCode}`));
          return;
        }

        const totalSize = parseInt(res.headers["content-length"] || "0", 10);
        let downloadedSize = 0;

        // 监听数据传输进度
        res.on("data", (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize > 0) {
            const progress = Math.round((downloadedSize / totalSize) * 100);
            process.stdout.write(
              `下载进度: ${progress}% (${formatBytes(downloadedSize)} / ${formatBytes(totalSize)})\r`,
            );
          } else {
            process.stdout.write(`已下载: ${formatBytes(downloadedSize)}\r`);
          }
        });

        try {
          const writeStream = fs.createWriteStream(destPath);
          await pipeline(res, writeStream);
          process.stdout.write("\n");
          memoryLogger.info(`文件下载完成: ${destPath}`);
          resolve(true);
        } catch (error) {
          if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
          }
          reject(error);
        }
      },
    );

    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.on("timeout", () => {
      req.destroy();
      clearTimeout(timer);
      reject(new Error(`下载超时 (${timeout}ms)`));
    });

    req.setTimeout(timeout);
  });
}

/**
 * 下载模型文件
 * @param modelName 模型名称
 * @param destPath 目标路径
 * @param config 下载配置
 * @returns Promise<boolean> 下载是否成功
 */
async function downloadModel(
  modelName: string,
  destPath: string,
  config?: FgbgUserConfig["agents"]["memorySearch"]["download"],
): Promise<boolean> {
  // 使用用户配置的下载地址，或者默认地址
  const downloadUrl =
    config?.url ||
    MODEL_DOWNLOAD_CONFIG[modelName as keyof typeof MODEL_DOWNLOAD_CONFIG]?.url;

  if (!downloadUrl) {
    memoryLogger.error(`不支持自动下载模型: ${modelName}`);
    return false;
  }

  const maxRetries = 5; // 固定重试次数
  const retryDelay = 2000; // 固定重试延迟（ms）

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      memoryLogger.info(
        `开始下载模型 (尝试 ${attempt}/${maxRetries}): ${modelName} (${downloadUrl})`,
      );

      await downloadFile(downloadUrl, destPath, config);
      return true; // 下载成功
    } catch (error) {
      memoryLogger.warn(`下载尝试 ${attempt} 失败: ${error}`);

      // 清理不完整的文件
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }

      // 如果不是最后一次尝试，等待后重试
      if (attempt < maxRetries) {
        memoryLogger.info(`等待 ${retryDelay}ms 后重试...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      } else {
        // 所有尝试都失败
        memoryLogger.error(`所有 ${maxRetries} 次下载尝试都失败: ${error}`);
        return false;
      }
    }
  }

  return false; // 不应该到达这里，但作为安全措施
}

/**
 * PrepareStrategy 接口 - 定义连接检查和自动修复策略（函数式风格）
 * - connect(): 检查服务是否可连接
 * - repair(): 自动修复服务不可连接的情况
 */
export type PrepareStrategy = {
  connect: () => Promise<boolean>;
  repair: () => Promise<boolean>;
};

/**
 * 创建本地模式准备策略（函数式实现）
 * - connect(): 检查模型文件是否存在
 * - repair(): 下载模型文件（如果配置允许）
 */
export function createLocalPrepareStrategy(
  config: MemorySearchConfig,
): PrepareStrategy {
  return {
    async connect(): Promise<boolean> {
      try {
        const modelPath = await resolveConfiguredModelPath(config);
        if (fs.existsSync(modelPath)) {
          memoryLogger.debug(`本地模型文件存在: ${modelPath}`);
          return true;
        }
        return false;
      } catch (error) {
        memoryLogger.debug(`本地模型文件不存在: ${error}`);
        return false;
      }
    },
    async repair(): Promise<boolean> {
      if (config.download?.enabled === false) {
        memoryLogger.error(`本地模型文件不存在，且自动下载已禁用`);
        return false;
      }

      try {
        const defaultModelName = "nomic-embed-text-v1.5.Q4_K_M";
        const embeddingDir = resolveEmbeddingModelDir();
        const destPath = path.join(embeddingDir, defaultModelName + ".gguf");

        const downloadSuccess = await downloadModel(
          defaultModelName,
          destPath,
          config.download,
        );

        if (downloadSuccess) {
          memoryLogger.info(`本地模型下载成功: ${destPath}`);
          return true;
        } else {
          memoryLogger.error(`本地模型下载失败`);
          return false;
        }
      } catch (error) {
        memoryLogger.error(`修复本地模型时出错: ${error}`);
        return false;
      }
    },
  };
}

/**
 * 创建远程模式准备策略（函数式实现）
 * - connect(): 检查端点是否可连接
 * - repair(): 自动降级到本地模式
 */
export function createRemotePrepareStrategy(
  config: MemorySearchConfig,
): PrepareStrategy {
  return {
    async connect(): Promise<boolean> {
      if (!config.endpoint) {
        memoryLogger.error(`远程模式需要配置 endpoint`);
        return false;
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          config.download?.timeout || 10000,
        );

        const response = await fetch(config.endpoint, {
          method: "HEAD",
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          memoryLogger.debug(`远程 endpoint 连接成功: ${config.endpoint}`);
          return true;
        } else {
          memoryLogger.debug(`远程 endpoint 连接失败: HTTP ${response.status}`);
          return false;
        }
      } catch (error) {
        memoryLogger.debug(`远程 endpoint 连接失败: ${error}`);
        return false;
      }
    },
    async repair(): Promise<boolean> {
      memoryLogger.warn(`远程 endpoint 不可用，尝试降级到本地模式`);

      try {
        const userConfig = readFgbgUserConfig();
        userConfig.agents.memorySearch.mode = "local";
        userConfig.agents.memorySearch.model = "nomic-embed-text-v1.5.Q4_K_M";
        writeFgbgUserConfig(userConfig);

        memoryLogger.info(`已成功降级到本地模式`);

        const localStrategy = createLocalPrepareStrategy(
          userConfig.agents.memorySearch,
        );
        return (
          (await localStrategy.connect()) || (await localStrategy.repair())
        );
      } catch (error) {
        memoryLogger.error(`自动降级到本地模式失败: ${error}`);
        return false;
      }
    },
  };
}

/**
 * 根据配置创建相应的 PrepareStrategy（函数式工厂）
 * @param config 记忆搜索配置
 * @returns 对应的 PrepareStrategy
 */
export function createPrepareStrategy(
  config: MemorySearchConfig,
): PrepareStrategy {
  if (config.mode === "local") {
    return createLocalPrepareStrategy(config);
  } else if (config.mode === "remote") {
    return createRemotePrepareStrategy(config);
  } else {
    memoryLogger.warn(`不支持的模式: ${config.mode}，默认使用本地模式`);
    return createLocalPrepareStrategy({
      ...config,
      mode: "local",
      model: "nomic-embed-text-v1.5.Q4_K_M",
    });
  }
}

/**
 * 格式化字节数为人类可读格式
 * @param bytes 字节数
 * @returns 格式化后的字符串
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * 解析 local 模式下的 GGUF 模型路径。
 *
 * 支持：
 * - memorySearch.model 为绝对路径
 * - memorySearch.model 为文件名（在 embedding 目录查找）
 * - embedding 目录第一个 .gguf 作为回退
 */
async function resolveConfiguredModelPath(
  memorySearch: MemorySearchConfig,
): Promise<string> {
  const embeddingDir = resolveEmbeddingModelDir();
  ensureDirSync(embeddingDir);

  const maybePath = expandHome(memorySearch.model.trim());
  const normalizeModelName = (value: string): string =>
    value
      .toLowerCase()
      .replace(/\.gguf$/i, "")
      .replace(/[^a-z0-9]+/g, "");

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

  const all = fs.readdirSync(embeddingDir, { withFileTypes: true });
  const gguf = all
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".gguf"),
    )
    .map((entry) => path.join(embeddingDir, entry.name));

  // 支持“模型名”匹配：先匹配标准化后完全一致，再做包含匹配。
  const requestedName = normalizeModelName(path.basename(maybePath));
  if (requestedName) {
    const exact = gguf.find(
      (candidate) =>
        normalizeModelName(path.basename(candidate)) === requestedName,
    );
    if (exact) return exact;

    const fuzzy = gguf.find((candidate) =>
      normalizeModelName(path.basename(candidate)).includes(requestedName),
    );
    if (fuzzy) return fuzzy;
  }

  // 回退：取 embedding 目录下第一个 .gguf 文件
  if (gguf.length > 0) return gguf[0];

  // 模型不存在，尝试自动下载模型
  throw new Error(
    `embedding model not found in ${embeddingDir}. Put a .gguf model there (e.g. nomic-embed-text-v1.5.Q4_K_M.gguf).`,
  );
}

/** 创建 node-llama-cpp embedding 上下文（加载 GGUF 模型）。 */
async function createLocalContext(
  memorySearch: MemorySearchConfig,
): Promise<EmbeddingContextLike> {
  const modelPath = await resolveConfiguredModelPath(memorySearch);

  let getLlamaFn:
    | undefined
    | (() => Promise<{
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
      // todo. 这里的arm64, macOs写死了，后续需要优化，支持其他平台
      `node-llama-cpp is unavailable (${message}). Install it with native arm64 Node on macOS.`,
    );
  }

  if (!getLlamaFn) {
    throw new Error("node-llama-cpp getLlama() not found");
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
      const result = await context.getEmbeddingFor(truncateForEmbedding(text));
      return Array.from(result.vector); // 转为可变数组返回
    },
    async embedTextBatch(texts: string[]): Promise<number[][]> {
      const context = await getContext();
      const results = await Promise.all(
        texts.map((text) =>
          context.getEmbeddingFor(truncateForEmbedding(text)),
        ),
      );
      return results.map((r) => Array.from(r.vector)); // 每条转为一维向量
    },
  };
}

// ---------------------------------------------------------------------------
// Remote 策略：占位，后续接 HTTP API
// ---------------------------------------------------------------------------

/** Remote 策略占位：后续可接 endpoint + apiKey 的 HTTP 调用。 */
function createRemoteStrategy(
  _memorySearch: MemorySearchConfig,
): EmbeddingStrategy {
  const message =
    "remote embedding mode is not implemented yet. Use mode: 'local' or implement remote strategy.";
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
  const memorySearch = config.agents.memorySearch;
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
  const config = readFgbgUserConfig();

  // 仅 local 模式需要本地 GGUF 模型目录，确保目录存在
  if (config.agents.memorySearch.mode === "local") {
    ensureDirSync(resolveEmbeddingModelDir());
  }
  return config;
}

/**
 * 单文本 embedding。内部按当前配置选用 local / remote 策略。
 */
export async function embeddingText(text: string): Promise<number[]> {
  // 复用 batch 方法，享受并发和缓存能力
  const results = await batchEmbeddingText([text]);
  return results[0];
}

/**
 * 批量 embedding。
 */
export async function batchEmbeddingText(texts: string[]): Promise<number[][]> {
  // 计算所有文本的 hash
  const hashes = texts.map((text) => sha256(text));

  // 批量查询缓存
  const cacheMap = await batchQueryEmbeddingCache(hashes);

  // 分离命中和未命中的文本
  const results: number[][] = new Array(texts.length);
  const missingIndices: number[] = [];

  for (let i = 0; i < texts.length; i++) {
    const cached = cacheMap.get(hashes[i]);
    if (cached) {
      results[i] = cached;
    } else {
      missingIndices.push(i);
    }
  }

  if (missingIndices.length > 0) {
    memoryLogger.info(
      `[cache-hits] hit ratio=${cacheMap.size}/${texts.length}, hits=${cacheMap.size}, missing=${missingIndices.length}`,
    );

    // 计算未命中的 embedding（并发执行）
    const missingTexts = missingIndices.map((i) => texts[i]);
    const config = ensureEmbeddingProviderReady();
    const strategy = getOrCreateStrategy(config);
    const missingEmbeddings = await strategy.embedTextBatch(missingTexts);

    // 填充结果并准备缓存写入
    const cacheItems = missingIndices.map((i, idx) => ({
      textHash: hashes[i],
      embedding: missingEmbeddings[idx],
    }));

    // 填充完整结果
    for (let idx = 0; idx < missingIndices.length; idx++) {
      results[missingIndices[idx]] = missingEmbeddings[idx];
    }

    // 批量写入缓存
    await batchUpsertEmbeddingCache(cacheItems);
  } else {
    memoryLogger.debug(
      ` embedding cache: ${cacheMap.size}/${texts.length} hits`,
    );
  }

  return results;
}
