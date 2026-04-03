import { randomUUID } from "node:crypto";
import { type Response, Router } from "express";
import { saveQwenPortalCredentials } from "../../agent/auth/oauth-path.js";
import {
  clearHistory,
  getHistory,
  getAgentRuntimeState,
  runWithSingleFlight,
  ModelUnavailableError,
} from "../../agent/run.js";
import type { RuntimeStreamEvent } from "../../agent/utils/events.js";
import type { FgbgUserConfig } from "../../types.js";
import {
  evicateFgbgUserConfigCache,
  getDefaultFgbgUserConfig,
  readFgbgUserConfig,
  writeFgbgUserConfig,
} from "../../config/index.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import {
  repairLocalMemorySearchModel,
  testMemorySearchEmbedding,
} from "../../memory/embedding/embedding-provider.js";

const webLogger = getSubsystemConsoleLogger("web");

type UiEventType = "message" | "thinking" | "tool" | "context" | "status";

// 获取工具显示名称（优先使用 alias，否则使用 toolName）
function getToolDisplayName(toolName: string, alias?: string): string {
  return alias || toolName || "未知工具";
}

type RuntimeUiEvent = RuntimeStreamEvent & {
  uiEventType?: UiEventType;
  uiPayload?: Record<string, unknown>;
};

