import { getUserFgbgConfig } from "../utils/app-path.js";
import {
  buildRuntimeModelsFromProviders,
  getMergedProviders,
  normalizeProviderId,
  parseModelRef,
} from "./pi-embedded-runner/model-config.js";
import type { ModelRef, RuntimeModel } from "../types.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";

const logger = getSubsystemConsoleLogger("model-selection");

function resolvePrimaryModelRef(): ModelRef | null {
  const raw = getUserFgbgConfig();
  const modelEntry = raw.agents?.defaults?.model;
  logger.debug("modelEntry: %o", modelEntry);
  const primaryRaw =
    typeof modelEntry === "string"
      ? modelEntry.trim()
      : typeof modelEntry?.primary === "string"
        ? modelEntry.primary.trim()
        : "";
  logger.debug("primaryRaw: %s", primaryRaw);

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
  const mergedProviders = await getMergedProviders(config);
  const preferred = resolvePrimaryModelRef();

  const modelMap = buildRuntimeModelsFromProviders(mergedProviders);

  if (preferred) {
    const preferredKey = `${normalizeProviderId(preferred.provider)}/${preferred.model}`;
    const preferredModel = modelMap[preferredKey];
    if (preferredModel) {
      logger.debug("Selected preferred model: %s", preferredKey);
      return { modelRef: preferred, model: preferredModel };
    }
    logger.warn("Preferred model not found: %s", preferredKey);
  }

  const firstKey = Object.keys(modelMap)[0];
  if (firstKey) {
    const selectedRef = parseModelRef(firstKey)!;
    logger.debug("Selected first available model: %s", firstKey);
    return { modelRef: selectedRef, model: modelMap[firstKey] };
  }

  logger.error("No provider with apiKey is available");
  const fallback = preferred ?? { provider: "", model: "" };
  return {
    modelRef: fallback,
    modelError:
      "No provider with apiKey is available. Check models.providers.*.apiKey or *_API_KEY.",
    discoveryError: undefined,
  };
}
