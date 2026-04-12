import { Type, type Static } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { errResult, okResult, type ToolDetails } from "../tool-result.js";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { preExecuteCheck } from "../security/shell-precheck.js";
import { SENSITIVE_ENV_PATTERNS } from "../security/constants.js";
import { readFgbgUserConfig } from "../../../config/index.js";
import { resolveToolSecurityConfig } from "../security/tool-security.resolve.js";
import { requiresApproval } from "../tool-approval.js";
import { requestApprovalWithDescription } from "../utils/approval-helpers.js";
import { getAgentState } from "../../agent-state.js";

const toolLogger = getSubsystemConsoleLogger("shell-execute");
const promisifiedExecFile = promisify(execFile);

/**
 * 解析命令行为可执行文件路径 + 参数数组
 * 跨平台：返回 basename，由 execFile 通过 PATH 解析
 */
function parseCommand(command: string): { file: string; args: string[] } {
  // 简单解析：第一个 token 是命令，其余是参数
  const parts: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === " " && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  return {
    file: parts[0] || "",
    args: parts.slice(1),
  };
}

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
 * - 白名单命令（basename 匹配）
 * - 禁止 Shell 元字符（无管道、链式命令）
 * - 跨平台：使用 execFile 而非 exec，避免 shell 注入
 * - 超时限制（默认 30 秒）
 * - 环境变量脱敏
 */
/**
 * 创建 shell 执行工具。
 * @param tenantId 租户 ID，用于获取当前渠道信息（审批时需要）
 */
export function createShellExecuteTool(tenantId: string): ToolDefinition<
  typeof shellExecuteParameters,
  ToolDetails<ShellExecuteOutput>
> {
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

        // 1. 预检（白名单、元字符、网络）
        await preExecuteCheck(command, { network: false });

        // 2. 审批检查（如果配置要求）
        const config = readFgbgUserConfig();
        const securityConfig = resolveToolSecurityConfig(config.toolSecurity);
        if (requiresApproval("shellExecute", securityConfig.approval)) {
          const approved = await requestApprovalWithDescription(
            "shellExecute",
            { command },
            `执行命令: ${command}`,
            {
              channel: getAgentState(tenantId)?.channel ?? "web",
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

        // 3. 解析命令
        const { file, args } = parseCommand(command);

        toolLogger.debug(`Executing: ${file} ${args.join(" ")}`);

        // 4. 执行（使用 execFile 避免 shell 注入）
        const { stdout, stderr } = await promisifiedExecFile(file, args, {
          timeout: 30000, // 30 秒超时
          signal,
          env: process.env, // 继承当前环境变量
        });

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
