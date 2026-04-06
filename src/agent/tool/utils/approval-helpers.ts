import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { approvalManager } from "../../approval-manager.js";
import type { AgentChannel } from "../../channel-policy.js";
import type { UnapprovableStrategy } from "../security/tool-security.model.js";

const approvalLogger = getSubsystemConsoleLogger("approval");

/**
 * 工具审批辅助函数
 *
 * 封装了 toolUseId 生成、请求审批、超时处理的完整流程。
 * 工具在执行前调用此函数，等待用户批准后再继续。
 */

/**
 * 判断当前渠道是否支持审批交互
 * Web 端支持，QQ 端无法交互
 */
function isChannelApprovable(channel?: AgentChannel): boolean {
  if (!channel) {
    approvalLogger.warn("channel is undefined, returning false");
    return false;
  }
  return channel === "web";
}

/**
 * 请求工具审批
 *
 * @param toolName 工具名称
 * @param args 工具参数（用于展示给用户）
 * @param options 可选配置
 * @returns Promise<boolean> - true=允许，false=拒绝/超时
 *
 * @example
 * ```typescript
 * const approved = await requestApproval("ShellExecute", { command: "rm -rf /tmp" }, { channel: "web" });
 * if (!approved) return { error: "用户拒绝执行" };
 * // 用户批准后才继续
 * ```
 */
export async function requestApproval(
  toolName: string,
  args: Record<string, unknown>,
  options?: {
    /** 当前渠道 */
    channel: AgentChannel;
    /** 不可审批时的策略 */
    unapprovableStrategy?: UnapprovableStrategy;
    /** 自定义超时时间（毫秒），默认 5 分钟 */
    timeoutMs?: number;
  },
): Promise<boolean> {
  // 如果当前渠道不支持审批，根据策略决定跳过或拒绝
  if (!isChannelApprovable(options?.channel)) {
    const strategy = options?.unapprovableStrategy ?? "reject";
    if (strategy === "skip") {
      // skip 策略：跳过审批，允许执行
      return true;
    }
    // reject 策略：拒绝执行
    return false;
  }

  const toolUseId = crypto.randomUUID();

  return approvalManager.request(toolUseId, toolName, args, {
    timeoutMs: options?.timeoutMs,
  });
}

/**
 * 带描述的审批请求（更好的前端展示）
 *
 * @param toolName 工具名称
 * @param args 工具参数
 * @param description 人类可读的描述（可选，前端展示用）
 * @returns Promise<boolean>
 *
 * @example
 * ```typescript
 * const approved = await requestApprovalWithDescription(
 *   "ShellExecute",
 *   { command: "rm -rf /tmp" },
 *   "删除 /tmp 目录下的所有文件",
 *   { channel: "qq", unapprovableStrategy: "skip" }
 * );
 * ```
 */
export async function requestApprovalWithDescription(
  toolName: string,
  args: Record<string, unknown>,
  description: string,
  options?: {
    channel: AgentChannel;
    unapprovableStrategy?: UnapprovableStrategy;
    timeoutMs?: number;
  },
): Promise<boolean> {
  return requestApproval(
    toolName,
    { ...args, _description: description },
    options,
  );
}
