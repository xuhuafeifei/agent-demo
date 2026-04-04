async function requestJson(url, options) {
  const response = await fetch(url, options);
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function getFgbgConfig() {
  return requestJson("/api/config/fgbg");
}

export async function patchFgbgConfig(patch) {
  return requestJson("/api/config/fgbg", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch || {}),
  });
}

export async function resetFgbgConfig() {
  return requestJson("/api/config/fgbg/reset", {
    method: "POST",
  });
}

/** 记忆嵌入连通性测试（与 embedding-provider 同源，不依赖先保存配置） */
export async function testMemorySearchConfig(memorySearch) {
  return requestJson("/api/config/memory-search/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memorySearch }),
  });
}

/** 本地模式：按当前表单配置尝试下载/修复 GGUF（与 createLocalPrepareStrategy.repair 一致） */
export async function repairLocalMemorySearch(memorySearch) {
  return requestJson("/api/config/memory-search/repair-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memorySearch }),
  });
}

export async function getProviderModels(providerId) {
  return requestJson(`/api/config/models?providerId=${encodeURIComponent(providerId)}`);
}

export async function evictLoggingCache() {
  return requestJson("/api/config/logging/evict-cache", {
    method: "POST",
  });
}

export async function getSupportedModelProviders() {
  return requestJson("/api/config/builtin-templates");
}

export async function getConfiguredProviders() {
  return requestJson("/api/config/providers");
}

export async function setPrimaryModel(primary) {
  return requestJson("/api/config/fgbg", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agents: { defaults: { model: { primary } } },
    }),
  });
}

export async function getPrimaryModel() {
  return requestJson("/api/config/fgbg");
}

export async function getQwenPortalCredentials() {
  return requestJson("/api/config/qwen-portal/credentials");
}

export async function getDefaultModelProvider() {
  return requestJson("/api/config/default");
}

export async function testModelConnection(params) {
  return requestJson("/api/config/test-connection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function getModelProviderInfo() {
  return requestJson("/api/config/providers");
}

/** Qwen Portal 设备授权：与 CLI `qwen-oauth-login` 同源，凭证写入本机 auth-profile */
export async function startQwenPortalOAuth() {
  return requestJson("/api/config/qwen-portal/oauth/start", {
    method: "POST",
  });
}

/**
 * 单次轮询；可能返回 success + status pending | success，或 success false（OAuth 错误文案在 error）
 */
export async function pollQwenPortalOAuth(oauthSessionId) {
  const response = await fetch("/api/config/qwen-portal/oauth/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oauthSessionId }),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function getHistory() {
  return requestJson("/api/history");
}

export async function clearHistory() {
  return requestJson("/api/clear", {
    method: "POST",
  });
}
