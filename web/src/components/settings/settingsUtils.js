import Qwen from "@lobehub/icons/es/Qwen";
import DeepSeek from "@lobehub/icons/es/DeepSeek";

const QwenColor = Qwen.Color;
const DeepSeekColor = DeepSeek.Color;

// ─── Provider icon mapping ────────────────────────────────────────
export function getProviderIcon(providerId) {
  const iconMap = {
    "qwen-portal": QwenColor,
    deepseek: DeepSeekColor,
    minimax: "🔵",
    moonshot: "🌙",
    "kimi-code": "🌟",
    xiaomi: "MI",
    ollama: "🦙",
  };
  return iconMap[providerId] || "⚙️";
}

export function getProviderName(providerId, providerInfo) {
  const nameMap = {
    "qwen-portal": "Qwen",
    deepseek: "DeepSeek",
    minimax: "MiniMax",
    moonshot: "Moonshot",
    "kimi-code": "Kimi Code",
    xiaomi: "Xiaomi",
    ollama: "Ollama",
  };
  return nameMap[providerId] || providerInfo?.name || providerId;
}

// ─── Utility helpers ────────────────────────────────────────────────
export function deepGet(obj, path) {
  return path
    .split(".")
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function deepSet(target, path, value) {
  const keys = path.split(".");
  let cursor = target;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = value;
      return;
    }
    if (
      typeof cursor[key] !== "object" ||
      cursor[key] === null ||
      Array.isArray(cursor[key])
    ) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  });
}

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function deepDiff(current, base) {
  if (deepEqual(current, base)) return undefined;
  if (!isPlainObject(current) || !isPlainObject(base)) return current;
  const out = {};
  Object.keys(current).forEach((key) => {
    const diff = deepDiff(current[key], base[key]);
    if (diff !== undefined) out[key] = diff;
  });
  // Keys removed from current vs base (merge-only PATCH would otherwise keep stale values)
  Object.keys(base).forEach((key) => {
    if (!(key in current)) {
      out[key] = null;
    }
  });
  return Object.keys(out).length ? out : undefined;
}

