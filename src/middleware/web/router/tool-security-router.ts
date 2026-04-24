import { Router } from "express";
import {
  readFgbgUserConfig,
  writeFgbgUserConfig,
  getDefaultFgbgUserConfig,
  evicateFgbgUserConfigCache,
} from "../../../config/index.js";
import {
  getConfigByPreset,
  resolveToolSecurityConfig,
  type ToolSecurityConfig,
  type ToolMode,
} from "../../../agent/tool/security/index.js";
import { CHOOSEABLE_TOOLS_CATALOG } from "../../../agent/tool/tool-catalog.js";

/**
 * 获取系统实际可用的工具列表（从工具目录动态获取）
 * 这是"有哪些工具"的权威来源，与 fgbg.json 配置无关
 */
function getChoosableToolNames(): string[] {
  // 从 TOOL_CATALOG 获取所有工具名（去重，因为 read/readFile 指向同一 entry）
  return [...new Set(Object.keys(CHOOSEABLE_TOOLS_CATALOG))];
}

/**
 * 校验工具安全配置
 */
function validateToolSecurityConfig(
  config: Partial<ToolSecurityConfig>,
): string | null {
  // 校验 preset
  if (
    config.preset &&
    !["safety", "guard", "yolo", "custom"].includes(config.preset)
  ) {
    return "preset 必须是 safety, guard, yolo 或 custom 之一";
  }

  // 校验 enabledTools
  if (config.enabledTools !== undefined) {
    if (!Array.isArray(config.enabledTools)) {
      return "enabledTools 必须是数组";
    }
    for (const tool of config.enabledTools) {
      if (typeof tool !== "string" || !tool.trim()) {
        return "enabledTools 中的每个工具名必须是非空字符串";
      }
    }
  }

  // 校验 denyPaths
  if (config.denyPaths !== undefined) {
    if (typeof config.denyPaths !== "string") {
      return "denyPaths 必须是字符串";
    }
  }

  // 校验 access
  if (config.access) {
    if (
      !["workspace", "user-home", "system"].includes(config.access.scope || "")
    ) {
      return "access.scope 必须是 workspace, user-home 或 system 之一";
    }
    if (typeof config.access.allowHiddenFiles !== "boolean") {
      return "access.allowHiddenFiles 必须是布尔值";
    }
    if (typeof config.access.allowSymlinks !== "boolean") {
      return "access.allowSymlinks 必须是布尔值";
    }
  }

  // 校验 approval
  if (config.approval) {
    if (typeof config.approval.enabled !== "boolean") {
      return "approval.enabled 必须是布尔值";
    }
    if (config.approval.requireApprovalFor !== undefined) {
      if (!Array.isArray(config.approval.requireApprovalFor)) {
        return "approval.requireApprovalFor 必须是数组";
      }
      for (const tool of config.approval.requireApprovalFor) {
        if (typeof tool !== "string" || !tool.trim()) {
          return "approval.requireApprovalFor 中的每个工具名必须是非空字符串";
        }
      }
    }
    if (config.approval.timeoutMs !== undefined) {
      if (
        typeof config.approval.timeoutMs !== "number" ||
        config.approval.timeoutMs <= 0
      ) {
        return "approval.timeoutMs 必须是正整数";
      }
    }
  }

  // 校验 unapprovableStrategy
  if (
    config.unapprovableStrategy !== undefined &&
    !["skip", "reject"].includes(config.unapprovableStrategy)
  ) {
    return "unapprovableStrategy 必须是 skip 或 reject 之一";
  }

  return null;
}

/**
 * 创建工具安全配置路由器
 */
