import {
  LOCAL_MEMORY_MODEL,
  LOCAL_EMBEDDING_DIMENSIONS,
} from './constants';

/**
 * 记忆搜索表单数据
 */
export interface MemorySearchForm {
  mode: 'local' | 'remote';
  model: string;
  endpoint: string;
  apiKey: string;
  chunkMaxChars: number;
  embeddingDimensions: number;
  downloadEnabled: boolean;
  downloadUrl: string;
  downloadTimeout: number;
}

/**
 * 记忆搜索负载
 */
export interface MemorySearchPayload {
  mode: 'local' | 'remote';
  model?: string;
  endpoint?: string;
  apiKey?: string;
  chunkMaxChars: number;
  embeddingDimensions: number;
  download: {
    enabled: boolean;
    url: string;
    timeout: number;
  };
}

/**
 * 测试用：remote 且未填 model 时不带 model 字段，后端与已保存配置合并
 */
export function buildMemorySearchPayloadForTest(
  form: MemorySearchForm,
  _rawConfig?: Record<string, unknown>
): MemorySearchPayload {
  // rawConfig currently unused (kept to match SettingsPage call signature)
  void _rawConfig;

  const download = {
    enabled: form.downloadEnabled,
    url: String(form.downloadUrl || '').trim(),
    timeout: Math.max(1000, Number(form.downloadTimeout) || 300000),
  };
  const chunkMaxChars = Math.max(1, Number(form.chunkMaxChars) || 500);

  if (form.mode === 'local') {
    return {
      mode: 'local',
      model: String(form.model || '').trim() || LOCAL_MEMORY_MODEL,
      endpoint: '',
      apiKey: '',
      chunkMaxChars,
      embeddingDimensions: LOCAL_EMBEDDING_DIMENSIONS,
      download,
    };
  }

  const trimmedModel = String(form.model || '').trim();
  const payload: MemorySearchPayload = {
    mode: 'remote',
    endpoint: String(form.endpoint || '').trim(),
    apiKey: form.apiKey ?? '',
    chunkMaxChars,
    embeddingDimensions:
      Math.max(1, Number(form.embeddingDimensions) || 768),
    download,
  };

  if (trimmedModel) {
    payload.model = trimmedModel;
  }

  return payload;
}

/**
 * 保存用：remote 且未填 model 时沿用 rawConfig 中的 model，避免覆盖为空
 */
export function buildMemorySearchForSave(
  form: MemorySearchForm,
  rawConfig?: Record<string, any>
): MemorySearchPayload {
  const baseMs = rawConfig?.agents?.memorySearch as
    | { model?: string }
    | undefined;
  const trimmed = String(form.model || '').trim();

  if (form.mode === 'local') {
    return {
      mode: 'local',
      model: trimmed || LOCAL_MEMORY_MODEL,
      endpoint: '',
      apiKey: '',
      chunkMaxChars: Math.max(1, Number(form.chunkMaxChars) || 500),
      embeddingDimensions: LOCAL_EMBEDDING_DIMENSIONS,
      download: {
        enabled: form.downloadEnabled,
        url: String(form.downloadUrl || '').trim(),
        timeout: Math.max(1000, Number(form.downloadTimeout) || 300000),
      },
    };
  }

  return {
    mode: 'remote',
    model: trimmed || baseMs?.model || '',
    endpoint: String(form.endpoint || '').trim(),
    apiKey: form.apiKey ?? '',
    chunkMaxChars: Math.max(1, Number(form.chunkMaxChars) || 500),
    embeddingDimensions:
      Math.max(1, Number(form.embeddingDimensions) || 768),
    download: {
      enabled: form.downloadEnabled,
      url: String(form.downloadUrl || '').trim(),
      timeout: Math.max(1000, Number(form.downloadTimeout) || 300000),
    },
  };
}
