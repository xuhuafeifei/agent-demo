import { Type, type Static } from "@sinclair/typebox";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { errResult, okResult, type ToolDetails } from "./types.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";

const toolLogger = getSubsystemConsoleLogger("shell-execute");
const promisifiedExec = promisify(exec);

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
      } catch (error: any) {
        toolLogger.warn(`Error executing command: ${error.message}`);

        return errResult(
          `Error executing command: ${error.message}`,
          {
            code: "INTERNAL_ERROR",
            message: error.message,
          }
        );
      }
    },
  };
}
