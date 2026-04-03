import { Router } from "express";
import { createChatRouter } from "./router/chat-router.js";
import { createHistoryRouter } from "./router/history-router.js";
import { createStatusRouter } from "./router/status-router.js";
import { createFgbgRouter } from "./router/fgbg-router.js";
import { createMemorySearchRouter } from "./router/memory-search-router.js";
import { createProvidersRouter } from "./router/providers-router.js";
import { createLoggingRouter } from "./router/logging-router.js";
import { createOAuthRouter } from "./router/oauth-router.js";

/**
 * Create the web layer router.
 * This router is responsible for assembling all sub-routers.
 * Suggested mount path: /api or /api/v1
 */
export function createWebLayer() {
  const router = Router();

  // Mount sub-routers
  router.use("/chat", createChatRouter());
  router.use("/history", createHistoryRouter());
  router.use("/status", createStatusRouter());

  // Config routers
  router.use("/config/fgbg", createFgbgRouter());
  router.use("/config/memory-search", createMemorySearchRouter());
  router.use("/config", createProvidersRouter());
  router.use("/config/logging", createLoggingRouter());
  router.use("/config/qwen-portal/oauth", createOAuthRouter());

  return router;
}
