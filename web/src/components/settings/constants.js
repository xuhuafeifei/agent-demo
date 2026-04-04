// Settings shared constants (extracted from SettingsPage)
export const TABS = [
  { key: "models", label: "模型配置" },
  { key: "memoryHeartbeat", label: "记忆与心跳" },
  { key: "logging", label: "日志配置" },
  { key: "channels", label: "通道配置" },
];

// 本地记忆嵌入：与后端 `parseFgbgUserConfig` 固定值一致
export const LOCAL_MEMORY_MODEL = "nomic-embed-text-v1.5.Q4_K_M";
export const LOCAL_EMBEDDING_DIMENSIONS = 768;

// ─── Provider Models Mapping ────────────────────────────────────────
/**
 * 前端维护的各供应商支持的模型列表
 * 后端返回 provider 配置后，前端根据此映射自动选中默认模型
 */
export const PROVIDER_MODELS = {
  "qwen-portal": [
    { id: "qwen-max", name: "Qwen Max" },
    { id: "qwen-plus", name: "Qwen Plus" },
    { id: "coder-model", name: "Coder Model" },
    { id: "qwen-turbo", name: "Qwen Turbo" },
    { id: "qwen-long", name: "Qwen Long" },
    { id: "qwen3.5-27b", name: "Qwen 3.5 27B" },
  ],
  deepseek: [
    { id: "deepseek-chat", name: "DeepSeek Chat" },
    { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
  ],
};

/**
 * 获取供应商的默认模型 ID
 * 用于后端返回配置后自动选中
 */
export function getDefaultModelForProvider(providerId) {
  const models = PROVIDER_MODELS[providerId];
  return models?.[0]?.id || "";
}

/**
 * 获取供应商支持的模型列表
 * 用于下拉框显示
 */
export function getProviderModelOptions(providerId) {
  return PROVIDER_MODELS[providerId] || [];
}
