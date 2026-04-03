import { Router } from "express";
import { getAgentRuntimeState } from "../../../agent/run.js";

/**
 * Status router: GET /status
 */
export function createStatusRouter() {
  const router = Router();

  router.get("/", (_req, res) => {
    const runtimeState = getAgentRuntimeState();
    res.json({
      success: true,
      runtime: runtimeState,
    });
  });

  return router;
}
