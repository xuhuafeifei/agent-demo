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

