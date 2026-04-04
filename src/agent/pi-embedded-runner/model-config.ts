import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGlobalConfigPath } from "../../utils/app-path.js";
import {
  getQwenPortalCredentials,
  isQwenPortalCredentialsExpired,
} from "../auth/oauth-path.js";
import type {
  FgbgUserConfig,
  ModelConfigFile,
  ModelDefinitionConfig,
  ModelRef,
  ModelRegistry,
  ProviderConfig,
  RuntimeModel,
} from "../../types.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import {
  QWEN_DASHSCOPE_COMPAT_V1_BASE,
  normalizeQwenOAuthResourceBaseUrl,
} from "../qwen-dashscope.js";

const logger = getSubsystemConsoleLogger("model-config");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_MODEL_CONFIG_PATH = path.join(
  __dirname,
  "..",
  "..",
  "config",
  "model.json",
);

export function normalizeProviderId(provider: string): string {
  return provider.trim().toLowerCase();
}

export function parseModelRef(raw: string): ModelRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) return null;

  return {
    provider: normalizeProviderId(trimmed.slice(0, slash)),
    model: trimmed.slice(slash + 1).trim(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeModelConfigFile(raw: unknown): ModelConfigFile {
  if (!isRecord(raw)) return {};
  const out: ModelConfigFile = {};

  if (isRecord(raw.model)) {
    out.model = {
      provider:
        typeof raw.model.provider === "string"
          ? raw.model.provider.trim()
          : undefined,
      model:
        typeof raw.model.model === "string"
          ? raw.model.model.trim()
          : undefined,
      contextTokens:
        typeof raw.model.contextTokens === "number"
          ? raw.model.contextTokens
          : undefined,
    };
  }

  if (isRecord(raw.apiKey)) {
    const apiKey: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.apiKey)) {
      if (typeof v !== "string") continue;
      const trimmed = v.trim();
      if (!trimmed) continue;
      apiKey[normalizeProviderId(k)] = trimmed;
    }
    if (Object.keys(apiKey).length > 0) {
      out.apiKey = apiKey;
    }
  }

  return out;
}

function readProjectModelConfig(): ModelConfigFile {
  try {
    const raw = JSON.parse(fs.readFileSync(PROJECT_MODEL_CONFIG_PATH, "utf-8"));
    return normalizeModelConfigFile(raw);
  } catch {
    return {};
  }
}

function providerEnvApiKeyName(providerId: string): string {
  return `${normalizeProviderId(providerId).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

/**
 * 当前 qwen-portal 的 apiKey 是否来自 OAuth 档案（而非 env / model.json 明文 key）。
 * 与 providers-router test-connection 的 OAuth 判定对齐（配置中 auth === "oauth" 时忽略明文 apiKey）。
 */
function qwenPortalKeyFromOAuthProfile(
  apiKey: string | undefined,
  projectApiKey: string | undefined,
): boolean {
  if (!apiKey?.trim()) return false;
  const envKey = process.env[providerEnvApiKeyName("qwen-portal")]?.trim();
  if (envKey && apiKey === envKey) return false;
  const proj = projectApiKey?.trim();
  if (proj && apiKey === proj) return false;
  const creds = getQwenPortalCredentials();
  return Boolean(creds && apiKey === creds.access);
}

/**
 * 让 pi-ai / openai-completions 路径与 /config/test-connection 使用相同的 DashScope 头与 OAuth baseUrl。
 */
function applyQwenPortalDashScopeExtras(
  merged: Record<string, ProviderConfig>,
  projectConfig: ModelConfigFile,
): void {
  const p = merged["qwen-portal"];
  if (!p?.apiKey?.trim()) return;

  const oauthToken = qwenPortalKeyFromOAuthProfile(
    p.apiKey,
    projectConfig.apiKey?.["qwen-portal"],
  );
  const creds = getQwenPortalCredentials();
  if (oauthToken) {
    p.baseUrl = normalizeQwenOAuthResourceBaseUrl(creds?.resourceUrl);
  }

  const ua = "QwenCode/0.13.2 (darwin; arm64)";
  const dashHeaders: Record<string, string> = {
    "User-Agent": ua,
    "X-DashScope-CacheControl": "enable",
    "X-DashScope-UserAgent": ua,
    "X-DashScope-AuthType": oauthToken ? "qwen-oauth" : "openai",
  };
  p.headers = { ...dashHeaders, ...(p.headers ?? {}) };
}

function resolveApiKeyForProvider(params: {
  providerId: string;
  explicitApiKey?: string;
  projectApiKey?: string;
}): string | undefined {
  const providerId = normalizeProviderId(params.providerId);

  if (params.explicitApiKey?.trim()) {
    return params.explicitApiKey.trim();
  }

  const envKeyName = `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
  const envKey = process.env[envKeyName]?.trim();
  if (envKey) return envKey;

  const projectKey = params.projectApiKey?.trim();
  if (projectKey) return projectKey;

  return undefined;
}

