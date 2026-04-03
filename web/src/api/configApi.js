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

export async function getProviderModels(providerId) {
  return requestJson(`/api/config/models/${encodeURIComponent(providerId)}`);
}

export async function getSupportedModelProviders() {
  return requestJson("/api/config/providers");
}

export async function getDefaultModelProvider() {
  return requestJson("/api/config/default-provider");
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
