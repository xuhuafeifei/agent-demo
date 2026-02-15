import {
  discoveryModel,
  ensureModelJson,
  getUserFgbgConfig,
  normalizeProviderId,
  parseModelRef,
} from "./agent/pi-embedded-runner/model-config";
import { resolveModel } from "./agent/pi-embedded-runner/model";
import type { ModelRef } from "./agent/types";

function resolveGlobalDefaultModelRef(): ModelRef | null {
  const raw = getUserFgbgConfig();
  const modelEntry = raw.agents?.defaults?.model;

  const primaryRaw =
    typeof modelEntry === "string"
      ? modelEntry.trim()
      : typeof modelEntry?.primary === "string"
        ? modelEntry.primary.trim()
        : "";
  if (!primaryRaw) return null;

  return parseModelRef(primaryRaw, "minimax");
}

function pickFromModelRegistry(params: {
  registry: Record<string, unknown>;
  preferred?: ModelRef | null;
}): ModelRef | null {
  const { registry, preferred } = params;

  // 优先命中全局默认模型（仅当它在 discovery 成功集合里）。
  if (preferred) {
    const key = `${normalizeProviderId(preferred.provider)}/${preferred.model}`;
    if (registry[key]) return preferred;
  }

  // 否则直接取 discovery 成功集合里的第一个模型。
  const firstKey = Object.keys(registry)[0];
  if (!firstKey) return null;
  return parseModelRef(firstKey, "minimax");
}

export async function selectModelForRuntime(): Promise<{
  modelRef: ModelRef;
  model?: ReturnType<typeof resolveModel>["model"];
  modelError?: string;
  discoveryError?: string;
}> {
  await ensureModelJson();
  const discoveryResult = await discoveryModel(getUserFgbgConfig());
  // 全局默认模型
  const globalDefaultRef = resolveGlobalDefaultModelRef();
  // 从模型注册表中选择模型
  const fromRegistry = pickFromModelRegistry({
    registry: discoveryResult.modelRegistry as Record<string, unknown>,
    preferred: globalDefaultRef,
  });

  // discovery 已合并 fgbg + model 配置并返回 defaultModelRef，无需再读配置。
  const finalRef = fromRegistry ?? discoveryResult.defaultModelRef;

  const resolved = resolveModel(finalRef.provider, finalRef.model);

  return {
    modelRef: finalRef,
    model: resolved.model,
    modelError: resolved.error,
    discoveryError: discoveryResult.error,
  };
}
