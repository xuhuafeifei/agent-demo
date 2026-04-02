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
