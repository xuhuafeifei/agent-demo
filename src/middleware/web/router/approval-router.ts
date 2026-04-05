import { Router } from "express";
import { approvalManager } from "../../../agent/approval-manager.js";

/**
 * Approval router: POST /api/approve
 *
 * 前端用户点击"允许"/"拒绝"后调用此路由。
 * 后端收到后 resolve 对应的 pending 审批，工具继续/中止执行。
 */
export function createApprovalRouter() {
  const router = Router();

  router.post("/", (req, res) => {
    const { toolUseId, approved } = req.body as {
      toolUseId?: string;
      approved?: boolean;
    };

    if (!toolUseId) {
      return res.status(400).json({ error: "缺少 toolUseId" });
    }

    if (typeof approved !== "boolean") {
      return res.status(400).json({ error: "approved 必须是布尔值" });
    }

    const ok = approvalManager.approve(toolUseId, approved);
    if (!ok) {
      return res.status(404).json({
        error: "审批不存在或已处理",
        toolUseId,
      });
    }

    res.json({ ok: true, toolUseId, approved });
  });

  /**
   * 可选：获取当前 pending 列表（调试用）
   */
  router.get("/pending", (_req, res) => {
    res.json({ pending: approvalManager.getPending() });
  });

  return router;
}
