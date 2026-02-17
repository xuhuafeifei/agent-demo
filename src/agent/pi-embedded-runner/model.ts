import {
  getRuntimeModelRegistry,
  normalizeProviderId,
} from "./model-config.js";
import type { RuntimeModel } from "../types.js";

/**
 * 按 ref 从 discovery 阶段填好的 registry 取模型；发现阶段已做「构建 + fallback」，此处只查表。
 */
export function resolveModel(
  provider: string,
  modelId: string,
): {
  model?: RuntimeModel;
  error?: string;
} {
  const modelKey = `${normalizeProviderId(provider)}/${modelId.trim()}`;
  const model = getRuntimeModelRegistry()[modelKey];
  if (model) {
    return { model };
  }
  return { error: `Unknown model: ${modelKey}` };
}
