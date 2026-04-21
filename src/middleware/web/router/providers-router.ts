import { Router } from "express";
import {
  readFgbgUserConfig,
  getDefaultModelProvider,
} from "../../../config/index.js";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { buildImplicitProviderTemplates } from "../../../agent/pi-embedded-runner/model-config.js";
import { buildQwenPortalProbeChatCompletionBody } from "../../../agent/qwen-dashscope.js";
import {
  validateRequest,
  testConnectionRequestSchema,
} from "../utils/validators.js";

const webLogger = getSubsystemConsoleLogger("web");

/**
 * Providers config router
 */
export function createProvidersRouter() {
  const router = Router();

  // GET /config/providers - 获取已配置的 provider 列表
  router.get("/providers", (_req, res) => {
    try {
      const config = readFgbgUserConfig();
      const providersConfig = config.models?.providers || {};
      const configuredProviders = Object.entries(providersConfig)
        .filter(([, cfg]: [string, any]) => Boolean(cfg.apiKey?.trim()))
        .map(([id, cfg]: [string, any]) => ({
          id,
          name: cfg.models?.[0]?.name || id,
          baseUrl: cfg.baseUrl || "",
          api: cfg.api || "openai-completions",
          enabled: cfg.enabled !== false,
          models: cfg.models || [],
        }));
      res.json({ success: true, providers: configuredProviders });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[config/providers] %s",
        runtimeError.message,
        runtimeError,
      );
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  // GET /config/builtin-templates - 获取内置模板
  router.get("/builtin-templates", (_req, res) => {
    try {
      const templates = buildImplicitProviderTemplates();
      const templateList = Object.entries(templates).map(
        ([id, t]: [string, any]) => ({
          id,
          name: t.models?.[0]?.name || id,
          baseUrl: t.baseUrl || "",
          api: t.api || "openai-completions",
          models: t.models || [],
        }),
      );
      res.json({ success: true, templates: templateList });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[config/builtin-templates] %s",
        runtimeError.message,
        runtimeError,
      );
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  // GET /config/provider-info?id=xxx - 获取单个内置模板详情
  router.get("/provider-info", (req, res) => {
    try {
      const providerId = req.query.id as string;
      if (!providerId) {
        return res.status(400).json({
          success: false,
          error: "Missing required query parameter: id",
        });
      }
      const templates = buildImplicitProviderTemplates();
      const template = templates[providerId];
      if (!template) {
        return res.status(404).json({
          success: false,
          error: `Provider "${providerId}" not found`,
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
      webLogger.error(
        "[config/provider-info] %s",
        runtimeError.message,
        runtimeError,
      );
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  // GET /config/models?providerId=xxx - 获取某提供商的模型列表
  router.get("/models", (req, res) => {
    try {
      const providerId = req.query.providerId as string;
      if (!providerId) {
        return res.status(400).json({
          success: false,
          error: "Missing required query parameter: providerId",
        });
      }
      const config = readFgbgUserConfig();
      const provider = config.models.providers[providerId];
      if (!provider) {
        return res.status(404).json({
          success: false,
          error: `Provider "${providerId}" not found`,
        });
      }
      const models = (provider.models || []).map((m: any) => ({
        id: m.id,
        name: m.name,
      }));
      res.json({ success: true, models });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/models] %s", runtimeError.message, runtimeError);
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  // GET /config/default - 获取默认提供商
  router.get("/default", (_req, res) => {
    try {
      const defaultProvider = getDefaultModelProvider();
      res.json({ success: true, defaultProvider });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error(
        "[config/default] %s",
        runtimeError.message,
        runtimeError,
      );
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  // POST /config/test-connection - 测试模型连接
  router.post("/test-connection", async (req, res) => {
    try {
      // 校验请求体
      const validation = validateRequest(testConnectionRequestSchema, req.body);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: validation.error,
        });
      }

      if (!validation.data) {
        return res.status(400).json({
          success: false,
          error: "请求数据无效",
        });
      }

      const baseUrl = validation.data.baseUrl;
      const apiKey = validation.data.apiKey;
      const model = validation.data.model;
      const providerId = validation.data.providerId;

      const apiUrl = `${baseUrl.toString().replace(/\/+$/, "")}/chat/completions`;

      const isQwenProvider = providerId === "qwen-portal";
      // qwen-portal 需要特殊处理
      const requestBody: Record<string, unknown> = isQwenProvider
        ? buildQwenPortalProbeChatCompletionBody({
            model: model,
          })
        : {
            model,
            messages: [
              {
                role: "user",
                content: "测试连接",
              },
            ],
            max_tokens: 20,
          };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };

      // 只有 qwen-portal 需要特殊的 headers
      if (isQwenProvider) {
        headers["User-Agent"] = "QwenCode/0.13.2 (darwin; arm64)";
        headers["X-DashScope-CacheControl"] = "enable";
        headers["X-DashScope-UserAgent"] = "QwenCode/0.13.2 (darwin; arm64)";
        headers["X-DashScope-AuthType"] = "openai";
      }

      // debug调试日志, 如果出现qwen 连接失败, 可以解除注释查看
      // webLogger.debug(
      //   `[test-connection] URL: ${apiUrl}, isQwen: ${isQwenProvider}`,
      // );
      // webLogger.debug(JSON.stringify(requestBody, null, 2));
      // webLogger.debug(JSON.stringify(headers, null, 2));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        webLogger.error(
          `[test-connection] HTTP ${response.status}: ${errorText}`,
        );
        return res.json({
          success: false,
          error: `HTTP ${response.status}: ${errorText.slice(0, 500)}`,
        });
      }
      res.json({ success: true, message: "连接成功" });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      if (runtimeError.name === "AbortError") {
        return res.json({ success: false, error: "连接超时（10秒）" });
      }
      webLogger.error(
        "[config/test-connection] %s",
        runtimeError.message,
        runtimeError,
      );
      res.json({ success: false, error: runtimeError.message });
    }
  });

  return router;
}
