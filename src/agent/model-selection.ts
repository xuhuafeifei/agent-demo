import { getUserFgbgConfig } from "../utils/app-path.js";
import {
  buildRuntimeModelsFromProviders,
  getMergedProviders,
  normalizeProviderId,
  parseModelRef,
} from "./pi-embedded-runner/model-config.js";
import type { ModelRef, RuntimeModel } from "../types.js";

/** 若 qwen-portal 未配置 API Key，尝试用 OAuth 凭证填充 */
async function ensureQwenPortalOAuth(
  providers: Record<string, { apiKey?: string; [k: string]: unknown }>,
): Promise<void> {
  const portal = providers["qwen-portal"];
  if (!portal || portal.apiKey?.trim()) return;
  // todo xhf: bug fix
  const token = "abab";
  if (token) portal.apiKey = token;
}

function resolvePrimaryModelRef(): ModelRef | null {
  const raw = getUserFgbgConfig();
  const modelEntry = raw.agents?.defaults?.model;
  console.log("[model-selection] modelEntry:", modelEntry);
  const primaryRaw =
    typeof modelEntry === "string"
      ? modelEntry.trim()
      : typeof modelEntry?.primary === "string"
        ? modelEntry.primary.trim()
        : "";
  console.log("[model-selection] primaryRaw:", primaryRaw);

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
  const preferred = resolvePrimaryModelRef();

  console.log("[model-selection] mergedProviders:", mergedProviders);
  console.log("[model-selection] preferred:", preferred);

  // 仅当默认模型是 qwen-portal 时才尝试用 OAuth 填充 apiKey，避免其他 provider 时多余的文件/网络请求
  if (preferred && normalizeProviderId(preferred.provider) === "qwen-portal") {
    console.log("start to auth...")
    await ensureQwenPortalOAuth(mergedProviders);
  }

  const modelMap = buildRuntimeModelsFromProviders(mergedProviders);

  console.log("[model-selection] modelMap:", modelMap);

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
