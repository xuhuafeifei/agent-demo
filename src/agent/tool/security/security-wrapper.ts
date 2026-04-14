/**
 * 工具安全 Wrapper（AOP 式横切关注点织入）
 *
 * 核心思想：
 * - 每个工具在注册时声明自己需要哪些安全检查（checks）
 * - createToolBundle 在装配阶段自动织入 wrapper
 * - 工具核心代码保持干净，不关心配置读取、审批、路径检查
 *
 * 执行顺序固定（不受注册顺序影响）：
 *   1. pathCheck             — 路径合法性校验
 *   2. channelRuntimeAssert  — 通道/租户一致性
 *   3. approval              — 用户审批（必须在所有校验通过后）
 */

import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { AgentChannel } from "../../channel-policy.js";
import { assertRuntimeChannelTenantMatch } from "../utils/channel-runtime-assert.js";
import { errResult } from "../tool-result.js";
import { checkPathSafety } from "./path-checker.js";
import { requiresApproval } from "../tool-approval.js";
import { requestApprovalWithDescription } from "../utils/approval-helpers.js";
import { readFgbgUserConfig } from "../../../config/index.js";
import { resolveToolSecurityConfig } from "./tool-security.resolve.js";

// ===== 检查规格定义 =====

export interface PathCheckSpec {
  type: "pathCheck";
  param: string;
}

export interface ApprovalSpec {
  type: "approval";
  param: string;
  description: string;
}

export interface ChannelRuntimeAssertSpec {
  type: "channelRuntimeAssert";
  channelParam: string;
  tenantParam: string;
  mismatchHint: string;
}

export type ToolCheckSpec =
  | PathCheckSpec
  | ApprovalSpec
  | ChannelRuntimeAssertSpec;

// ===== Wrapper =====

/**
 * 为工具实例织入安全检查 wrapper。
 * 检查按固定顺序执行：pathCheck → channelRuntimeAssert → approval
 */
export function wrapToolWithCheck(
  tool: ToolDefinition<any, any>,
  checks: ToolCheckSpec[],
  cwd: string,
  tenantId: string,
  channel: AgentChannel,
  _agentId: string,
): ToolDefinition<any, any> {
  if (checks.length === 0) return tool;

  const originalExecute = tool.execute.bind(tool);

  // 这里保留数组：同一阶段允许注册多条规则，用于校验多个参数（例如 path、targetPath）。
  const pathChecks = checks.filter(
    (c) => c.type === "pathCheck",
  ) as PathCheckSpec[];
  const channelAsserts = checks.filter(
    (c) => c.type === "channelRuntimeAssert",
  ) as ChannelRuntimeAssertSpec[];
  const approvals = checks.filter(
    (c) => c.type === "approval",
  ) as ApprovalSpec[];

  const config = () => {
    const c = readFgbgUserConfig();
    return resolveToolSecurityConfig(c.toolSecurity);
  };

  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      // Phase 1: 路径检查
      for (const spec of pathChecks) {
        const filePath = params[spec.param];
        if (!filePath) continue;
        const result = await checkPathSafety(filePath, cwd, config());
        if (!result.allowed) {
          return errResult(`路径 '${filePath}' 不允许访问`, {
            code: "FORBIDDEN",
            message: `路径 '${filePath}' 不允许访问`,
          });
        }
      }

      // Phase 2: 通道运行时一致性
      for (const spec of channelAsserts) {
        const declaredChannel = params[spec.channelParam];
        const declaredTenantId = params[spec.tenantParam];
        if (
          typeof declaredChannel === "string" &&
          typeof declaredTenantId === "string"
        ) {
          const result = assertRuntimeChannelTenantMatch({
            declaredChannel: declaredChannel as AgentChannel,
            declaredTenantId: declaredTenantId.trim(),
            runtimeChannel: channel,
            runtimeTenantId: tenantId.trim(),
            mismatchHint: spec.mismatchHint,
          });
          if (result) return result;
        }
      }

      // Phase 3: 审批（必须在所有校验通过后）
      for (const spec of approvals) {
        if (requiresApproval(tool.name, config().approval)) {
          const approved = await requestApprovalWithDescription(
            tool.name,
            { [spec.param]: params[spec.param] },
            `${spec.description}: ${params[spec.param]}`,
            {
              channel,
              unapprovableStrategy: config().unapprovableStrategy,
              timeoutMs: config().approval.timeoutMs,
            },
          );
          if (!approved) {
            return errResult("用户拒绝或超时", {
              code: "USER_REJECTED",
              message: "用户拒绝或超时",
            });
          }
        }
      }

      // 所有检查通过，执行原始工具
      return originalExecute(toolCallId, params, signal, onUpdate, ctx);
    },
  };
}
