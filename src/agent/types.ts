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
};

export type ProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  api?: ModelApi;
  auth?: "api-key" | "aws-sdk" | "oauth" | "token";
  headers?: Record<string, string>;
  authHeader?: boolean;
  models: ModelDefinitionConfig[];
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
};

export type FgbgUserConfig = {
  meta?: {
    lastTouchedVersion?: string;
    lastTouchedAt?: string;
  };
  models?: {
    mode?: string;
    providers?: Record<string, ProviderConfig>;
  };
  agents?: {
    defaults?: {
      model?: string | { primary?: string };
      models?: Record<string, { alias?: string }>;
      workspace?: string;
    };
    memorySearch?: {
      mode?: "local" | "remote";
      model?: string;
      endpoint?: string;
      apiKey?: string;
      chunkMaxChars?: number;
      embeddingDimensions?: number;
    };
  };
  logging?: {
    cacheTime?: number;
    level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";
    file?: string;
    consoleLevel?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";
    consoleStyle?: "pretty" | "common" | "json";
    allowModule?: string[] | string;
  };
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
};

export type ModelRegistry = Record<string, RuntimeModel>;
