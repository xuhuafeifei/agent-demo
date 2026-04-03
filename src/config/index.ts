import path from "node:path";
import { DEFAULT_TOOL_REGISTER } from "../agent/tool/tool-register.js";
import type {
  FgbgUserConfig,
  FgbgUserRawConfig,
  ProviderConfig,
} from "../types.js";
import {
  resolveGlobalConfigPath,
  resolveWorkspaceDir,
} from "../utils/app-path.js";
import fs, { read } from "node:fs";
import {
  buildImplicitProviderTemplates,
  parseModelRef,
} from "../agent/pi-embedded-runner/model-config.js";

function resolveFgbgUserConfig(raw: FgbgUserRawConfig): FgbgUserConfig {
  const modelsMode = raw.models?.mode ?? "merge";
  const cfg: FgbgUserConfig = {
    meta: {
      lastTouchedVersion: raw.meta?.lastTouchedVersion ?? "1.0.0",
      lastTouchedAt: raw.meta?.lastTouchedAt ?? new Date().toISOString(),
    },
    toolRegister: raw.toolRegister ?? DEFAULT_TOOL_REGISTER,
    models: {
      mode: modelsMode,
      providers: (() => {
        const defaultProviders: Record<string, ProviderConfig> = {
          "qwen-portal": {
            baseUrl: "https://portal.qwen.ai/v1",
            apiKey: "",
            api: "openai-completions",
            models: [
              {
                id: "coder-model",
                name: "coder-model",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 8192,
                maxTokens: 16 * 1024,
                tokenRatio: 0.75,
              },
            ],
          },
        };

        const userProviders = raw.models?.providers;
        if (!userProviders) {
          return defaultProviders;
        }
        if (modelsMode === "replace") {
          return { ...userProviders };
        }
        return { ...defaultProviders, ...userProviders };
      })(),
    },
    agents: {
      defaults: {
        model: {
          primary:
            raw.agents?.defaults?.model?.primary ?? "qwen-portal/coder-model",
        },
        models: raw.agents?.defaults?.models ?? {
          "qwen-portal/coder-model": {
            alias: "qwen-portal",
          },
        },
        workspace: raw.agents?.defaults?.workspace ?? resolveWorkspaceDir(),
      },
      retry: {
        baseDelayMs: raw.agents?.retry?.baseDelayMs ?? 1000,
        maxRetries: raw.agents?.retry?.maxRetries ?? 3,
        maxDelayMs: raw.agents?.retry?.maxDelayMs ?? 5000,
      },
      memorySearch: {
        mode: raw.agents?.memorySearch?.mode ?? "local",
        model: raw.agents?.memorySearch?.model ?? "",
        endpoint: raw.agents?.memorySearch?.endpoint ?? "",
        apiKey: raw.agents?.memorySearch?.apiKey ?? "",
        chunkMaxChars: raw.agents?.memorySearch?.chunkMaxChars ?? 500,
        embeddingDimensions:
          raw.agents?.memorySearch?.embeddingDimensions ?? 768,
        download: {
          url:
            raw.agents?.memorySearch?.download?.url ??
            "https://hf-mirror.com/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf",
          timeout: raw.agents?.memorySearch?.download?.timeout ?? 5 * 60 * 1000, // 默认 5 分钟
          enabled: raw.agents?.memorySearch?.download?.enabled ?? true, // 默认允许自动下载
        },
      },
      thinking: raw.agents?.thinking ?? {},
    },
    logging: {
      cacheTimeSecond: raw.logging?.cacheTime ?? 300,
      level: raw.logging?.level ?? "info",
      file: raw.logging?.file ?? "/tmp/fgbg/fgbg-YYYY-MM-DD.log",
      consoleLevel: raw.logging?.consoleLevel ?? "debug",
      consoleStyle: raw.logging?.consoleStyle ?? "pretty",
      allowModule: raw.logging?.allowModule ?? [],
    },
    heartbeat: {
      enabled: raw.heartbeat?.enabled ?? true,
      intervalMs: raw.heartbeat?.intervalMs ?? 1000,
      concurrency: raw.heartbeat?.concurrency ?? 5,
      allowedScripts: raw.heartbeat?.allowedScripts ?? [],
    },
    channels: {
      qqbot: {
        enabled: raw.channels?.qqbot?.enabled ?? false,
        appId: raw.channels?.qqbot?.appId ?? "",
        clientSecret: raw.channels?.qqbot?.clientSecret ?? "",
        targetOpenid: raw.channels?.qqbot?.targetOpenid,
        accounts: raw.channels?.qqbot?.accounts,
      },
    },
  };

  // qqbot通道配置校验
  if (cfg.channels.qqbot.enabled === true && !cfg.channels.qqbot.appId) {
    throw new Error("开启qqbot通道时, qqbot.appId 不能为空");
  }
  if (cfg.channels.qqbot.enabled === true && !cfg.channels.qqbot.clientSecret) {
    throw new Error("开启qqbot通道时, qqbot.clientSecret 不能为空");
  }

  // memorySearch配置校验
  if (
    cfg.agents.memorySearch.mode === "remote" &&
    !cfg.agents.memorySearch.endpoint
  ) {
    throw new Error(
      "memorySearch.mode=remote 时, memorySearch.endpoint 不能为空",
    );
  }
  if (
    cfg.agents.memorySearch.mode === "remote" &&
    !cfg.agents.memorySearch.apiKey
  ) {
    throw new Error(
      "memorySearch.mode=remote 时, memorySearch.apiKey 不能为空",
    );
  }
  if (cfg.agents.memorySearch.mode === "local") {
    cfg.agents.memorySearch.model = "nomic-embed-text-v1.5.Q4_K_M";
  }

  const CONCURRENCY_MIN = 1;
  const CONCURRENCY_MAX = 3;

  // 心跳收紧
  if (
    cfg.heartbeat.concurrency === CONCURRENCY_MIN ||
    cfg.heartbeat.concurrency === CONCURRENCY_MAX
  ) {
    cfg.heartbeat.concurrency = Math.max(
      Math.min(cfg.heartbeat.concurrency, CONCURRENCY_MAX),
      CONCURRENCY_MIN,
    );
  }

  const INTERVAL_MIN_MS = 200;
  const INTERVAL_MAX_MS = 60000;

  if (
    cfg.heartbeat.intervalMs === INTERVAL_MIN_MS ||
    cfg.heartbeat.intervalMs === INTERVAL_MAX_MS
  ) {
    cfg.heartbeat.intervalMs = Math.max(
      Math.min(cfg.heartbeat.intervalMs, INTERVAL_MAX_MS),
      INTERVAL_MIN_MS,
    );
  }

  // logging 参数收紧
  if (cfg.logging.cacheTimeSecond < 60) {
    cfg.logging.cacheTimeSecond = 60;
  }
  if (cfg.logging.cacheTimeSecond > 300) {
    cfg.logging.cacheTimeSecond = 300;
  }
  if (
    cfg.logging.level !== "trace" &&
    cfg.logging.level !== "debug" &&
    cfg.logging.level !== "info" &&
    cfg.logging.level !== "warn" &&
    cfg.logging.level !== "error" &&
    cfg.logging.level !== "fatal" &&
    cfg.logging.level !== "silent"
  ) {
    cfg.logging.level = "info";
  }
  if (
    cfg.logging.consoleLevel !== "debug" &&
    cfg.logging.consoleLevel !== "info" &&
    cfg.logging.consoleLevel !== "warn" &&
    cfg.logging.consoleLevel !== "error" &&
    cfg.logging.consoleLevel !== "fatal" &&
    cfg.logging.consoleLevel !== "silent"
  ) {
    cfg.logging.consoleLevel = "debug";
  }
  if (
    cfg.logging.consoleStyle !== "pretty" &&
    cfg.logging.consoleStyle !== "common" &&
    cfg.logging.consoleStyle !== "json"
  ) {
    cfg.logging.consoleStyle = "pretty";
  }

  return cfg;
}

