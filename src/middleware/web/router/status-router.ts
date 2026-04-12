import { Router } from "express";
import { getAllRunningAgentStates } from "../../../agent/run.js";

/**
 * Status router: GET /status
 * 返回当前所有正在运行的 agent 状态（按租户隔离）。
 */
export function createStatusRouter() {
  const router = Router();

  router.get("/", (_req, res) => {
    const runtimeStates = getAllRunningAgentStates();
    res.json({
      success: true,
      runtime: runtimeStates,
    });
  });

  return router;
}
