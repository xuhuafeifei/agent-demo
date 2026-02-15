import fs from "node:fs";
import path from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import { ensureAgentDir, resolveGlobalConfigPath } from "../utils/agent-path";
import type {
  FgbgUserConfig,
  ModelConfigFile,
  ModelDefinitionConfig,
  ModelRef,
  ModelRegistry,
  ProviderConfig,
  RuntimeModel,
} from "../types";

const PROJECT_MODEL_CONFIG_PATH = path.join(
  __dirname,
  "..",
  "..",
  "config",
  "model.json",
);
const AGENT_MODELS_JSON_NAME = "models.json";

const MINIMAX_PROVIDER_ID = "minimax";
const MINIMAX_BASE_URL = "https://api.minimaxi.com/anthropic";
const MINIMAX_DEFAULT_MODEL = "MiniMax-M2.1";
const MOONSHOT_PROVIDER_ID = "moonshot";
const MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1";
const KIMI_CODE_PROVIDER_ID = "kimi-code";
const KIMI_CODE_BASE_URL = "https://api.kimi.com/coding/v1";
const QWEN_PORTAL_PROVIDER_ID = "qwen-portal";
const QWEN_PORTAL_BASE_URL = "https://portal.qwen.ai/v1";
const XIAOMI_PROVIDER_ID = "xiaomi";
const XIAOMI_BASE_URL = "https://api.xiaomimimo.com/anthropic";
const OLLAMA_PROVIDER_ID = "ollama";
const OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

let runtimeProviders: Record<string, ProviderConfig> = {};
let runtimeModelRegistry: ModelRegistry = {};

export function normalizeProviderId(provider: string): string {
  const normalized = provider.trim().toLowerCase();

  // 兼容常见别名，避免配置里写法不一致。
  if (normalized === "z.ai" || normalized === "z-ai") return "zai";
  if (normalized === "opencode-zen") return "opencode";
  if (normalized === "qwen") return "qwen-portal";

  return normalized;
}

export function parseModelRef(
  raw: string,
  defaultProvider: string = MINIMAX_PROVIDER_ID,
): ModelRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const slash = trimmed.indexOf("/");
  if (slash === -1) {
    // 未显式写 provider 时，回落到默认 provider。
    return {
      provider: normalizeProviderId(defaultProvider),
      model: trimmed,
    };
  }

  const provider = normalizeProviderId(trimmed.slice(0, slash).trim());
  const model = trimmed.slice(slash + 1).trim();
  if (!provider || !model) return null;

  return { provider, model };
}

function getModelUnsafe(provider: string, modelId: string): RuntimeModel {
  return (getModel as unknown as (p: string, m: string) => RuntimeModel)(
    provider,
    modelId,
  );
}

function buildMinimaxProvider(): ProviderConfig {
  return {
    baseUrl: MINIMAX_BASE_URL,
    api: "anthropic-messages",
    models: [
      {
        id: "MiniMax-M2.1",
        name: "MiniMax M2.1",
        reasoning: false,
        input: ["text"],
        cost: { input: 15, output: 60, cacheRead: 2, cacheWrite: 10 },
        contextWindow: 200000,
        maxTokens: 8192,
      },
    ],
  };
}

function buildMoonshotProvider(): ProviderConfig {
  return {
    baseUrl: MOONSHOT_BASE_URL,
    api: "openai-completions",
    models: [
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 256000,
        maxTokens: 8192,
      },
    ],
  };
}

function buildKimiCodeProvider(): ProviderConfig {
  return {
    baseUrl: KIMI_CODE_BASE_URL,
    api: "openai-completions",
    models: [
      {
        id: "kimi-for-coding",
        name: "Kimi For Coding",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 32768,
        headers: { "User-Agent": "KimiCLI/0.77" },
        compat: { supportsDeveloperRole: false },
      },
    ],
  };
}

