import { Router } from "express";
import { readFgbgUserConfig, getDefaultModelProvider } from "../../../config/index.js";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { buildImplicitProviderTemplates } from "../../../agent/pi-embedded-runner/model-config.js";

const webLogger = getSubsystemConsoleLogger("web");

/**
 * Providers config router
 *
 * 路由结构：
 *   GET /config/providers        - 获取所有已配置的 provider（从 fgbg.json，有 apiKey 的）
 *   GET /config/builtin-templates - 获取系统内置支持的 provider 模板（用于"添加供应商"弹窗）
 *   GET /config/provider-info?id=xxx - 获取单个内置模板详情
 *   GET /config/default          - 获取默认提供商
 */
export function createProvidersRouter() {
  const router = Router();

  // GET /config/providers - 获取已配置的 provider 列表（从 fgbg.json 中读取，有 apiKey 的）
  router.get("/providers", (_req, res) => {
    try {
      const config = readFgbgUserConfig();
      const providersConfig = config.models?.providers || {};
      
      const configuredProviders = Object.entries(providersConfig)
        .filter(([_, providerCfg]: [string, any]) => {
          // 只返回有 apiKey 的已配置 provider
          return providerCfg.apiKey && providerCfg.apiKey.trim().length > 0;
        })
        .map(([id, providerCfg]: [string, any]) => ({
          id,
          name: providerCfg.models?.[0]?.name || id,
          baseUrl: providerCfg.baseUrl || "",
          api: providerCfg.api || "openai-completions",
          enabled: providerCfg.enabled !== false,
          models: providerCfg.models || [],
        }));

      res.json({ success: true, providers: configuredProviders });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/providers] %s", runtimeError.message, runtimeError);
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  // GET /config/builtin-templates - 获取系统内置支持的 provider 模板（用于"添加供应商"弹窗）
  router.get("/builtin-templates", (_req, res) => {
    try {
      const templates = buildImplicitProviderTemplates();
      const templateList = Object.entries(templates).map(([id, template]: [string, any]) => ({
        id,
        name: template.models?.[0]?.name || id,
        baseUrl: template.baseUrl || "",
        api: template.api || "openai-completions",
        models: template.models || [],
      }));
      res.json({ success: true, templates: templateList });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/builtin-templates] %s", runtimeError.message, runtimeError);
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
      webLogger.error("[config/provider-info] %s", runtimeError.message, runtimeError);
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

  // GET /config/default - 获取默认提供商
  router.get("/default", (_req, res) => {
    try {
      const defaultProvider = getDefaultModelProvider();
      res.json({ success: true, defaultProvider });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/default] %s", runtimeError.message, runtimeError);
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  // POST /config/test-connection - 测试模型连接
  router.post("/test-connection", async (req, res) => {
    try {
      const { baseUrl, apiKey, model, api } = req.body;
      
      if (!baseUrl || !apiKey || !model) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: baseUrl, apiKey, model",
        });
      }

      const apiUrl = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
      const requestBody = {
        model,
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(200).json({
          success: false,
          error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
        });
      }

      const data = await response.json();
      res.json({
        success: true,
        message: "连接成功",
        responseTime: Date.now(),
      });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      
      if (runtimeError.name === "AbortError") {
        return res.json({
          success: false,
          error: "连接超时（10秒）",
        });
      }
      
      webLogger.error("[config/test-connection] %s", runtimeError.message, runtimeError);
      res.json({
        success: false,
        error: runtimeError.message,
      });
    }
  });

  return router;
}
