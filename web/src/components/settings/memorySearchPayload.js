import {
  LOCAL_MEMORY_MODEL,
  LOCAL_EMBEDDING_DIMENSIONS,
} from "./constants";

// 测试用：remote 且未填 model 时不带 model 字段，后端与已保存配置合并
export function buildMemorySearchPayloadForTest(form, rawConfig) {
  // rawConfig currently unused (kept to match SettingsPage call signature)
  void rawConfig;

  const download = {
    enabled: form.downloadEnabled,
    url: String(form.downloadUrl || "").trim(),
    timeout: Math.max(1000, Number(form.downloadTimeout) || 300000),
  };
  const chunkMaxChars = Math.max(1, Number(form.chunkMaxChars) || 500);

  if (form.mode === "local") {
    return {
      mode: "local",
      model: String(form.model || "").trim() || LOCAL_MEMORY_MODEL,
      endpoint: "",
      apiKey: "",
      chunkMaxChars,
      embeddingDimensions: LOCAL_EMBEDDING_DIMENSIONS,
      download,
    };
  }

  const trimmedModel = String(form.model || "").trim();
  const payload = {
    mode: "remote",
    endpoint: String(form.endpoint || "").trim(),
    apiKey: form.apiKey ?? "",
    chunkMaxChars,
    embeddingDimensions: Math.max(1, Number(form.embeddingDimensions) || 768),
    download,
  };

  if (trimmedModel) {
    payload.model = trimmedModel;
  }

  return payload;
}

// 保存用：remote 且未填 model 时沿用 rawConfig 中的 model，避免覆盖为空
export function buildMemorySearchForSave(form, rawConfig) {
  const baseMs = rawConfig?.agents?.memorySearch;
  const trimmed = String(form.model || "").trim();

  if (form.mode === "local") {
    return {
      mode: "local",
      model: trimmed || LOCAL_MEMORY_MODEL,
      endpoint: "",
      apiKey: "",
      chunkMaxChars: Math.max(1, Number(form.chunkMaxChars) || 500),
      embeddingDimensions: LOCAL_EMBEDDING_DIMENSIONS,
      download: {
        enabled: form.downloadEnabled,
        url: String(form.downloadUrl || "").trim(),
        timeout: Math.max(1000, Number(form.downloadTimeout) || 300000),
      },
    };
  }

  return {
    mode: "remote",
    model: trimmed || baseMs?.model || "",
    endpoint: String(form.endpoint || "").trim(),
    apiKey: form.apiKey ?? "",
    chunkMaxChars: Math.max(1, Number(form.chunkMaxChars) || 500),
    embeddingDimensions: Math.max(1, Number(form.embeddingDimensions) || 768),
    download: {
      enabled: form.downloadEnabled,
      url: String(form.downloadUrl || "").trim(),
      timeout: Math.max(1000, Number(form.downloadTimeout) || 300000),
    },
  };
}