function buildQwenPortalProvider(): ProviderConfig {
  return {
    baseUrl: QWEN_PORTAL_BASE_URL,
    api: "openai-completions",
    models: [
      {
        id: "coder-model",
        name: "Qwen Coder",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
      {
        id: "vision-model",
        name: "Qwen Vision",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ],
  };
}

function buildXiaomiProvider(): ProviderConfig {
  return {
    baseUrl: XIAOMI_BASE_URL,
    api: "anthropic-messages",
    models: [
      {
        id: "mimo-v2-flash",
        name: "Xiaomi MiMo V2 Flash",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 8192,
      },
    ],
  };
}

function buildOllamaProvider(): ProviderConfig {
  return {
    baseUrl: OLLAMA_BASE_URL,
    api: "openai-completions",
    models: [
      {
        id: "llama3",
        name: "Llama 3",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 2048,
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

type RawModelsConfig = {
  models?: {
    providers?: Record<string, ProviderConfig>;
  };
};

function normalizeRawModelConfig(raw: unknown): ModelConfigFile {
  if (!isRecord(raw)) return {};

  const normalized: ModelConfigFile = {};

  // 兼容扁平结构：{ model, apiKey }
  if (isRecord(raw.model)) {
    const provider =
      typeof raw.model.provider === "string"
        ? raw.model.provider.trim()
        : undefined;
    const model =
      typeof raw.model.model === "string" ? raw.model.model.trim() : undefined;
    const contextTokens =
      typeof raw.model.contextTokens === "number"
        ? raw.model.contextTokens
        : undefined;
    normalized.model = { provider, model, contextTokens };
  }

  if (isRecord(raw.apiKey)) {
    const apiKeyMap: Record<string, string> = {};
    for (const [provider, value] of Object.entries(raw.apiKey)) {
      if (typeof value === "string" && value.trim()) {
        apiKeyMap[normalizeProviderId(provider)] = value.trim();
      }
    }
    if (Object.keys(apiKeyMap).length > 0) {
      normalized.apiKey = apiKeyMap;
    }
  }

  // 兼容 OpenClaw 风格：models.providers.*.apiKey
  const providers =
    isRecord(raw.models) && isRecord(raw.models.providers)
      ? raw.models.providers
      : undefined;
  if (providers) {
    const apiKeyMap: Record<string, string> = { ...(normalized.apiKey ?? {}) };
    for (const [provider, providerEntry] of Object.entries(providers)) {
      if (!isRecord(providerEntry)) continue;
      const apiKey =
        typeof providerEntry.apiKey === "string"
          ? providerEntry.apiKey.trim()
          : "";
      if (apiKey) {
        apiKeyMap[normalizeProviderId(provider)] = apiKey;
      }
    }
    if (Object.keys(apiKeyMap).length > 0) {
      normalized.apiKey = apiKeyMap;
    }
  }

  // 兼容 OpenClaw 风格：agents.defaults.model.primary
  const defaults =
    isRecord(raw.agents) && isRecord(raw.agents.defaults)
      ? raw.agents.defaults
      : undefined;
  const primaryModelRaw = (() => {
    if (!defaults) return "";
    if (typeof defaults.model === "string") return defaults.model.trim();
    if (
      isRecord(defaults.model) &&
      typeof defaults.model.primary === "string"
    ) {
      return defaults.model.primary.trim();
    }
    return "";
  })();

  if (primaryModelRaw) {
    const parsed = parseModelRef(primaryModelRaw, MINIMAX_PROVIDER_ID);
    if (parsed) {
      const contextTokens =
        normalized.model?.contextTokens ??
        (() => {
          const providerCfgRaw =
            providers && isRecord(providers[parsed.provider])
              ? providers[parsed.provider]
              : undefined;
          if (!providerCfgRaw) return undefined;

          const providerCfg = providerCfgRaw as Record<string, unknown>;
          const modelList = Array.isArray(providerCfg.models)
            ? providerCfg.models
            : undefined;
          if (!modelList) return undefined;

          const modelCfg = modelList.find(
            (item: unknown) =>
              isRecord(item) &&
              typeof item.id === "string" &&
              item.id === parsed.model,
          ) as Record<string, unknown> | undefined;
          return modelCfg && typeof modelCfg.contextWindow === "number"
            ? modelCfg.contextWindow
            : undefined;
        })();

      normalized.model = {
        provider: parsed.provider,
        model: parsed.model,
        contextTokens,
      };
    }
  }

  return normalized;
}

function resolveModelConfigFile(): ModelConfigFile {
  try {
    const raw = fs.readFileSync(PROJECT_MODEL_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeRawModelConfig(parsed);
  } catch {
    return {};
  }
}

function mergeModelConfigs(params: {
  explicitConfig: ModelConfigFile;
  implicitConfig: ModelConfigFile;
}): ModelConfigFile {
  const { explicitConfig, implicitConfig } = params;

  // 规则：显式配置覆盖隐式配置。
  return {
    ...implicitConfig,
    ...explicitConfig,
    model: {
      ...(implicitConfig.model ?? {}),
      ...(explicitConfig.model ?? {}),
    },
    apiKey: {
      ...(implicitConfig.apiKey ?? {}),
      ...(explicitConfig.apiKey ?? {}),
    },
  };
}

function loadEffectiveModelConfig(): ModelConfigFile {
  const explicitConfig = normalizeRawModelConfig(
    getUserFgbgConfig() as unknown,
  );
  const implicitConfig = resolveModelConfigFile();
  return mergeModelConfigs({ explicitConfig, implicitConfig });
}

function resolveApiKeyForProvider(params: {
  provider: string;
  config?: ModelConfigFile;
}): string | undefined {
  const provider = normalizeProviderId(params.provider);
  const envVarName = `${provider.toUpperCase()}_API_KEY`;

  // 优先环境变量，适配部署环境和 CI 注入。
  const envApiKey = process.env[envVarName]?.trim();
  if (envApiKey) return envApiKey;

  // 再使用项目配置里的 apiKey 映射。
  const fileApiKey = params.config?.apiKey?.[provider]?.trim();
  if (fileApiKey) return fileApiKey;

  return undefined;
}

// 解析隐式 provider，如果配置文件中没有配置，则使用默认配置
function resolveImplicitProviders(
  config?: ModelConfigFile,
): Record<string, ProviderConfig> {
  const providers: Record<string, ProviderConfig> = {};
  const minimaxApiKey = resolveApiKeyForProvider({
    provider: MINIMAX_PROVIDER_ID,
    config,
  });
  if (minimaxApiKey) {
    providers[MINIMAX_PROVIDER_ID] = {
      ...buildMinimaxProvider(),
      apiKey: minimaxApiKey,
    };
  }

  const moonshotApiKey = resolveApiKeyForProvider({
    provider: MOONSHOT_PROVIDER_ID,
    config,
  });
  if (moonshotApiKey) {
    providers[MOONSHOT_PROVIDER_ID] = {
      ...buildMoonshotProvider(),
      apiKey: moonshotApiKey,
    };
  }

  const kimiCodeApiKey = resolveApiKeyForProvider({
    provider: KIMI_CODE_PROVIDER_ID,
    config,
  });
  if (kimiCodeApiKey) {
    providers[KIMI_CODE_PROVIDER_ID] = {
      ...buildKimiCodeProvider(),
      apiKey: kimiCodeApiKey,
    };
  }

  const qwenPortalApiKey = resolveApiKeyForProvider({
    provider: QWEN_PORTAL_PROVIDER_ID,
    config,
  });
  if (qwenPortalApiKey) {
    providers[QWEN_PORTAL_PROVIDER_ID] = {
      ...buildQwenPortalProvider(),
      apiKey: qwenPortalApiKey,
    };
  }

  const xiaomiApiKey = resolveApiKeyForProvider({
    provider: XIAOMI_PROVIDER_ID,
    config,
  });
  if (xiaomiApiKey) {
    providers[XIAOMI_PROVIDER_ID] = {
      ...buildXiaomiProvider(),
      apiKey: xiaomiApiKey,
    };
  }

  // Ollama 常驻本地，默认可用，不强制要求 api key。
  const ollamaApiKey = resolveApiKeyForProvider({
    provider: OLLAMA_PROVIDER_ID,
    config,
  });
  providers[OLLAMA_PROVIDER_ID] = {
    ...buildOllamaProvider(),
    ...(ollamaApiKey ? { apiKey: ollamaApiKey } : {}),
  };

  return providers;
}

/**
 * 合并隐式 providers（环境自动发现）与显式 providers（配置文件声明）。
 * 规则：
 * 1. 显式配置优先覆盖同名字段。
 * 2. models 按 id 去重合并，显式模型优先，隐式模型仅补齐缺失项。
 *
 * @param params - 参数
 * @param params.implicit - 隐式提供者配置
 * @param params.explicit - 显式提供者配置
 * @returns 合并后的提供者配置
 */
function mergeProviders(params: {
  implicit: Record<string, ProviderConfig>;
  explicit: Record<string, ProviderConfig>;
}): Record<string, ProviderConfig> {
  // 先复制一份隐式 provider，作为合并基底。
  const merged: Record<string, ProviderConfig> = { ...params.implicit };

  // 逐个应用显式 provider，保证显式配置具备更高优先级。
  for (const [rawProviderId, explicitProvider] of Object.entries(
    params.explicit,
  )) {
    const providerId = normalizeProviderId(rawProviderId);
    const implicitProvider = merged[providerId];

    // 没有隐式配置时直接采用显式配置。
    if (!implicitProvider) {
      merged[providerId] = explicitProvider;
      continue;
    }

    // 显式模型列表：优先级更高，先放入结果。
    const explicitModels = explicitProvider.models ?? [];
    // 隐式模型列表：仅用于补齐显式里没有的模型。
    const implicitModels = implicitProvider.models ?? [];
    const seen = new Set(explicitModels.map((item) => item.id));

    // 显式模型优先，隐式模型只补齐未定义的 id。
    const models: ModelDefinitionConfig[] = [
      ...explicitModels,
      ...implicitModels.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }),
    ];

    // provider 字段采用“显式覆盖隐式”，models 使用去重后的合并结果。
    merged[providerId] = {
      ...implicitProvider,
      ...explicitProvider,
      models,
    };
  }

  return merged;
}

/**
 * 规范化提供者配置
 * @param providers - 提供者配置
 * @returns 规范化后的提供者配置
 */
function normalizeProviders(
  providers: Record<string, ProviderConfig>,
): Record<string, ProviderConfig> {
  const normalized: Record<string, ProviderConfig> = {};

  for (const [providerId, providerConfig] of Object.entries(providers)) {
    const key = normalizeProviderId(providerId);

    // 统一 key 后再写入，避免重复 provider。
    normalized[key] = {
      ...providerConfig,
      apiKey: providerConfig.apiKey?.trim(),
    };
  }

  return normalized;
}

/**
 * 发现模型注册表
 * @param providers - 提供者配置
 * @returns 模型注册表和错误信息
 * @returns 模型注册表
 * @returns 错误信息
 */
function discoverModelRegistry(providers: Record<string, ProviderConfig>): {
  modelRegistry: ModelRegistry;
  error?: string;
} {
  const modelRegistry: ModelRegistry = {};
  const errors: string[] = [];

  for (const [providerId, providerConfig] of Object.entries(providers)) {
    for (const modelDefinition of providerConfig.models) {
      const modelKey = `${providerId}/${modelDefinition.id}`;

      try {
        // 优先从 pi-ai 的内置注册拿模型。
        const model = getModelUnsafe(providerId, modelDefinition.id);

        // 某些模型在当前 pi-ai 版本可能未内置，发现阶段直接跳过。
        if (!model) {
          continue;
        }

        // 对模型打上 provider 级配置覆盖。
        (model as { baseUrl?: string }).baseUrl = providerConfig.baseUrl;
        if (providerConfig.api) {
          (model as { api?: string }).api = providerConfig.api;
        }
        if (providerConfig.headers) {
          (model as { headers?: Record<string, string> }).headers =
            providerConfig.headers;
        }

        modelRegistry[modelKey] = model;
      } catch (error) {
        errors.push(`discover ${modelKey} failed: ${(error as Error).message}`);
      }
    }
  }

  return {
    modelRegistry,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}

/**
 * 确保模型 JSON 文件存在
 * @returns 目录和是否写入
 * @returns 目录
 * @returns 是否写入
 */
export async function ensureModelJson(): Promise<{
  agentDir: string;
  wrote: boolean;
}> {
  // 隐式 providers
  const implicitProviders = resolveImplicitProviders(resolveModelConfigFile());
  // 显式 providers 仅来自用户级 fgbg.json 的 models.providers。
  const explicitProviders = getUserFgbgConfig()?.models?.providers ?? {};
  const merged = normalizeProviders(
    mergeProviders({
      implicit: implicitProviders,
      explicit: explicitProviders,
    }),
  );
  const agentDir = ensureAgentDir();

  if (Object.keys(merged).length === 0) {
    return { agentDir, wrote: false };
  }

  const targetPath = path.join(agentDir, AGENT_MODELS_JSON_NAME);
  const nextContent = `${JSON.stringify({ providers: merged }, null, 2)}\n`;

  let currentContent = "";
  try {
    // 读取旧文件做幂等比较，避免无意义写盘。
    currentContent = fs.readFileSync(targetPath, "utf-8");
  } catch {
    currentContent = "";
  }

  if (currentContent === nextContent) {
    return { agentDir, wrote: false };
  }

  fs.writeFileSync(targetPath, nextContent, { mode: 0o600 });
  return { agentDir, wrote: true };
}

/**
 * 发现模型
 * @param config - 配置
 * @returns 提供者配置和模型注册表
 * @returns 提供者配置
 * @returns 模型注册表
 * @returns 错误信息
 */
export async function discoveryModel(config: FgbgUserConfig): Promise<{
  providers: Record<string, ProviderConfig>;
  modelRegistry: ModelRegistry;
  error?: string;
}> {
  // 显示供应商配置来自 fgbg.json
  const explicitProviders = config?.models?.providers ?? {};
  // 隐式供应商配置来自 model.json
  const implicitProviders = resolveImplicitProviders(resolveModelConfigFile());

  // 先规范化 provider，再执行模型发现。
  runtimeProviders = normalizeProviders(
    mergeProviders({
      implicit: implicitProviders,
      explicit: explicitProviders,
    }),
  );
  const discovered = discoverModelRegistry(runtimeProviders);
  runtimeModelRegistry = discovered.modelRegistry;

  return {
    providers: runtimeProviders,
    modelRegistry: runtimeModelRegistry,
    error: discovered.error,
  };
}

export function getRuntimeProviders(): Record<string, ProviderConfig> {
  return runtimeProviders;
}

export function getRuntimeModelRegistry(): ModelRegistry {
  return runtimeModelRegistry;
}

export function getDefaultModelRef(config?: ModelConfigFile): ModelRef {
  const loaded = config ?? loadEffectiveModelConfig();
  const provider = normalizeProviderId(
    loaded.model?.provider ?? MINIMAX_PROVIDER_ID,
  );
  const model = loaded.model?.model?.trim() || MINIMAX_DEFAULT_MODEL;

  return { provider, model };
}

export function getResolvedApiKey(params: {
  provider: string;
  config?: ModelConfigFile;
}): string | undefined {
  return resolveApiKeyForProvider(params);
}

export function getEffectiveModelConfig(): ModelConfigFile {
  return loadEffectiveModelConfig();
}

export function getGlobalModelConfigPath(): string {
  return resolveGlobalConfigPath();
}

/**
 * 读取用户级 fgbg.json，并返回原始配置对象。
 * 该方法不做裁剪和合并，适合给外部直接查看用户配置内容。
 */
export function getUserFgbgConfig(): FgbgUserConfig {
  const filePath = resolveGlobalConfigPath();
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    return isRecord(raw) ? (raw as FgbgUserConfig) : {};
  } catch {
    return {};
  }
}