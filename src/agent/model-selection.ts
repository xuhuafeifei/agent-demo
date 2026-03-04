import { getUserFgbgConfig } from "../utils/app-path.js";
import {
  buildRuntimeModelsFromProviders,
  getMergedProviders,
  normalizeProviderId,
  parseModelRef,
} from "./pi-embedded-runner/model-config.js";
import type { ModelRef, RuntimeModel } from "./types.js";

function resolvePrimaryModelRef(): ModelRef | null {
  const raw = getUserFgbgConfig();
  const modelEntry = raw.agents?.defaults?.model;
  const primaryRaw =
    typeof modelEntry === "string"
      ? modelEntry.trim()
      : typeof modelEntry?.primary === "string"
        ? modelEntry.primary.trim()
        : "";

  if (!primaryRaw) return null;
  return parseModelRef(primaryRaw);
}

export async function selectModelForRuntime(): Promise<{
  modelRef: ModelRef;
  model?: RuntimeModel;
  modelError?: string;
  discoveryError?: string;
}> {
  const config = getUserFgbgConfig();
  const mergedProviders = getMergedProviders(config);
  const modelMap = buildRuntimeModelsFromProviders(mergedProviders);

  const preferred = resolvePrimaryModelRef();
  if (preferred) {
    const preferredKey = `${normalizeProviderId(preferred.provider)}/${preferred.model}`;
    const preferredModel = modelMap[preferredKey];
    if (preferredModel) {
      return { modelRef: preferred, model: preferredModel };
    }
  }

  const firstKey = Object.keys(modelMap)[0];
  if (firstKey) {
    const selectedRef = parseModelRef(firstKey)!;
    return { modelRef: selectedRef, model: modelMap[firstKey] };
  }

  const fallback = preferred ?? { provider: "", model: "" };
  return {
    modelRef: fallback,
    modelError:
      "No provider with apiKey is available. Check models.providers.*.apiKey or *_API_KEY.",
    discoveryError: undefined,
  };
}
