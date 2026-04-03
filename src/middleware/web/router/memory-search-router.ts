import { Router } from "express";
import { readFgbgUserConfig } from "../../../config/index.js";
import {
  repairLocalMemorySearchModel,
  testMemorySearchEmbedding,
} from "../../../memory/embedding/embedding-provider.js";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import type { FgbgUserConfig } from "../../../types.js";
import type { RecursivePartial } from "../services/service.js";
import { mergeMemorySearchForTest } from "../services/service.js";

const webLogger = getSubsystemConsoleLogger("web");

/**
 * Memory search config router: /config/memory-search
 */
export function createMemorySearchRouter() {
  const router = Router();

  // POST /config/memory-search/test - Test memory embedding
  router.post("/test", async (req, res) => {
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

  // POST /config/memory-search/repair-local - Repair local GGUF model
  router.post("/repair-local", async (req, res) => {
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

  return router;
}
