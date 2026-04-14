import { Type, type Static } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import os from "node:os";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { okResult, errResult, type ToolDetails } from "../tool-result.js";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { SENSITIVE_ENV_PATTERNS } from "../security/constants.js";
import { shellPrecheck } from "../security/shell-precheck.js";
import { readFgbgUserConfig } from "../../../config/index.js";
import { resolveToolSecurityConfig } from "../security/tool-security.resolve.js";
import type { AgentChannel } from "../../channel-policy.js";

const toolLogger = getSubsystemConsoleLogger("bash");

// 工具参数定义
const bashParameters = Type.Object({
  command: Type.String({ minLength: 1 }),
});

type BashInput = Static<typeof bashParameters>;
type BashOutput = { stdout: string; stderr: string };
let loginShellEnvPromise: Promise<NodeJS.ProcessEnv | null> | null = null;

/**
 * 按 && 和 || 分割命令字符串，返回子命令列表及连接符。
 * 例如: "git status && cat file.txt || echo fail"
 * → [{ cmd: "git status", op: null }, { cmd: "cat file.txt", op: "&&" }, { cmd: "echo fail", op: "||" }]
 */
function splitCommands(command: string): { cmd: string; op: string | null }[] {
  const segments = command.split(/\s*(&&|\|\|)\s*/);
  const result: { cmd: string; op: string | null }[] = [];
  for (let i = 0; i < segments.length; i += 2) {
    const cmd = segments[i].trim();
    const op = i + 1 < segments.length ? segments[i + 1] : null;
    if (cmd) result.push({ cmd, op });
  }
  return result;
}

/** 脱敏环境变量输出 */
function sanitizeEnvOutput(envStr: string): string {
  const lines = envStr.split("\n");
  return lines
    .map((line) => {
      const eqIndex = line.indexOf("=");
      if (eqIndex === -1) return line;
      const key = line.substring(0, eqIndex);
      if (SENSITIVE_ENV_PATTERNS.some((p) => key.toUpperCase().includes(p))) {
        return `${key}=<REDACTED>`;
      }
      return line;
    })
    .join("\n");
}

function parseEnvText(envText: string): NodeJS.ProcessEnv {
  const parsed: NodeJS.ProcessEnv = {};
  for (const line of envText.split("\n")) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    parsed[key] = value;
  }
  return parsed;
}

async function getLoginShellEnv(
  signal?: AbortSignal,
): Promise<NodeJS.ProcessEnv | null> {
  if (os.platform() === "win32") return null;
  if (!loginShellEnvPromise) {
    loginShellEnvPromise = new Promise((resolve) => {
      const shellPath = process.env.SHELL || "/bin/bash";
      execFile(
        shellPath,
        ["-lc", "env"],
        { timeout: 3000, signal, env: { ...process.env } },
        (error, stdout) => {
          if (error) {
            toolLogger.debug(`load login shell env failed: ${String(error)}`);
            resolve(null);
            return;
          }
          resolve(parseEnvText(String(stdout ?? "")));
        },
      );
    });
  }
  return loginShellEnvPromise;
}

/** 执行单个子命令 */
async function execSubCommand(
  command: string,
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const isWin = os.platform() === "win32";
  const shell = isWin ? "cmd.exe" : "bash";
  const args = isWin ? ["/c", command] : ["-c", command];

  return new Promise((resolve) => {
    execFile(
      shell,
      args,
      { timeout: 30000, signal, env: { ...process.env } },
      (error, stdout, stderr) => {
        // 统一计算退出码：优先取 error.code，否则若有 error 且无 code 则为 null，否则为 0
        const exitCode =
          error && "code" in error ? (error as any).code : error ? null : 0;

        resolve({
          exitCode,
          stdout: sanitizeEnvOutput((stdout ?? "").trim()),
          stderr: sanitizeEnvOutput((stderr ?? "").trim()),
        });
      },
    );
  });
}

/** 格式化单个子命令结果 */
function formatSubResult(
  sub: { cmd: string; op: string | null },
  result: { exitCode: number | null; stdout: string; stderr: string },
  index: number,
): string {
  const lines: string[] = [
    `[${index + 1}] ${sub.cmd} (exit: ${result.exitCode ?? "killed"})`,
  ];
  if (result.stdout) lines.push(result.stdout);
  if (result.stderr) lines.push(`stderr: ${result.stderr}`);
  return lines.join("\n");
}

/**
 * 创建 bash 工具。
 * 校验（shellPrecheck）在工具内部执行。
 * 本工具负责：拆分串联命令 → 逐个校验 → 逐个执行 → 拼接结果。
 */
export function createBashTool(
  tenantId: string,
  channel: AgentChannel,
  _agentId: string,
): ToolDefinition<typeof bashParameters, ToolDetails<BashOutput>> {
  void _agentId;
  void tenantId;
  void channel;

  return {
    name: "bash",
    label: "Bash",
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 50 lines. Optionally provide a timeout in seconds. Commands are validated against a whitelist before execution. Dangerous operations (rm, sudo, etc.), pipes, redirects, and command substitutions are blocked.`,
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
    }),
    execute: async (_toolCallId, params: BashInput, signal, _onUpdate) => {
      const { command } = params;
      const subs = splitCommands(command);

      // 获取安全配置（用于子命令校验）
      const config = readFgbgUserConfig();
      const securityConfig = resolveToolSecurityConfig(config.toolSecurity);
      const workspace = process.cwd();

      // 每个子命令独立校验
      for (const sub of subs) {
        await shellPrecheck(sub.cmd, workspace, securityConfig);
      }

      // 只有一个子命令，直接执行
      if (subs.length === 1) {
        const result = await execSubCommand(subs[0].cmd, signal);
        if (result.exitCode !== null && result.exitCode !== 0) {
          return errResult(
            `命令退出码 ${result.exitCode}\n${result.stdout}\n${result.stderr}`.trim(),
            {
              code: "INTERNAL_ERROR",
              message: `exit code: ${result.exitCode}`,
            },
          );
        }
        return okResult(result.stdout || "(empty)", {
          stdout: result.stdout,
          stderr: result.stderr,
        });
      }

      // 多个子命令，按 && / || 语义逐个执行
      let prevExitCode: number | null = 0;
      const outputs: string[] = [];

      for (let i = 0; i < subs.length; i++) {
        const sub = subs[i];

        // 根据前一个命令的退出码和连接符决定是否执行
        if (i > 0) {
          const prevOp = subs[i - 1].op;
          if (prevOp === "&&" && prevExitCode !== 0) break;
          if (prevOp === "||" && prevExitCode === 0) break;
        }

        const result = await execSubCommand(sub.cmd, signal);
        prevExitCode = result.exitCode;
        outputs.push(formatSubResult(sub, result, i));
      }

      return okResult(outputs.join("\n\n"), {
        stdout: outputs.join("\n"),
        stderr: "",
      });
    },
  };
}
