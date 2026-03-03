import fs from "node:fs";
import path from "node:path";
import { getModel } from "@mariozechner/pi-ai";
import { fileURLToPath } from "node:url";
import {
  getUserFgbgConfig,
  resolveGlobalConfigPath,
} from "../../utils/app-path.js";
import { ensureAgentDir } from "../utils/agent-path.js";
import type {
  FgbgUserConfig,
  ModelConfigFile,
  ModelDefinitionConfig,
  ModelRef,
  ModelRegistry,
  ProviderConfig,
  RuntimeModel,
} from "../types.js";

function getModelUnsafe(provider: string, modelId: string): RuntimeModel {
  return (getModel as unknown as (p: string, m: string) => RuntimeModel)(
    provider,
    modelId,
  );
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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


/** config/model.json：仅支持扁平结构 { model: { provider, model, contextTokens }, apiKey: { ... } } */
function normalizeProjectModelConfig(raw: unknown): ModelConfigFile {
  if (!isRecord(raw)) return {};

  const out: ModelConfigFile = {};

  if (isRecord(raw.model)) {
    out.model = {
      provider:
        typeof raw.model.provider === "string"
          ? raw.model.provider.trim()
          : undefined,
      model:
        typeof raw.model.model === "string" ? raw.model.model.trim() : undefined,
      contextTokens:
        typeof raw.model.contextTokens === "number"
          ? raw.model.contextTokens
          : undefined,
    };
  }

  if (isRecord(raw.apiKey)) {
    const apiKey: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.apiKey)) {
      if (typeof v === "string" && v.trim()) apiKey[normalizeProviderId(k)] = v.trim();
    }
    if (Object.keys(apiKey).length > 0) out.apiKey = apiKey;
  }

  return out;
}

/** ~/.fgbg/fgbg.json：只取 agents.defaults.model（默认模型）和 models.providers 里的 apiKey */
function normalizeFgbgToModelConfig(raw: unknown): ModelConfigFile {
  if (!isRecord(raw)) return {};

  const out: ModelConfigFile = {};

  const defaults = isRecord(raw.agents) && isRecord(raw.agents.defaults) ? raw.agents.defaults : null;
  const primaryRaw = defaults
    ? typeof defaults.model === "string"
      ? (defaults.model as string).trim()
      : isRecord(defaults.model) && typeof (defaults.model as { primary?: string }).primary === "string"
        ? (defaults.model as { primary: string }).primary.trim()
        : ""
    : "";
  if (primaryRaw) {
    const parsed = parseModelRef(primaryRaw, MINIMAX_PROVIDER_ID);
    if (parsed) out.model = { provider: parsed.provider, model: parsed.model };
  }

  const providers = isRecord(raw.models) && isRecord(raw.models.providers) ? raw.models.providers : null;
  if (providers && isRecord(providers)) {
    const apiKey: Record<string, string> = {};
    for (const [p, entry] of Object.entries(providers)) {
      if (isRecord(entry) && typeof entry.apiKey === "string" && entry.apiKey.trim()) {
        apiKey[normalizeProviderId(p)] = (entry.apiKey as string).trim();
      }
    }
    if (Object.keys(apiKey).length > 0) out.apiKey = apiKey;
  }

  return out;
}

/**
 * 解析model.json数据，并转换为ModelConfigFile类型
 * @returns 
 */
function resolveModelConfigFile(): ModelConfigFile {
  try {
    const raw = fs.readFileSync(PROJECT_MODEL_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeProjectModelConfig(parsed);
  } catch {
    return {};
  }
}

/**
 * 合并配置文件 fgbg.json(显示配置) / model.json(隐式配置) 有关模型的配置
 * @param params 
 * @returns 
 */
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
  const explicitConfig = normalizeFgbgToModelConfig(
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
    const seen = new Set(explicitModels.map((item: ModelDefinitionConfig) => item.id));

    // 显式模型优先，隐式模型只补齐未定义的 id。
    const models: ModelDefinitionConfig[] = [
      ...explicitModels,
      ...implicitModels.filter((item: ModelDefinitionConfig) => {
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
function discoverModelRegistry(providers: Record<string, ProviderConfig>): ModelRegistry {
  const modelRegistry: ModelRegistry = {};

  for (const [providerId, providerConfig] of Object.entries(providers)) {
    for (const modelDefinition of providerConfig.models) {
      const modelKey = `${providerId}/${modelDefinition.id}`;

      try {
        const model = getModelUnsafe(providerId, modelDefinition.id);
        if (!model) {
          continue;
        }
        (model as { baseUrl?: string }).baseUrl = providerConfig.baseUrl;
        if (providerConfig.api) {
          (model as { api?: string }).api = providerConfig.api;
        }
        if (providerConfig.headers) {
          (model as { headers?: Record<string, string> }).headers =
            providerConfig.headers;
        }
        modelRegistry[modelKey] = model;
      } catch (err) {
        // pi-ai 未内置时用配置拼 fallback，保证 registry 完整，resolveModel 只做查表。
        console.warn(
          `[discovery] 模型 ${modelKey} 未在 pi-ai 内置，已用配置 fallback 注册:`,
          (err as Error).message,
        );
        const fallback: RuntimeModel = {
          id: modelDefinition.id,
          name: modelDefinition.name,
          provider: providerId,
          api: (providerConfig.api ?? modelDefinition.api ?? "openai-completions") as RuntimeModel["api"],
          baseUrl: providerConfig.baseUrl,
          reasoning: modelDefinition.reasoning,
          input: modelDefinition.input,
          cost: modelDefinition.cost,
          contextWindow: modelDefinition.contextWindow,
          maxTokens: modelDefinition.maxTokens,
          headers: providerConfig.headers,
          compat: modelDefinition.compat,
        } as RuntimeModel;
        modelRegistry[modelKey] = fallback;
      }
    }
  }

  return modelRegistry;
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
  defaultModelRef: ModelRef;
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
  runtimeModelRegistry = discoverModelRegistry(runtimeProviders);

  const defaultModelRef = getDefaultModelRef(loadEffectiveModelConfig());

  return {
    providers: runtimeProviders,
    modelRegistry: runtimeModelRegistry,
    defaultModelRef,
  };
}

/** 返回当前 provider 配置的快照（浅拷贝），避免调用方篡改内部状态。 */
export function getRuntimeProviders(): Record<string, ProviderConfig> {
  return { ...runtimeProviders };
}

/** 返回当前模型注册表的快照（浅拷贝），避免调用方篡改内部状态。 */
export function getRuntimeModelRegistry(): ModelRegistry {
  return { ...runtimeModelRegistry };
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

export function getGlobalModelConfigPath(): string {
  return resolveGlobalConfigPath();
}

/** 从 app-path 统一导出，便于调用方从 model-config 获取用户配置。 */
export { getUserFgbgConfig } from "../../utils/app-path.js";
