import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AgentChannel } from "./agent/channel-policy.js";
import type { ToolSecurityConfig } from "./agent/tool/security/index.js";

export type ModelInputType = "text" | "image";

export type ModelApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "github-copilot"
  | "bedrock-converse-stream";

export type ModelDefinitionConfig = {
  id: string;
  name: string;
  reasoning: boolean;
  input: ModelInputType[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  api?: ModelApi;
  baseUrl?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  tokenRatio?: number; // 新增字段，默认 0.75
};

export type ProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  api?: ModelApi;
  auth?: "api-key" | "aws-sdk" | "oauth" | "token";
  headers?: Record<string, string>;
  authHeader?: boolean;
  models: ModelDefinitionConfig[];
  // 新增高级选项字段
  maxTokens?: number; // 默认 65536
  tokenRatio?: number; // 默认 0.75
};

export type ModelRef = {
  provider: string;
  model: string;
};

export type ModelConfigFile = {
  model?: {
    provider?: string;
    model?: string;
    contextTokens?: number;
  };
  apiKey?: Record<string, string>;
  providers?: Record<string, Partial<ProviderConfig>>;
};

export type FgbgUserMeta = {
  lastTouchedVersion: string;
  lastTouchedAt: string;
};

export type FgbgUserRawConfig = {
  meta?: {
    lastTouchedVersion?: string;
    lastTouchedAt?: string;
  };
  toolSecurity?: ToolSecurityConfig;
  models?: {
    mode?: string;
    providers?: Record<string, ProviderConfig>;
  };
  agents?: {
    defaults?: {
      model?: { primary?: string };
      models?: Record<string, { alias?: string }>;
    };
    /** 自动重试：baseDelayMs 首次间隔(ms)，maxRetries 最大重试次数，maxDelayMs 单次最大等待(ms) */
    retry?: {
      baseDelayMs?: number;
      maxRetries?: number;
      maxDelayMs?: number;
    };
    memorySearch?: {
      mode?: "local" | "remote";
      model?: string;
      endpoint?: string;
      apiKey?: string;
      chunkMaxChars?: number;
      embeddingDimensions?: number;
      /** 模型下载配置 */
      download?: {
        /** 模型下载地址（可选，未配置则使用默认地址） */
        url?: string;
        /** 下载超时时间（ms，默认 5 分钟） */
        timeout?: number;
        /** 是否允许自动下载（默认 true） */
        enabled?: boolean;
      };
    };
    /** 思考级别配置：按 channel 定义默认思考级别 */
    thinking?: Partial<Record<AgentChannel, ThinkingLevel>>;
  };
  logging?: {
    cacheTime?: number;
    level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";
    file?: string;
    consoleLevel?:
      | "trace"
      | "debug"
      | "info"
      | "warn"
      | "error"
      | "fatal"
      | "silent";
    consoleStyle?: "pretty" | "common" | "json";
    allowModule?: string[];
  };
  heartbeat?: {
    enabled?: boolean;
    intervalMs?: number;
    concurrency?: number;
    allowedScripts?: string[];
  };
  channels?: {
    /** Web 端：单租户，tenantId 固定，不打算支持多租户 */
    web?: {
      tenantId?: string;
    };
    /** QQ：fgbg 只存开关；账号和 tenantId 见 ~/.fgbg/qq/accounts.json */
    qqbot?: {
      enabled?: boolean;
    };
    /** 微信 iLink：仅 enabled 入 fgbg，token 和 tenantId 存 ~/.fgbg/weixin/accounts.json */
    weixin?: {
      enabled?: boolean;
    };
  };
  /** 搜索服务配置 */
  webSearch?: {
    provider?: string;
    apiKey?: string;
  };
};

export type FgbgUserConfig = {
  meta: {
    lastTouchedVersion: string;
    lastTouchedAt: string;
  };
  toolSecurity: ToolSecurityConfig;
  models: {
    mode: string;
    providers: Record<string, ProviderConfig>;
  };
  agents: {
    defaults: {
      model: { primary: string };
      models: Record<string, { alias?: string }>;
    };
    /** 自动重试：baseDelayMs 首次间隔(ms)，maxRetries 最大重试次数，maxDelayMs 单次最大等待(ms) */
    retry: {
      baseDelayMs: number;
      maxRetries: number;
      maxDelayMs: number;
    };
    memorySearch: {
      mode: "local" | "remote";
      model: string;
      endpoint: string;
      apiKey: string;
      chunkMaxChars: number;
      embeddingDimensions: number;
      /** 模型下载配置 */
      download: {
        /** 模型下载地址（可选，未配置则使用默认地址） */
        url: string;
        /** 下载超时时间（ms，默认 5 分钟） */
        timeout: number;
        /** 是否允许自动下载（默认 true） */
        enabled: boolean;
      };
    };
    /** 思考级别配置：按 channel 定义默认思考级别 */
    thinking: Partial<Record<AgentChannel, ThinkingLevel>>;
  };
  logging: {
    cacheTimeSecond: number;
    level: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";
    file: string;
    consoleLevel:
      | "trace"
      | "debug"
      | "info"
      | "warn"
      | "error"
      | "fatal"
      | "silent";
    consoleStyle: "pretty" | "common" | "json";
    allowModule: string[];
  };
  heartbeat: {
    enabled: boolean;
    intervalMs: number;
    concurrency: number;
    allowedScripts: string[];
  };
  channels: {
    /** Web 端租户 ID，默认 "default"，web 端当前不支持多租户 */
    web: {
      tenantId: string;
    };
    /** 落盘仅 `enabled`；appId/secret/target 和 tenantId 由 accounts.json 管理 */
    qqbot: {
      enabled: boolean;
    };
    weixin: {
      enabled: boolean;
    };
  };
  /** 搜索服务配置 */
  webSearch: {
    provider: string;
    apiKey: string;
  };
};

/** GET /config/fgbg 等处返回的 qqbot 展示结构（来自 accounts.json，不写回 fgbg） */
export type QqbotChannelConfigView = {
  enabled: boolean;
  appId: string;
  clientSecret: string;
  hasCredentials?: boolean;
  targetOpenid?: string;
};

export type RuntimeModel = {
  id: string;
  name: string;
  provider: string;
  api: ModelApi;
  baseUrl: string;
  reasoning: boolean;
  input: ModelInputType[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  apiKey?: string;
  tokenRatio?: number; // 新增字段，默认 0.75
};

export type ModelRegistry = Record<string, RuntimeModel>;