type FgbgUserConfigCache = {
  cfg: FgbgUserConfig;
  expireAt: number;
};

let cache: FgbgUserConfigCache | null = null;

/**
 * 读取用户配置, 解析并返回 FgbgUserConfig
 * 如果配置文件不存在或解析失败, 则返回默认配置
 * @returns FgbgUserConfig
 */
export function refreshAndGetFgbgUserConfig(): FgbgUserConfig {
  const filePath = resolveGlobalConfigPath();
  try {
    const raw = JSON.parse(
      fs.readFileSync(filePath, "utf-8"),
    ) as FgbgUserRawConfig;
    cache = {
      cfg: resolveFgbgUserConfig(raw),
      expireAt: Date.now() + 5 * 60 * 1000,
    };
  } catch {
    cache = {
      cfg: resolveFgbgUserConfig({} as FgbgUserRawConfig),
      expireAt: Date.now() + 5 * 60 * 1000,
    };
  }
  return cache.cfg;
}

/**
 * 刷新缓存
 */
export function refreshFgbgUserConfigCache(): void {
  const filePath = resolveGlobalConfigPath();
  try {
    const raw = JSON.parse(
      fs.readFileSync(filePath, "utf-8"),
    ) as FgbgUserRawConfig;
    cache = {
      cfg: resolveFgbgUserConfig(raw),
      expireAt: Date.now() + 5 * 60 * 1000,
    };
  } catch {
    cache = {
      cfg: resolveFgbgUserConfig({} as FgbgUserRawConfig),
      expireAt: Date.now() + 5 * 60 * 1000, // 5分钟缓存
    };
  }
}

/**
 * 读取缓存. 如果缓存不存在, 则重新读取配置
 * @returns FgbgUserConfig
 */
export function readFgbgUserConfig(): FgbgUserConfig {
  if (cache && cache.expireAt > Date.now()) {
    return cache.cfg;
  }
  return refreshAndGetFgbgUserConfig();
}

/**
 * 清除缓存
 */
export function evicateFgbgUserConfigCache(): void {
  cache = null;
}

/**
 * 将配置写回 fgbg.json（不解读字段含义）。
 * 若目录不存在会先创建（权限 0o700），文件权限 0o600。
 */
export function writeFgbgUserConfig(cfg: FgbgUserConfig): void {
  const cfgPath = resolveGlobalConfigPath();
  const cfgDir = path.dirname(cfgPath);
  if (!fs.existsSync(cfgDir)) {
    fs.mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function getDefaultFgbgUserConfig(): FgbgUserConfig {
  return resolveFgbgUserConfig({} as FgbgUserRawConfig);
}

/*----------------------------------------------------------------------------*/
// 暴露给前端修改配置的 web 接口
/*----------------------------------------------------------------------------*/

// 获取所有后台系统支持的模型供应商
export function getSupportedModelProviders(): string[] {
  const providers = buildImplicitProviderTemplates() as Record<
    string,
    ProviderConfig
  >;
  return Object.keys(providers);
}

// 获取agent 使用的默认供应商(默认 qwen-portal, 这是后端系统的共识)
export function getDefaultModelProvider(): string {
  const modelRef = parseModelRef(
    readFgbgUserConfig().agents.defaults.model.primary,
  );
  return modelRef?.provider ?? "qwen-portal";
}

// 获取模型信息的接口
export function getModelProviderInfo(): Record<string, ProviderConfig> {
  return readFgbgUserConfig().models.providers;
}