async function resolveApiKeyForProviderAsync(params: {
  providerId: string;
  explicitApiKey?: string;
  projectApiKey?: string;
}): Promise<string | undefined> {
  const providerId = normalizeProviderId(params.providerId);

  // 先尝试同步获取
  const syncResult = resolveApiKeyForProvider(params);
  if (syncResult) {
    return syncResult;
  }

  // 对于 qwen-portal，如果同步获取失败（可能过期），尝试异步刷新
  if (providerId === "qwen-portal") {
    try {
      const { refreshQwenPortalCredentials } =
        await import("../auth/qwen-portal-oauth.js");
      const credentials = getQwenPortalCredentials();
      if (!credentials) {
        logger.debug("No Qwen Portal credentials found");
        return undefined;
      }
      if (isQwenPortalCredentialsExpired(credentials)) {
        logger.debug("Qwen Portal credentials expired, refreshing...");
        const newCredentials = await refreshQwenPortalCredentials(credentials);
        if (newCredentials) {
          logger.debug("Qwen Portal credentials refreshed");
          return newCredentials.access;
        }
      } else {
        return credentials.access;
      }
    } catch {
      // 刷新失败，返回 undefined
    }
  }

  return undefined;
}

export function buildImplicitProviderTemplates(): Record<
  string,
  ProviderConfig
> {
  return {
    "qwen-portal": {
      baseUrl: QWEN_DASHSCOPE_COMPAT_V1_BASE,
      api: "openai-completions",
      models: [
        {
          id: "coder-model",
          name: "Qwen Coder",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 64 * 1024,
          tokenRatio: 0.75,
          // DashScope 兼容接口常拒绝 OpenAI 新版字段（store / stream_options / max_completion_tokens），会导致 400 且无 body。
          compat: {
            supportsStore: false,
            supportsUsageInStreaming: false,
            maxTokensField: "max_tokens",
            supportsStrictMode: false,
          },
        },
      ],
    },
    deepseek: {
      baseUrl: "https://api.deepseek.com",
      api: "openai-completions",
      models: [
        {
          id: "deepseek-chat",
          name: "DeepSeek Chat",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 65536,
          maxTokens: 64 * 1024,
          tokenRatio: 0.75,
        },
      ],
    },
    minimax: {
      baseUrl: "https://api.minimaxi.com/anthropic",
      api: "anthropic-messages",
      models: [
        {
          id: "MiniMax-M2.1",
          name: "MiniMax M2.1",
          reasoning: false,
          input: ["text"],
          cost: { input: 15, output: 60, cacheRead: 2, cacheWrite: 10 },
          contextWindow: 200000,
          maxTokens: 64 * 1024,
          tokenRatio: 0.75,
        },
      ],
    },
    moonshot: {
      baseUrl: "https://api.moonshot.ai/v1",
      api: "openai-completions",
      models: [
        {
          id: "kimi-k2.5",
          name: "Kimi K2.5",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 256000,
          maxTokens: 64 * 1024,
          tokenRatio: 0.75,
        },
      ],
    },
    "kimi-code": {
      baseUrl: "https://api.kimi.com/coding/v1",
      api: "openai-completions",
      models: [
        {
          id: "kimi-for-coding",
          name: "Kimi For Coding",
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 262144,
          maxTokens: 64 * 1024,
          headers: { "User-Agent": "KimiCLI/0.77" },
          compat: { supportsDeveloperRole: false },
          tokenRatio: 0.75,
        },
      ],
    },
    xiaomi: {
      baseUrl: "https://api.xiaomimimo.com/anthropic",
      api: "anthropic-messages",
      models: [
        {
          id: "mimo-v2-flash",
          name: "Xiaomi MiMo V2 Flash",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 262144,
          maxTokens: 64 * 1024,
          tokenRatio: 0.75,
        },
      ],
    },
    ollama: {
      baseUrl: "http://127.0.0.1:11434/v1",
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
          tokenRatio: 0.75,
        },
      ],
    },
  };
}

function cloneModelDefinition(
  def: ModelDefinitionConfig,
): ModelDefinitionConfig {
  return {
    ...def,
    input: [...def.input],
    cost: { ...def.cost },
    headers: def.headers ? { ...def.headers } : undefined,
    compat: def.compat ? { ...def.compat } : undefined,
  };
}

