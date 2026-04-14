import { Type, type Static } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { errResult, okResult, type ToolDetails } from "../tool-result.js";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { shellPrecheck } from "../security/shell-precheck.js";
import { SENSITIVE_ENV_PATTERNS } from "../security/constants.js";
import { readFgbgUserConfig } from "../../../config/index.js";
import { resolveToolSecurityConfig } from "../security/tool-security.resolve.js";
import { requiresApproval } from "../tool-approval.js";
import { requestApprovalWithDescription } from "../utils/approval-helpers.js";
import type { AgentChannel } from "../../channel-policy.js";

const toolLogger = getSubsystemConsoleLogger("shell-execute");
const promisifiedExecFile = promisify(execFile);

/** 脱敏环境变量输出（过滤敏感键） */
function sanitizeEnvOutput(envStr: string): string {
  const lines = envStr.split("\n");
  return lines
    .map((line) => {
      const eqIndex = line.indexOf("=");
      if (eqIndex === -1) return line;
      const key = line.substring(0, eqIndex);
      const shouldHide = SENSITIVE_ENV_PATTERNS.some((pattern) =>
        key.toUpperCase().includes(pattern),
      );
      if (shouldHide) {
        return `${key}=<REDACTED>`;
      }
      return line;
    })
    .join("\n");
}

/** Node `execFile` 失败时的错误格式化 */
function formatExecFailure(error: unknown): string {
  const e = error as {
    message?: string;
    stderr?: string;
    stdout?: string;
    code?: number | string;
  };
  const base = e.message ?? String(error);
  const stderr = (e.stderr ?? "").trim();
  const stdout = (e.stdout ?? "").trim();
  const code = e.code;
  const parts: string[] = [base];
  if (code !== undefined && code !== null) {
    parts.push(`exitCode: ${String(code)}`);
  }
  if (stderr && !base.includes(stderr)) {
    parts.push(`stderr:\n${stderr}`);
  }
  if (stdout && !base.includes(stdout)) {
    parts.push(`stdout:\n${stdout}`);
  }
  return parts.join("\n\n");
}

// 工具参数定义
const shellExecuteParameters = Type.Object({
  command: Type.String({ minLength: 1 }),
});

type ShellExecuteInput = Static<typeof shellExecuteParameters>;

type ShellExecuteOutput = {
  stdout: string;
  stderr: string;
};

/**
 * 创建安全的 shell 执行工具
 * 特性：
 * - 白名单命令（basename 匹配 + mayHavePathArgs 标记）
 * - 路径参数自动校验（checkPathSafety）
 * - 跨平台：使用 execFile 而非 exec，避免 shell 注入
 * - 超时限制（默认 30 秒）
 * - 环境变量脱敏
 */
/**
 * 创建 shell 执行工具。
 * @param tenantId 租户 ID（日志归属等）
 * @param channel 当前运行渠道（审批显式传入）
 * @param _agentId 运行实例键，预留扩展，当前未使用
 */
export function createShellExecuteTool(
  tenantId: string,
  channel: AgentChannel,
  _agentId: string,
): ToolDefinition<
  typeof shellExecuteParameters,
  ToolDetails<ShellExecuteOutput>
> {
  void _agentId;
  void tenantId;
  return {
    name: "shellExecute",
    label: "Shell Execute",
    description:
      "shellExecute(command) - execute whitelisted shell command securely",
    parameters: shellExecuteParameters,
    execute: async (
      _toolCallId,
      params: ShellExecuteInput,
      signal,
      _onUpdate,
      _ctx,
    ) => {
      try {
        const { command } = params;

        toolLogger.debug(`Pre-checking command: ${command}`);

        // 1. 获取安全配置
        const config = readFgbgUserConfig();
        const securityConfig = resolveToolSecurityConfig(config.toolSecurity);
        const workspace = process.cwd();

        // 2. 预检（白名单验证 + 路径安全检查），返回解析后的命令和参数
        const precheck = await shellPrecheck(command, workspace, securityConfig);

        // 3. 审批检查（如果配置要求）
        if (requiresApproval("shellExecute", securityConfig.approval)) {
          const approved = await requestApprovalWithDescription(
            "shellExecute",
            { command },
            `执行命令: ${command}`,
            {
              channel,
              unapprovableStrategy: securityConfig.unapprovableStrategy,
              timeoutMs: securityConfig.approval.timeoutMs,
            },
          );
          if (!approved) {
            return errResult("用户拒绝或超时", {
              code: "USER_REJECTED",
              message: "用户拒绝或超时",
            });
          }
        }

        toolLogger.debug(`Executing via bash -c: ${precheck.command} ${precheck.args.join(" ")}`);

        // 4. 执行（使用 bash -c 以支持环境变量展开）
        const commandToRun = `${precheck.command} ${precheck.args.join(" ")}`.trim();
        const { stdout, stderr } = await promisifiedExecFile(
          os.platform() === "win32" ? "cmd.exe" : "bash",
          os.platform() === "win32" ? ["/c", commandToRun] : ["-c", commandToRun],
          {
            timeout: 30000, // 30 秒超时
            signal,
            env: process.env, // 继承当前环境变量
          },
        );

        // 5. 脱敏输出
        const sanitizedStdout = sanitizeEnvOutput(stdout.trim());
        const sanitizedStderr = sanitizeEnvOutput(stderr.trim());

        return okResult(`Command executed successfully`, {
          stdout: sanitizedStdout,
          stderr: sanitizedStderr,
        });
      } catch (error: unknown) {
        // 超时错误特殊处理
        if (error instanceof Error && error.message.includes("timeout")) {
          const msg = "命令执行超时（30 秒）";
          toolLogger.warn(`shellExecute timeout: ${params.command}`);
          return errResult(msg, {
            code: "INTERNAL_ERROR",
            message: msg,
          });
        }

        const detail = formatExecFailure(error);
        toolLogger.warn(`Error executing command:\n${detail}`);

        return errResult(`命令执行失败:\n${detail}`, {
          code: "INTERNAL_ERROR",
          message: detail,
        });
      }
    },
  };
}
