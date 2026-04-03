import { Router } from "express";
import { readFgbgUserConfig } from "../../../config/index.js";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";

const webLogger = getSubsystemConsoleLogger("web");

/**
 * Providers config router: /config/providers, /config/models, /config/default-provider
 */
export function createProvidersRouter() {
  const router = Router();

  // GET /config/providers - Get all built-in provider templates
  router.get("/", (_req, res) => {
    try {
      const { buildImplicitProviderTemplates } = require("../../../agent/pi-embedded-runner/model-config.js");
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

  // GET /config/providers/:id - Get detailed provider info
  router.get("/:id", (req, res) => {
    try {
      const providerId = req.params.id;
      const { buildImplicitProviderTemplates } = require("../../../agent/pi-embedded-runner/model-config.js");
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

  // GET /config/models/:providerId - Get models for a provider
  router.get("/models/:providerId", (req, res) => {
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

  // GET /config/default-provider - Get default model provider
  router.get("/default-provider", (_req, res) => {
    try {
      const { getDefaultModelProvider } = require("../../../config/index.js");
      const defaultProvider = getDefaultModelProvider();
      res.json({ success: true, defaultProvider });
    } catch (error: unknown) {
      const runtimeError =
        error instanceof Error ? error : new Error("服务器内部错误");
      webLogger.error("[config/default-provider] %s", runtimeError.message, runtimeError);
      res.status(500).json({ success: false, error: runtimeError.message });
    }
  });

  return router;
}
