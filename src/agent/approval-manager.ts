import type { Response } from "express";

/**
 * 一个等待中的审批请求
 */
interface PendingApproval {
  toolUseId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** 用于 resolve 审批结果 */
  resolve: (approved: boolean) => void;
  /** 超时定时器 ID */
  timeoutTimer: NodeJS.Timeout;
}

/**
 * ApprovalManager - 全局工具审批管理器
 *
 * 职责：
 * 1. 工具执行前调用 request() 创建审批，挂起等待
 * 2. 前端通过 POST /api/approve 调用 approve() 完成审批
 * 3. request() 返回 Promise，resolved 后工具继续执行
 */
class ApprovalManager {
  private pending = new Map<string, PendingApproval>();
  private activeRes: Response | null = null;
  private DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟超时

  /**
   * 设置当前活跃的 SSE response（每个 chat 请求进来时设置）
   */
  setActiveRes(res: Response) {
    this.activeRes = res;
  }

  clearActiveRes() {
    this.activeRes = null;
  }

  /**
   * 请求审批（工具侧调用）
   *
   * @param toolUseId 唯一标识
   * @param toolName  工具名
   * @param args      工具参数（展示用）
   * @param options   可选：timeoutMs 覆盖默认 5 分钟
   * @returns Promise<boolean> - true=允许，false=拒绝/超时
   */
  request(
    toolUseId: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<boolean> {
    const timeoutMs = options?.timeoutMs ?? this.DEFAULT_TIMEOUT_MS;
    return new Promise<boolean>((resolve) => {
      const timeoutTimer = setTimeout(() => {
        this.pending.delete(toolUseId);
        resolve(false);
      }, timeoutMs);

      const pending: PendingApproval = {
        toolUseId,
        toolName,
        args,
        resolve,
        timeoutTimer,
      };

      this.pending.set(toolUseId, pending);

      this.sendPermissionRequest(pending);
    });
  }

  /**
   * 完成审批（前端 POST /api/approve 调用）
   *
   * @param toolUseId 审批 ID
   * @param approved  true=允许，false=拒绝
   * @returns boolean 是否成功找到 pending 项
   */
  approve(toolUseId: string, approved: boolean): boolean {
    const pending = this.pending.get(toolUseId);
    if (!pending) return false;

    clearTimeout(pending.timeoutTimer);
    this.pending.delete(toolUseId);
    pending.resolve(approved);
    return true;
  }

  /**
   * 查询当前所有 pending 的审批（前端轮询用，可选）
   */
  getPending() {
    return Array.from(this.pending.values()).map((p) => ({
      toolUseId: p.toolUseId,
      toolName: p.toolName,
      args: p.args,
    }));
  }

  /**
   * 取消所有 pending 审批（会话结束时调用）
   */
  cancelAll() {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeoutTimer);
      pending.resolve(false);
    }
    this.pending.clear();
  }

  // -- 内部方法 --

  /** 拒绝并清理 Map / 定时器（与 approve 对称） */
  private finalizeRejected(pending: PendingApproval) {
    clearTimeout(pending.timeoutTimer);
    this.pending.delete(pending.toolUseId);
    pending.resolve(false);
  }

  private sendPermissionRequest(pending: PendingApproval) {
    if (!this.activeRes) {
      console.warn(
        `[ApprovalManager] 无活跃 SSE 连接，自动拒绝: ${pending.toolUseId}`,
      );
      this.finalizeRejected(pending);
      return;
    }

    try {
      this.activeRes.write(`event: permission_request\n`);
      this.activeRes.write(
        `data: ${JSON.stringify({
          type: "permission_request",
          toolUseId: pending.toolUseId,
          toolName: pending.toolName,
          args: pending.args,
          timestamp: Date.now(),
        })}\n\n`,
      );
    } catch (e) {
      console.error(`[ApprovalManager] SSE 写入失败:`, e);
      this.finalizeRejected(pending);
    }
  }
}

// 全局单例
export const approvalManager = new ApprovalManager();