function writeNamedSse(
  res: Response,
  eventName: string,
  data: Record<string, unknown>,
): void {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify({ ...data, type: eventName })}\n\n`);
}

function normalizeRuntimeEvent(event: RuntimeStreamEvent): RuntimeUiEvent {
  switch (event.type) {
    case "context_snapshot": {
      const typedEvent = event as {
        type: "context_snapshot";
        seq: number;
        reason: "before_prompt";
        contextText: string;
      };
      return {
        ...typedEvent,
        uiEventType: "context",
        uiPayload: {
          phase: typedEvent.type,
          seq: typedEvent.seq,
          reason: typedEvent.reason,
          contextText: typedEvent.contextText,
        },
      };
    }
    case "context_used": {
      const typedEvent = event as {
        type: "context_used";
        totalTokens: number;
        threshold: number;
        contextWindow: number;
      };
      return {
        ...typedEvent,
        uiEventType: "context",
        uiPayload: {
          phase: typedEvent.type,
          totalTokens: typedEvent.totalTokens,
          threshold: typedEvent.threshold,
          contextWindow: typedEvent.contextWindow,
        },
      };
    }
    case "message_start":
    case "message_update":
    case "message_end":
      return {
        ...event,
        uiEventType: "message",
        uiPayload: { phase: event.type },
      };
    case "thinking_update":
      return {
        ...event,
        uiEventType: "thinking",
        uiPayload: {
          thinking: event.thinking,
          thinkingDelta: event.thinkingDelta,
        },
      };
    case "tool_execution_start":
      return {
        ...event,
        uiEventType: "tool",
        uiPayload: {
          phase: "start",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        },
      };
    case "tool_execution_update":
      return {
        ...event,
        uiEventType: "tool",
        uiPayload: {
          phase: "update",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          partialResult: event.partialResult,
        },
      };
    case "tool_execution_end":
      return {
        ...event,
        uiEventType: "tool",
        uiPayload: {
          phase: "end",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
        },
      };
    case "auto_retry_start":
    case "auto_retry_end":
    case "error":
      return {
        ...event,
        uiEventType: "context",
        uiPayload: { phase: event.type },
      };
    case "agent_end":
    case "done":
      return {
        ...event,
        uiEventType: "status",
        uiPayload: { phase: event.type },
      };
    default:
      return event;
  }
}

function writeSse(res: Response, data: RuntimeStreamEvent): void {
  const normalized = normalizeRuntimeEvent(data);
  res.write(`data: ${JSON.stringify(normalized)}\n\n`);
}

type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends Array<infer U>
    ? RecursivePartial<U>[]
    : T[P] extends object
      ? RecursivePartial<T[P]>
      : T[P];
};

function mergeMemorySearchForTest(
  base: FgbgUserConfig,
  partial?: RecursivePartial<FgbgUserConfig["agents"]["memorySearch"]>,
): FgbgUserConfig["agents"]["memorySearch"] {
  const ms = base.agents.memorySearch;
  if (!partial) {
    return ms;
  }
  const partialModel =
    typeof partial.model === "string" && partial.model.trim() !== ""
      ? partial.model.trim()
      : undefined;
  return {
    mode: (partial.mode as FgbgUserConfig["agents"]["memorySearch"]["mode"]) ??
      ms.mode,
    model: partialModel ?? ms.model,
    endpoint: partial.endpoint ?? ms.endpoint,
    apiKey: partial.apiKey ?? ms.apiKey,
    chunkMaxChars: partial.chunkMaxChars ?? ms.chunkMaxChars,
    embeddingDimensions:
      partial.embeddingDimensions ?? ms.embeddingDimensions,
    download: {
      url: partial.download?.url ?? ms.download.url,
      timeout: partial.download?.timeout ?? ms.download.timeout,
      enabled: partial.download?.enabled ?? ms.download.enabled,
    },
  };
}

/** 预留：当前无受保护字段；qwen-portal 支持 OAuth 与手动 API Key 二选一写入配置 */
const PROTECTED_PATHS = new Set<string>();

type PendingQwenOAuthSession = {
  verifier: string;
  deviceCode: string;
  expiresAt: number;
  intervalMs: number;
};

const qwenOAuthSessions = new Map<string, PendingQwenOAuthSession>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function deepEqual(value: unknown, expectation: unknown): boolean {
  if (value === expectation) return true;
  if (
    value === undefined ||
    expectation === undefined ||
    value === null ||
    expectation === null
  ) {
    return value === expectation;
  }
  if (Array.isArray(value) && Array.isArray(expectation)) {
    if (value.length !== expectation.length) return false;
    return value.every((item, idx) => deepEqual(item, expectation[idx]));
  }
  if (isPlainObject(value) && isPlainObject(expectation)) {
    const keys = new Set([...Object.keys(value), ...Object.keys(expectation)]);
    return Array.from(keys).every((key) =>
      deepEqual(value[key], expectation[key]),
    );
  }
  return false;
}

function collectDefaultPaths(
  current: Record<string, unknown>,
  defaults: Record<string, unknown>,
  prefix: string,
  acc: Set<string>,
) {
  Object.keys(current).forEach((key) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    const currentValue = current[key];
    const defaultValue = defaults[key];
    if (isPlainObject(currentValue) && isPlainObject(defaultValue)) {
      collectDefaultPaths(currentValue, defaultValue, nextPrefix, acc);
      return;
    }
    if (defaultValue !== undefined && deepEqual(currentValue, defaultValue)) {
      acc.add(nextPrefix);
    }
  });
}

function buildConfigMetadata(config: FgbgUserConfig) {
  const defaults = getDefaultFgbgUserConfig();
  const defaultPaths = new Set<string>();
  collectDefaultPaths(config, defaults, "", defaultPaths);
  return {
    defaultPaths: Array.from(defaultPaths),
    protectedPaths: Array.from(PROTECTED_PATHS),
  };
}

function cloneConfig(config: FgbgUserConfig): FgbgUserConfig {
  if (typeof structuredClone === "function") {
    return structuredClone(config);
  }
  return JSON.parse(JSON.stringify(config));
}

function applyConfigPatch(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  Object.keys(patch).forEach((key) => {
    const newValue = patch[key];
    if (isPlainObject(newValue)) {
      if (!isPlainObject(target[key])) {
        target[key] = {};
      }
      applyConfigPatch(
        target[key] as Record<string, unknown>,
        newValue as Record<string, unknown>,
      );
      return;
    }
    target[key] = newValue;
  });
}

function hasProtectedPath(
  node: Record<string, unknown>,
  path: string[] = [],
): boolean {
  return Object.keys(node).some((key) => {
    const nested = node[key];
    const nextPath = [...path, key];
    if (PROTECTED_PATHS.has(nextPath.join("."))) {
      return true;
    }
    if (isPlainObject(nested)) {
      return hasProtectedPath(nested as Record<string, unknown>, nextPath);
    }
    return false;
  });
}

export function createWebLayer() {
  const router = Router();

  // API 路由：与 Agent 对话（流式输出）
  router.post("/chat", async (req, res) => {
    const { message } = req.body as { message?: string };
    if (!message) {
      return res.status(400).json({ error: "缺少消息内容" });
    }

    // 模型不可用时直接返回，避免进入 prompt 后才报 provider/auth 错误。
    // 设置 SSE 响应头。
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    writeNamedSse(res, "streamStart", { startedAt: Date.now() });
    writeNamedSse(res, "user_message_chunk", { content: message });

    let assistantTextSoFar = "";
    let thinkingTextSoFar = "";
    const toolStartedAt = new Map<string, number>();

    try {
      await runWithSingleFlight({
        message,
        channel: "web",
        onEvent: (event: RuntimeStreamEvent) => {
          if (event.type === "message_update") {
            const delta =
              typeof event.delta === "string"
                ? event.delta
                : typeof event.text === "string"
                  ? event.text.slice(assistantTextSoFar.length)
                  : "";
            if (delta) {
              assistantTextSoFar += delta;
              writeNamedSse(res, "agent_message_chunk", { content: delta });
            }
          }

          if (event.type === "message_end" && typeof event.text === "string") {
            assistantTextSoFar = event.text;
          }

          if (event.type === "thinking_update") {
            const chunk =
              typeof event.thinkingDelta === "string"
                ? event.thinkingDelta
                : typeof event.thinking === "string"
                  ? event.thinking.slice(thinkingTextSoFar.length)
                  : "";
            if (chunk) {
              thinkingTextSoFar += chunk;
              writeNamedSse(res, "agent_thought_chunk", { content: chunk });
            }
          }

          if (event.type === "tool_execution_start") {
            toolStartedAt.set(event.toolCallId, Date.now());
            const displayName = getToolDisplayName(event.toolName, event.alias);
            writeNamedSse(res, "tool_call", {
              id: event.toolCallId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              title: `正在执行 ${displayName}`,
              content: stringifySafe(event.args),
            });
          }

          if (event.type === "tool_execution_update") {
            const displayName = getToolDisplayName(event.toolName, event.alias);
            writeNamedSse(res, "tool_call_update", {
              id: event.toolCallId,
              toolCallId: event.toolCallId,
              status: "running",
              detail: `${displayName}执行中...`,
              content: stringifySafe(event.partialResult),
            });
          }

          if (event.type === "tool_execution_end") {
            const startedAt = toolStartedAt.get(event.toolCallId);
            const elapsedMs =
              typeof startedAt === "number" ? Date.now() - startedAt : 0;
            const displayName = getToolDisplayName(event.toolName, event.alias);
            writeNamedSse(res, "tool_call_update", {
              id: event.toolCallId,
              toolCallId: event.toolCallId,
              status: event.isError ? "error" : "completed",
              detail: event.isError
                ? `${displayName}执行失败 (${elapsedMs}ms)`
                : `${displayName}完成 (${elapsedMs}ms)`,
              content: stringifySafe(event.result),
            });
          }

          writeSse(res, event);
        },
        onBusy: () => {
          writeSse(res, { type: "error", error: "指令正在运行中，请稍后" });
        },
      });
    } catch (error) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(`[chat] ${runtimeError.message}`, error);
      if (error instanceof ModelUnavailableError) {
        writeNamedSse(res, "error", {
          error: error.message,
          provider: error.provider,
          model: error.model,
          detail: error.detail,
        });
        return;
      }

      writeSse(res, {
        type: "error",
        error: runtimeError.message,
      });
    } finally {
      writeNamedSse(res, "streamEnd", { endedAt: Date.now() });
      res.end();
    }
  });

  // API 路由：获取对话历史
  router.get("/history", async (_req, res) => {
    try {
      const history = getHistory();
      res.json({ success: true, history });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  // API 路由：清除对话历史
  router.post("/clear", async (_req, res) => {
    try {
      clearHistory();
      res.json({ success: true, message: "对话历史已清除" });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  router.get("/config/fgbg", (_req, res) => {
    try {
      const config = readFgbgUserConfig();
      res.json({
        success: true,
        config,
        metadata: buildConfigMetadata(config),
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/get] %s", runtimeError.message, runtimeError);
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  router.patch("/config/fgbg", async (req, res) => {
    const patchRaw = req.body && typeof req.body === "object" ? req.body : {};
    const patch = patchRaw as RecursivePartial<FgbgUserConfig>;
    if (hasProtectedPath(patch as Record<string, unknown>)) {
      return res.status(403).json({
        success: false,
        error: "尝试修改受保护字段（例如 qwen API Key），操作被拒绝。",
      });
    }

    try {
      const current = readFgbgUserConfig();
      const updated = cloneConfig(current);
      applyConfigPatch(
        updated as Record<string, unknown>,
        patch as Record<string, unknown>,
      );
      writeFgbgUserConfig(updated);
      evicateFgbgUserConfigCache();
      const refreshed = readFgbgUserConfig();
      res.json({
        success: true,
        config: refreshed,
        metadata: buildConfigMetadata(refreshed),
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/patch] %s", runtimeError.message, runtimeError);
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  router.post("/config/memory-search/test", async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const partial = (
        body as {
          memorySearch?: RecursivePartial<
            FgbgUserConfig["agents"]["memorySearch"]
          >;
        }
      ).memorySearch;
      const base = readFgbgUserConfig();
      const merged = mergeMemorySearchForTest(base, partial);
      const result = await testMemorySearchEmbedding(merged);
      if (result.ok) {
        res.json({
          success: true,
          mode: result.mode,
          dimensions: result.dimensions,
          durationMs: result.durationMs,
          ...(result.warning ? { warning: result.warning } : {}),
        });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[memory-search/test] %s",
        runtimeError.message,
        runtimeError,
      );
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  router.post("/config/memory-search/repair-local", async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const partial = (
        body as {
          memorySearch?: RecursivePartial<
            FgbgUserConfig["agents"]["memorySearch"]
          >;
        }
      ).memorySearch;
      const base = readFgbgUserConfig();
      const merged = mergeMemorySearchForTest(base, partial);
      const result = await repairLocalMemorySearchModel(merged);
      if (result.ok) {
        res.json({
          success: true,
          message: "已尝试下载或修复本地嵌入模型",
        });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[memory-search/repair-local] %s",
        runtimeError.message,
        runtimeError,
      );
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  router.post("/config/qwen-portal/oauth/start", async (_req, res) => {
    try {
      const { createQwenPortalDeviceSession } =
        await import("../../agent/auth/qwen-portal-oauth.js");
      const session = await createQwenPortalDeviceSession();
      const oauthSessionId = randomUUID();
      const expiresAt = Date.now() + session.expiresIn * 1000;
      const intervalMs = Math.max(
        1000,
        Math.round((session.intervalSec ?? 2) * 1000),
      );
      qwenOAuthSessions.set(oauthSessionId, {
        verifier: session.verifier,
        deviceCode: session.deviceCode,
        expiresAt,
        intervalMs,
      });
      setTimeout(
        () => {
          qwenOAuthSessions.delete(oauthSessionId);
        },
        session.expiresIn * 1000 + 60_000,
      );

      res.json({
        success: true,
        oauthSessionId,
        verificationUrl: session.verificationUrl,
        userCode: session.userCode,
        expiresIn: session.expiresIn,
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[qwen-oauth/start] %s",
        runtimeError.message,
        runtimeError,
      );
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  router.post("/config/qwen-portal/oauth/poll", async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const oauthSessionId =
      typeof (body as { oauthSessionId?: unknown }).oauthSessionId === "string"
        ? (body as { oauthSessionId: string }).oauthSessionId.trim()
        : "";
    if (!oauthSessionId) {
      return res.status(400).json({
        success: false,
        error: "缺少 oauthSessionId",
      });
    }

    const pending = qwenOAuthSessions.get(oauthSessionId);
    if (!pending || Date.now() > pending.expiresAt) {
      qwenOAuthSessions.delete(oauthSessionId);
      return res.status(400).json({
        success: false,
        error: "授权会话已过期或无效，请重新点击「Qwen 授权」。",
      });
    }

    try {
      const { pollQwenPortalDeviceToken } =
        await import("../../agent/auth/qwen-portal-oauth.js");
      const result = await pollQwenPortalDeviceToken(
        pending.deviceCode,
        pending.verifier,
      );

      if (result.status === "success") {
        saveQwenPortalCredentials(result.token);
        qwenOAuthSessions.delete(oauthSessionId);
        evicateFgbgUserConfigCache();
        return res.json({
          success: true,
          status: "success" as const,
        });
      }
      if (result.status === "pending") {
        return res.json({
          success: true,
          status: "pending" as const,
          slowDown: Boolean(result.slowDown),
        });
      }
      qwenOAuthSessions.delete(oauthSessionId);
      return res.json({
        success: false,
        status: "error" as const,
        error: result.message,
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[qwen-oauth/poll] %s",
        runtimeError.message,
        runtimeError,
      );
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  router.post("/config/fgbg/reset", (_req, res) => {
    try {
      const defaults = getDefaultFgbgUserConfig();
      writeFgbgUserConfig(defaults);
      evicateFgbgUserConfigCache();
      const refreshed = readFgbgUserConfig();
      res.json({
        success: true,
        config: refreshed,
        metadata: buildConfigMetadata(refreshed),
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/reset] %s", runtimeError.message, runtimeError);
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  // API 路由：根据 providerId 获取模型列表
  router.get("/config/models/:providerId", (req, res) => {
    try {
      const providerId = req.params.providerId;
      const config = readFgbgUserConfig();
      const provider = config.models.providers[providerId];
      if (!provider) {
        return res.status(404).json({
          success: false,
          error: `Provider "${providerId}" not found`,
        });
      }
      const models = (provider.models || []).map((m) => ({
        id: m.id,
        name: m.name,
      }));
      res.json({
        success: true,
        models,
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/models] %s", runtimeError.message, runtimeError);
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  // API 路由：获取所有支持的供应商列表
  router.get("/config/providers", (_req, res) => {
    try {
      const { buildImplicitProviderTemplates } = require("../../agent/pi-embedded-runner/model-config.js");
      const templates = buildImplicitProviderTemplates();
      const providers = Object.keys(templates).map((id) => {
        const template = templates[id];
        return {
          id,
          name: template?.models?.[0]?.name || id,
          baseUrl: template?.baseUrl || "",
          api: template?.api || "",
          isBuiltin: true,
        };
      });
      res.json({ success: true, providers });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/providers] %s", runtimeError.message, runtimeError);
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  // API 路由：获取指定供应商的详细配置
  router.get("/config/providers/:id", (req, res) => {
    try {
      const providerId = req.params.id;
      const { buildImplicitProviderTemplates } = require("../../agent/pi-embedded-runner/model-config.js");
      const templates = buildImplicitProviderTemplates();
      const template = templates[providerId];
      if (!template) {
        return res.status(404).json({
          success: false,
          error: `Provider "${providerId}" not found in built-in providers`,
        });
      }
      res.json({
        success: true,
        provider: {
          id: providerId,
          baseUrl: template.baseUrl,
          api: template.api,
          models: template.models,
          isBuiltin: true,
        },
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/providers/:id] %s", runtimeError.message, runtimeError);
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  // API 路由：获取默认供应商
  router.get("/config/default-provider", (_req, res) => {
    try {
      const { getDefaultModelProvider } = require("../../config/index.js");
      const defaultProvider = getDefaultModelProvider();
      res.json({ success: true, defaultProvider });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/default-provider] %s", runtimeError.message, runtimeError);
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  // API 路由：刷新日志配置缓存
  router.post("/config/logging/evict-cache", async (_req, res) => {
    try {
      const { evictLoggingConfigCache } =
        await import("../../logger/logger.js");
      evictLoggingConfigCache();
      res.json({
        success: true,
        message: "日志配置缓存已清除",
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[config/logging/evict] %s",
        runtimeError.message,
        runtimeError,
      );
      res.status(500).json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  // API 路由：获取 Agent 运行状态
  router.get("/status", (_req, res) => {
    const runtimeState = getAgentRuntimeState();
    res.json({
      success: true,
      runtime: runtimeState,
    });
  });

  return router;
}
