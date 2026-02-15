import { getModel } from "@mariozechner/pi-ai";
import {
  getRuntimeModelRegistry,
  getRuntimeProviders,
  normalizeProviderId,
} from "./model-config";
import type { RuntimeModel } from "../types";

function getModelUnsafe(provider: string, modelId: string): RuntimeModel {
  return (getModel as unknown as (p: string, m: string) => RuntimeModel)(
    provider,
    modelId,
  );
}

/**
 * 解析模型
 * @param provider - 提供者 ID
 * @param modelId - 模型 ID
 * @returns 模型对象或错误信息
 */
export function resolveModel(
  provider: string,
  modelId: string,
): {
  model?: RuntimeModel;
  error?: string;
} {
  const normalizedProvider = normalizeProviderId(provider);
  const normalizedModelId = modelId.trim();
  const modelKey = `${normalizedProvider}/${normalizedModelId}`;

  const runtimeModelRegistry = getRuntimeModelRegistry();

  // 第一优先级：命中启动阶段发现后的 registry。
  if (runtimeModelRegistry[modelKey]) {
    return { model: runtimeModelRegistry[modelKey] };
  }

  const runtimeProviders = getRuntimeProviders();
  const providerConfig = runtimeProviders[normalizedProvider];

  // provider 不存在时，直接报明确错误。
  if (!providerConfig) {
    return { error: `Unknown provider: ${normalizedProvider}` };
  }

  const configuredModel = providerConfig.models.find(
    (item) => item.id === normalizedModelId,
  );

  // provider 存在但模型不在配置里，返回可定位错误。
  if (!configuredModel) {
    return { error: `Unknown model: ${modelKey}` };
  }

  try {
    // 第二优先级：按 provider/model 动态即时构建。
    const model = getModelUnsafe(normalizedProvider, normalizedModelId);

    // 构建后补齐 provider 级覆盖配置。
    (model as { baseUrl?: string }).baseUrl = providerConfig.baseUrl;
    if (providerConfig.api) {
      (model as { api?: string }).api = providerConfig.api;
    }
    if (providerConfig.headers) {
      (model as { headers?: Record<string, string> }).headers =
        providerConfig.headers;
    }

    return { model };
  } catch {
    // 若 pi-ai 未内置该模型，按配置构造 fallback，保证服务可运行。
    const fallbackModel = {
      id: configuredModel.id,
      name: configuredModel.name,
      provider: normalizedProvider,
      api: providerConfig.api ?? configuredModel.api ?? "openai-completions",
      baseUrl: providerConfig.baseUrl,
      reasoning: configuredModel.reasoning,
      input: configuredModel.input,
      cost: configuredModel.cost,
      contextWindow: configuredModel.contextWindow,
      maxTokens: configuredModel.maxTokens,
      headers: providerConfig.headers,
      compat: configuredModel.compat,
    } as unknown as RuntimeModel;

    return { model: fallbackModel };
  }
}
