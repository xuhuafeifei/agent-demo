import { type Response, Router } from "express";
import {
  clearHistory,
  getHistory,
  getReplyFromAgent,
  ModelUnavailableError,
} from "../agent/run";
import type { RuntimeStreamEvent } from "../agent/utils/events";

function writeSse(res: Response, data: RuntimeStreamEvent): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
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

    try {
      await getReplyFromAgent({
        message,
        onEvent: (event) => {
          writeSse(res, event);
        },
      });
    } catch (error) {
      if (error instanceof ModelUnavailableError) {
        return res.status(503).json({
          error: error.message,
          provider: error.provider,
          model: error.model,
          detail: error.detail,
        });
      }

      writeSse(res, {
        type: "error",
        error: error instanceof Error ? error.message : "服务器内部错误",
      });
    } finally {
      res.end();
    }
  });

  // API 路由：获取对话历史
  router.get("/history", async (_req, res) => {
    try {
      const history = getHistory();
      res.json({ success: true, history });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "服务器内部错误",
      });
    }
  });

  // API 路由：清除对话历史
  router.post("/clear", async (_req, res) => {
    try {
      clearHistory();
      res.json({ success: true, message: "对话历史已清除" });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "服务器内部错误",
      });
    }
  });

  return router;
}
