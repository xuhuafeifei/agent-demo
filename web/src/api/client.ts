/**
 * Frontend API Client for the refactored web layer.
 * Provides type-safe access to all API endpoints.
 *
 * Usage:
 * ```typescript
 * const client = new ApiClient({ baseURL: '/api/v1' });
 * const config = await client.config.getFgbg();
 * ```
 *
 * Note: Backend routes are mounted at /api/v1
 */

export type ApiSuccess<T> = {
  success: true;
} & T;

export type ApiError = {
  success: false;
  error: string;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface ApiClientOptions {
  baseURL?: string;
  timeout?: number;
}

export interface FgbgConfig {
  // Add actual config type fields here based on FgbgUserConfig
  [key: string]: any;
}

export interface ConfigMetadata {
  defaultPaths: string[];
  protectedPaths: string[];
}

export interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  isBuiltin: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface OAuthStartResponse {
  oauthSessionId: string;
  verificationUrl: string;
  userCode: string;
  expiresIn: number;
}

export interface OAuthPollResponse {
  status: 'success' | 'pending' | 'error';
  slowDown?: boolean;
  error?: string;
}

export interface HistoryEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  contextSnapshot?: unknown;
  contextUsed?: unknown;
}

export interface MemorySearchTestResult {
  mode: string;
  dimensions?: number;
  durationMs?: number;
  warning?: string;
}

/**
 * HTTP request helper with error handling.
 */
export async function request<T>(
  url: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    let payload: any = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (!response.ok || payload?.success === false) {
      return {
        success: false,
        error: payload?.error || `HTTP ${response.status}`,
      };
    }

    return { success: true, ...payload };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * API Client class for structured access to all endpoints.
 */
export class ApiClient {
  readonly baseURL: string;

  constructor(options?: ApiClientOptions) {
    this.baseURL = options?.baseURL || '/api/v1';
  }

  /**
   * Config API namespace
   */
  readonly config = {
    /**
     * Get full FgbgUserConfig with metadata
     */
    getFgbg: () =>
      request<{ config: FgbgConfig; metadata: ConfigMetadata }>(
        `${this.baseURL}/config/fgbg`
      ),

    /**
     * Patch config with partial updates
     */
    patchFgbg: (patch: Partial<FgbgConfig>) =>
      request<{ config: FgbgConfig; metadata: ConfigMetadata }>(
        `${this.baseURL}/config/fgbg`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }
      ),

    /**
     * Reset config to defaults
     */
    resetFgbg: () =>
      request<{ config: FgbgConfig; metadata: ConfigMetadata }>(
        `${this.baseURL}/config/fgbg/reset`,
        { method: 'POST' }
      ),

    /**
     * Test memory search embedding connectivity
     */
    testMemorySearch: (memorySearch: any) =>
      request<MemorySearchTestResult>(
        `${this.baseURL}/config/memory-search/test`,
        {
          method: 'POST',
          body: JSON.stringify({ memorySearch }),
        }
      ),

    /**
     * Repair/download local memory search GGUF model
     */
    repairLocalMemorySearch: (memorySearch: any) =>
      request<{ message: string }>(
        `${this.baseURL}/config/memory-search/repair-local`,
        {
          method: 'POST',
          body: JSON.stringify({ memorySearch }),
        }
      ),

    /**
     * Get all built-in provider templates
     */
    getProviders: () =>
      request<{ providers: ProviderInfo[] }>(
        `${this.baseURL}/config/providers`
      ),

    /**
     * Get detailed provider info
     */
    getProvider: (id: string) =>
      request<{ provider: ProviderInfo & { models: any[] } }>(
        `${this.baseURL}/config/providers/${encodeURIComponent(id)}`
      ),

    /**
     * Get models for a specific provider
     */
    getProviderModels: (providerId: string) =>
      request<{ models: ModelInfo[] }>(
        `${this.baseURL}/config/models/${encodeURIComponent(providerId)}`
      ),

    /**
     * Get default model provider
     */
    getDefaultProvider: () =>
      request<{ defaultProvider: any }>(
        `${this.baseURL}/config/default-provider`
      ),

    /**
     * Invalidate logging config cache
     */
    evictLoggingCache: () =>
      request<{ message: string }>(
        `${this.baseURL}/config/logging/evict-cache`,
        { method: 'POST' }
      ),

    /**
     * Start Qwen Portal OAuth device flow
     */
    oauth: {
      start: () =>
        request<OAuthStartResponse>(
          `${this.baseURL}/config/qwen-portal/oauth/start`,
          { method: 'POST' }
        ),

      poll: (oauthSessionId: string) =>
        request<OAuthPollResponse>(
          `${this.baseURL}/config/qwen-portal/oauth/poll`,
          {
            method: 'POST',
            body: JSON.stringify({ oauthSessionId }),
          }
        ),
    },
  };

  /**
   * History API namespace
   */
  readonly history = {
    /**
     * Get conversation history (backend returns default limit)
     */
    get: () =>
      request<{ history: HistoryEntry[] }>(
        `${this.baseURL}/history`
      ),

    /**
     * Clear conversation history
     */
    clear: () =>
      request<{ message: string }>(`${this.baseURL}/clear`, { method: 'POST' }),
  };

  /**
   * Status API namespace
   */
  readonly status = {
    /**
     * Get agent runtime state
     */
    get: () =>
      request<{ runtime: any }>(`${this.baseURL}/status`),
  };

  /**
   * Chat API namespace (SSE streaming)
   */
  readonly chat = {
    /**
     * Send message and get SSE stream
     * Note: This returns a Response object for streaming, not JSON
     */
    send: (message: string) =>
      fetch(`${this.baseURL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      }),
  };

  /**
   * Approval API namespace
   */
  readonly approval = {
    /**
     * Approve or deny a tool execution request
     */
    respond: (toolUseId: string, approved: boolean) =>
      request<{ ok: boolean; toolUseId: string; approved: boolean }>(
        `${this.baseURL}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({ toolUseId, approved }),
        }
      ),

    /**
     * Get pending approval requests (debug)
     */
    getPending: () =>
      request<{ pending: Array<{ toolUseId: string; toolName: string; args: Record<string, unknown> }> }>(
        `${this.baseURL}/approve/pending`
      ),
  };
}

/**
 * Default client instance.
 */
export const api = new ApiClient();
