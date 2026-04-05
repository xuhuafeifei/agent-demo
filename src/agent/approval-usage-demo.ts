/**
 * 工具审批使用示例（纯注释文档，无可 import 的运行代码；实现见 approval-manager.ts、approval-helpers.ts）
 *
 * ============================================================
 *  方式一：直接使用 approvalManager（底层）
 * ============================================================
 *
 * import { approvalManager } from "../agent/approval-manager.js";
 *
 * async function executeShell(params: { command: string }) {
 *   const toolUseId = crypto.randomUUID();
 *   const approved = await approvalManager.request(
 *     toolUseId,
 *     "ShellExecute",
 *     { command: params.command },
 *     { timeoutMs: 5 * 60 * 1000 },
 *   );
 *   if (!approved) return { error: "用户拒绝" };
 *   const { stdout, stderr } = await exec(params.command);
 *   return { success: true, stdout, stderr };
 * }
 *
 * ============================================================
 *  方式二：使用 requestApproval 辅助函数（推荐）
 * ============================================================
 *
 * import { requestApproval } from "./approval-helpers.js";
 *
 * async function executeShell(params: { command: string }) {
 *   const approved = await requestApproval("ShellExecute", {
 *     command: params.command,
 *   });
 *   if (!approved) return { error: "用户拒绝" };
 *   const { stdout, stderr } = await exec(params.command);
 *   return { success: true, stdout, stderr };
 * }
 *
 * ============================================================
 *  实际案例：memorySearch 工具（已接入）
 * ============================================================
 *
 * 见 src/agent/tool/memory-search.ts 的 execute 方法：
 *
 *   const approved = await requestApproval("memorySearch", {
 *     query: params.query,
 *     topKFts: params.topKFts,
 *     topKVector: params.topKVector,
 *     topN: params.topN,
 *   });
 *   if (!approved) {
 *     return errResult("用户拒绝了 memorySearch 执行请求", { ... });
 *   }
 *   // 用户批准后才执行实际搜索
 *
 * ============================================================
 *  完整时序
 * ============================================================
 *
 *  1. LLM 决定调用 memorySearch
 *  2. execute() 调用 requestApproval()
 *     → 后端通过 SSE 推送 permission_request 事件给前端
 *     → requestApproval() 返回 Promise，挂起等待
 *  3. 前端收到 SSE → chatStore.addPermissionRequest()
 *     → 对话时间线内嵌审批卡片（工具名 + 参数 + 允许/拒绝）
 *  4. 用户点击"允许" → 前端 POST /api/approve {toolUseId, approved: true}
 *  5. 后端 approvalManager.approve() resolve Promise → true
 *  6. execute() 恢复执行，调用 MemoryIndexManager.search()
 */

export {};
