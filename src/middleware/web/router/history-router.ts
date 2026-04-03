import { Router } from "express";
import { clearHistory, getHistory } from "../../../agent/run.js";

/**
 * History router: GET /history, POST /clear
 */
export function createHistoryRouter() {
  const router = Router();

  // GET /history - Get conversation history (backend-defined limit)
  router.get("/", async (_req, res) => {
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

  // POST /clear - Clear conversation history
  router.post("/", async (_req, res) => {
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

  return router;
}