export function createToolSecurityRouter(): Router {
  const router = Router();

  /**
   * GET / - 获取工具安全配置
   * 如果 preset 是 safety/guard/yolo，返回对应模式的默认配置
   * 如果是 custom，返回用户保存的自定义 配置
   */
  router.get("/", (_req, res) => {
    try {
      const savedConfig = readFgbgUserConfig().toolSecurity;
      const resolved = resolveToolSecurityConfig(savedConfig);

      // 获取所有可用的工具列表（从实际注册的工具目录动态获取）
      const choosableTools = getChoosableToolNames();

      // 根据 preset 决定返回哪个配置
      let resultConfig;
      const preset = resolved.preset || "guard";

      if (preset === "custom") {
        // custom 模式：返回用户保存的实际配置
        resultConfig = {
          preset: "custom",
          enabledTools: resolved.enabledTools || [],
          denyPaths: Array.isArray(resolved.denyPaths)
            ? resolved.denyPaths.join("\n")
            : resolved.denyPaths || "",
          access: resolved.access || {
            scope: "workspace",
            allowHiddenFiles: false,
            allowSymlinks: false,
          },
          approval: resolved.approval || {
            enabled: true,
            requireApprovalFor: [],
            timeoutMs: 300000,
          },
          unapprovableStrategy: resolved.unapprovableStrategy || "reject",
        };
      } else {
        // 内置模式：返回对应模式的默认配置
        const presetConfig = getConfigByPreset(preset as ToolMode);
        resultConfig = {
          preset: presetConfig.preset,
          enabledTools: presetConfig.enabledTools,
          denyPaths: Array.isArray(presetConfig.denyPaths)
            ? presetConfig.denyPaths.join("\n")
            : "",
          access: presetConfig.access,
          approval: presetConfig.approval,
          unapprovableStrategy: presetConfig.unapprovableStrategy || "reject",
        };
      }

      res.json({
        success: true,
        config: resultConfig,
        choosableTools,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "获取配置失败",
      });
    }
  });

  /**
   * PATCH / - 保存工具安全配置
   * - 内置模式（safety/guard/yolo）：持久化 `getConfigByPreset` 的完整系统默认（忽略前端附带字段）
   * - Custom 模式：持久化前端提交的完整配置
   */
  router.patch("/", async (req, res) => {
    try {
      const { config: rawConfig } = req.body;

      if (!rawConfig || typeof rawConfig !== "object") {
        return res.status(400).json({
          success: false,
          error: "config 字段必须是一个对象",
        });
      }

      const config = rawConfig as ToolSecurityConfig;

      // 校验 preset 字段
      if (
        config.preset &&
        !["safety", "guard", "yolo", "custom"].includes(config.preset)
      ) {
        return res.status(400).json({
          success: false,
          error: `不支持的内置模式: ${config.preset}。仅支持 safety, guard, yolo, custom`,
        });
      }

      // 读取当前配置
      const currentConfig = readFgbgUserConfig();

      if (config.preset && config.preset !== "custom") {
        // 内置模式：写入该预设的完整默认配置（避免仅改 preset 导致与默认不一致的脏字段残留）
        currentConfig.toolSecurity = structuredClone(
          getConfigByPreset(config.preset as ToolMode),
        );
      } else {
        // Custom 模式：保存前端传递的完整配置数据
        const validationError = validateToolSecurityConfig(rawConfig);
        if (validationError) {
          return res.status(400).json({
            success: false,
            error: validationError,
          });
        }
        currentConfig.toolSecurity = config;
      }

      writeFgbgUserConfig(currentConfig);
      evicateFgbgUserConfigCache();

      // 解析配置
      const resolved = resolveToolSecurityConfig(currentConfig.toolSecurity);
      const choosableTools = getChoosableToolNames();

      res.json({
        success: true,
        config: {
          preset: resolved.preset || "custom",
          enabledTools: resolved.enabledTools || [],
          denyPaths: Array.isArray(resolved.denyPaths)
            ? resolved.denyPaths.join("\n")
            : resolved.denyPaths || "",
          access: resolved.access || {
            scope: "workspace",
            allowHiddenFiles: false,
            allowSymlinks: false,
          },
          approval: resolved.approval || {
            enabled: true,
            requireApprovalFor: [],
            timeoutMs: 300000,
          },
          unapprovableStrategy: resolved.unapprovableStrategy || "reject",
        },
        choosableTools,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "保存配置失败",
      });
    }
  });

  /**
   * POST /reset - 重置工具安全配置
   */
  router.post("/reset", (_req, res) => {
    try {
      const defaultConfig = getDefaultFgbgUserConfig();
      const currentConfig = readFgbgUserConfig();
      currentConfig.toolSecurity = defaultConfig.toolSecurity;
      writeFgbgUserConfig(currentConfig);
      evicateFgbgUserConfigCache();

      const resolved = resolveToolSecurityConfig(currentConfig.toolSecurity);
      const choosableTools = getChoosableToolNames();

      res.json({
        success: true,
        config: {
          preset: resolved.preset || "guard",
          enabledTools: resolved.enabledTools || [],
          denyPaths: Array.isArray(resolved.denyPaths)
            ? resolved.denyPaths.join("\n")
            : resolved.denyPaths || "",
          access: resolved.access || {
            scope: "workspace",
            allowHiddenFiles: false,
            allowSymlinks: false,
          },
          approval: resolved.approval || {
            enabled: true,
            requireApprovalFor: [],
            timeoutMs: 300000,
          },
          unapprovableStrategy: resolved.unapprovableStrategy || "reject",
        },
        choosableTools,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "重置配置失败",
      });
    }
  });

  /**
   * POST /import/:preset - 从预设导入配置
   */
  router.post("/import/:preset", (req, res) => {
    try {
      const preset = req.params.preset as ToolMode;

      if (!["safety", "guard", "yolo"].includes(preset)) {
        return res.status(400).json({
          success: false,
          error: `不支持的内置模式: ${preset}。仅支持 safety, guard, yolo`,
        });
      }

      const presetConfig = getConfigByPreset(preset);

      res.json({
        success: true,
        config: {
          preset: presetConfig.preset,
          enabledTools: presetConfig.enabledTools,
          denyPaths: Array.isArray(presetConfig.denyPaths)
            ? presetConfig.denyPaths.join("\n")
            : "",
          access: presetConfig.access,
          approval: presetConfig.approval,
          unapprovableStrategy: presetConfig.unapprovableStrategy || "reject",
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "导入预设配置失败",
      });
    }
  });

  return router;
}
