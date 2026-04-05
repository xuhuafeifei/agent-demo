import { Type, type Static } from "@sinclair/typebox";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { errResult, okResult, type ToolDetails } from "./types.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";

const toolLogger = getSubsystemConsoleLogger("shell-execute");
const promisifiedExec = promisify(exec);

/** Node `exec` 失败时除 `message` 外常带 `stderr`/`stdout`/`code`，仅打 message 会看不到真实原因 */
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
 * 创建一个符合 @mariozechner/pi-coding-agent 标准的 shell 执行工具
 * 这个工具设计得非常简单，只考虑 macOS 系统，允许执行任何指令
 */
export function createShellExecuteTool(): ToolDefinition<typeof shellExecuteParameters, ToolDetails<ShellExecuteOutput>> {
  return {
    name: "shellExecute",
    label: "Shell Execute",
    description: "shellExecute(command) - execute any shell command on macOS system",
    parameters: shellExecuteParameters,
    execute: async (
      _toolCallId,
      params: ShellExecuteInput,
      _signal,
      _onUpdate,
      _ctx,
    ) => {
      try {
        const { command } = params;

        toolLogger.debug(`Executing command: ${command}`);

        // 直接执行传入的命令
        const { stdout, stderr } = await promisifiedExec(command);

        // 使用项目标准的工具返回格式
        return okResult(
          `Shell command executed successfully`,
          {
            stdout: stdout.trim(),
            stderr: stderr.trim()
          }
        );
      } catch (error: unknown) {
        const detail = formatExecFailure(error);
        toolLogger.warn(`Error executing command:\n${detail}`);

        return errResult(`Error executing command:\n${detail}`, {
          code: "INTERNAL_ERROR",
          message: detail,
        });
      }
    },
  };
}