function mergeModels(
  implicitModels: ModelDefinitionConfig[],
  explicitModels: ModelDefinitionConfig[],
): ModelDefinitionConfig[] {
  const byId = new Map<string, ModelDefinitionConfig>();

  for (const model of implicitModels) {
    byId.set(model.id, cloneModelDefinition(model));
  }
  for (const model of explicitModels) {
    byId.set(model.id, cloneModelDefinition(model));
  }

  return Array.from(byId.values());
}

async function buildImplicitProviders(
  projectConfig: ModelConfigFile,
): Promise<Record<string, ProviderConfig>> {
  const templates = buildImplicitProviderTemplates();
  const providers: Record<string, ProviderConfig> = {};

  for (const [providerId, template] of Object.entries(templates)) {
    const apiKey = await resolveApiKeyForProviderAsync({
      providerId,
      projectApiKey: projectConfig.apiKey?.[providerId],
    });

    const configOverride = projectConfig.providers?.[providerId] ?? {};

    providers[providerId] = {
      ...template,
      ...configOverride,
      models: template.models.map((model) => cloneModelDefinition(model)),
      ...(apiKey ? { apiKey } : {}),
    };
  }

  return providers;
}

function normalizeExplicitProviders(
  providers: Record<string, ProviderConfig>,
): Record<string, ProviderConfig> {
  const out: Record<string, ProviderConfig> = {};
  for (const [rawProviderId, provider] of Object.entries(providers)) {
    const providerId = normalizeProviderId(rawProviderId);
    const models = Array.isArray(provider.models) ? provider.models : [];
    if (!provider.baseUrl || models.length === 0) continue;

    out[providerId] = {
      ...provider,
      apiKey: provider.apiKey?.trim(),
      models: models.map((model) => cloneModelDefinition(model)),
    };
  }

  return out;
}

export async function getMergedProviders(
  config: FgbgUserConfig,
): Promise<Record<string, ProviderConfig>> {
  const projectConfig = readProjectModelConfig();
  // 隐式自动发现
  const implicit = await buildImplicitProviders(projectConfig);
  // 显式配置合并
  const explicit = normalizeExplicitProviders(config.models.providers);

  const merged: Record<string, ProviderConfig> = {};

  for (const [providerId, provider] of Object.entries(implicit)) {
    merged[providerId] = provider;
  }

  for (const [providerId, provider] of Object.entries(explicit)) {
    const prior = merged[providerId];
    if (!prior) {
      merged[providerId] = provider;
      continue;
    }

    const qwenOAuthInConfig =
      providerId === "qwen-portal" && provider.auth === "oauth";
    const explicitKeyForResolve = qwenOAuthInConfig
      ? undefined
      : provider.apiKey?.trim() || undefined;

    merged[providerId] = {
      ...prior,
      ...provider,
      models: mergeModels(prior.models, provider.models),
      apiKey: await resolveApiKeyForProviderAsync({
        providerId,
        explicitApiKey: explicitKeyForResolve,
        projectApiKey: projectConfig.apiKey?.[providerId],
      }),
    };
  }

  applyQwenPortalDashScopeExtras(merged, projectConfig);
  return merged;
}

export function buildRuntimeModelsFromProviders(
  providers: Record<string, ProviderConfig>,
): ModelRegistry {
  const models: ModelRegistry = {};

  for (const [providerId, provider] of Object.entries(providers)) {
    const apiKey = provider.apiKey?.trim();
    if (!apiKey) continue;

    for (const modelDef of provider.models) {
      const key = `${normalizeProviderId(providerId)}/${modelDef.id}`;
      const mergedHeaders = {
        ...(provider.headers ?? {}),
        ...(modelDef.headers ?? {}),
      };
      const model: RuntimeModel = {
        id: modelDef.id,
        name: modelDef.name,
        provider: normalizeProviderId(providerId),
        api: provider.api ?? modelDef.api ?? "openai-completions",
        baseUrl: provider.baseUrl,
        reasoning: modelDef.reasoning,
        input: [...modelDef.input],
        cost: { ...modelDef.cost },
        contextWindow: modelDef.contextWindow,
        maxTokens: modelDef.maxTokens,
        ...(Object.keys(mergedHeaders).length > 0
          ? { headers: mergedHeaders }
          : {}),
        ...(modelDef.compat ? { compat: { ...modelDef.compat } } : {}),
        ...(typeof modelDef.tokenRatio === "number"
          ? { tokenRatio: modelDef.tokenRatio }
          : { tokenRatio: 0.75 }), // 新增字段，默认 0.75
        apiKey,
      };
      models[key] = model;
    }
  }

  return models;
}

export function getGlobalModelConfigPath(): string {
  return resolveGlobalConfigPath();
}
