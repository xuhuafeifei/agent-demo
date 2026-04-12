import { Router } from "express";
import { clearHistory, getHistory } from "../../../agent/run.js";
import { readFgbgUserConfig } from "../../../config/index.js";

/**
 * History router: GET /history, POST /clear
 * 使用 web 渠道配置的 tenantId 获取/清除对话历史。
 */
export function createHistoryRouter() {
  const router = Router();

  // GET /history - Get conversation history (backend-defined limit)
  router.get("/", async (_req, res) => {
    try {
      // 从配置中获取 web 渠道的 tenantId
      const tenantId = readFgbgUserConfig().channels.web.tenantId;
      const history = getHistory(tenantId);
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

  // POST /clear - Clear conversation history
  router.post("/", async (_req, res) => {
    try {
      // 从配置中获取 web 渠道的 tenantId
      const tenantId = readFgbgUserConfig().channels.web.tenantId;
      clearHistory(tenantId);
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

  return router;
}
