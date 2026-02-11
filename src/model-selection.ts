import { getModel } from "@mariozechner/pi-ai";

// 支持的模型API格式
export type ModelApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "github-copilot"
  | "bedrock-converse-stream";

// 模型定义配置
export type ModelDefinitionConfig = {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  api?: ModelApi;
  baseUrl?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
};

// 供应商配置
export type ProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  api?: ModelApi;
  auth?: "api-key" | "aws-sdk" | "oauth" | "token";
  headers?: Record<string, string>;
  authHeader?: boolean;
  models: ModelDefinitionConfig[];
};

// 模型引用类型
export type ModelRef = {
  provider: string;
  model: string;
};

// 思维级别类型
export type ThinkLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

// 供应商ID规范化
export function normalizeProviderId(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "z.ai" || normalized === "z-ai") return "zai";
  if (normalized === "opencode-zen") return "opencode";
  if (normalized === "qwen") return "qwen-portal";
  return normalized;
}

// 模型引用解析
export function parseModelRef(raw: string, defaultProvider: string = "minimax"): ModelRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");

  if (slash === -1) {
    const provider = normalizeProviderId(defaultProvider);
    const model = trimmed.trim();
    return { provider, model };
  }

  const providerRaw = trimmed.slice(0, slash).trim();
  const provider = normalizeProviderId(providerRaw);
  const model = trimmed.slice(slash + 1).trim();

  if (!provider || !model) return null;

  return { provider, model };
}

// 供应商配置
export const DEFAULT_PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  minimax: {
    baseUrl: "https://api.minimax.chat/v1",
    api: "openai-completions",
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
      {
        id: "MiniMax-VL-01",
        name: "MiniMax VL 01",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 15, output: 60, cacheRead: 2, cacheWrite: 10 },
        contextWindow: 200000,
        maxTokens: 8192,
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
        maxTokens: 8192,
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
        maxTokens: 32768,
        headers: { "User-Agent": "KimiCLI/0.77" },
        compat: { supportsDeveloperRole: false },
      },
    ],
  },
  "qwen-portal": {
    baseUrl: "https://portal.qwen.ai/v1",
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
        maxTokens: 8192,
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
      },
    ],
  },
};

// 解析API密钥的优先级：
// 1. 环境变量（带前缀如 MINIMAX_API_KEY, MOONSHOT_API_KEY）
// 2. 配置文件
// 3. 认证配置文件
export function resolveApiKeyForProvider(params: {
  provider: string;
  config?: { apiKey?: Record<string, string> };
}): string | undefined {
  const { provider, config } = params;
  const normalizedProvider = normalizeProviderId(provider);

  // 1. 从环境变量中查找（如 MINIMAX_API_KEY）
  const envVarName = `${normalizedProvider.toUpperCase()}_API_KEY`;
  if (process.env[envVarName]) {
    return process.env[envVarName]?.trim();
  }

  // 2. 从配置文件中查找
  if (config?.apiKey?.[normalizedProvider]) {
    return config.apiKey[normalizedProvider].trim();
  }

  return undefined;
}

// 模型解析函数（类似 OpenClaw 的 resolveModel）
export function resolveModel(
  provider: string,
  modelId: string,
  _config?: { apiKey?: Record<string, string> },
): { model?: ReturnType<typeof getModel>; error?: string } {
  const normalizedProvider = normalizeProviderId(provider);
  const normalizedModelId = modelId.trim();
  const getModelUnsafe = getModel as unknown as (
    provider: string,
    model: string,
  ) => ReturnType<typeof getModel>;

  try {
    // 尝试使用 getModel 直接查找
    const model = getModelUnsafe(normalizedProvider, normalizedModelId);
    if (model) {
      return { model };
    }

    // 如果未找到，检查是否有默认配置
    const providerConfig = DEFAULT_PROVIDER_CONFIGS[normalizedProvider];
    if (!providerConfig) {
      return { error: `Unknown provider: ${normalizedProvider}` };
    }

    // 查找模型配置
    const modelConfig = providerConfig.models.find((m) => m.id === normalizedModelId);
    if (!modelConfig) {
      return { error: `Unknown model: ${normalizedProvider}/${normalizedModelId}` };
    }

    // 此处可以添加创建默认模型的逻辑
    // 由于 pi-ai 的 getModel 内部逻辑，我们尝试使用默认模型
    const fallbackModel = getModelUnsafe(normalizedProvider, modelConfig.id);
    if (fallbackModel) {
      return { model: fallbackModel };
    }

    return { error: `Failed to resolve model: ${normalizedProvider}/${normalizedModelId}` };
  } catch (error) {
    return { error: `Error resolving model: ${String(error)}` };
  }
}
