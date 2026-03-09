import fs from "node:fs/promises";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { atomicWriteText, exists, enforceTextSizeLimit } from "./file-utils.js";
import { resolvePathInWorkspace } from "./guards.js";
import { errResult, okResult, type ToolDetails } from "./types.js";

const toolLogger = getSubsystemConsoleLogger("tool");

const updateParameters = Type.Object({
  path: Type.String({ minLength: 1 }),
  find: Type.String(),
  replace: Type.String(),
  all: Type.Optional(Type.Boolean()),
  expectedCount: Type.Optional(Type.Number({ minimum: 0 })),
});

type UpdateInput = Static<typeof updateParameters>;

type UpdateOutput = {
  path: string;
  replacedCount: number;
};

function replaceAllLiteral(
  content: string,
  find: string,
  replace: string,
): { text: string; count: number } {
  const parts = content.split(find);
  if (parts.length <= 1) return { text: content, count: 0 };
  return {
    text: parts.join(replace),
    count: parts.length - 1,
  };
}

export function createUpdateTool(
  workspace: string,
): ToolDefinition<typeof updateParameters, ToolDetails<UpdateOutput>> {
  return {
    name: "update",
    label: "Update",
    description:
      "Update text in file by replacing the first or all literal matches.",
    parameters: updateParameters,
    execute: async (
      _toolCallId,
      params: UpdateInput,
      _signal,
      _onUpdate,
      _ctx,
    ) => {
      const started = Date.now();
      if (!params.find) {
        return errResult("find 不能为空", {
          code: "INVALID_ARGUMENT",
          message: "find 不能为空",
        });
      }

      const resolved = resolvePathInWorkspace(workspace, params.path);
      if (!resolved.ok) {
        return errResult(resolved.error.message, resolved.error);
      }
      const filePath = resolved.value;

      if (!(await exists(filePath))) {
        return errResult(`文件不存在: ${params.path}`, {
          code: "NOT_FOUND",
          message: `文件不存在: ${params.path}`,
        });
      }

      try {
        const original = await fs.readFile(filePath, "utf8");
        let replacedCount = 0;
        let next = original;

        if (params.all) {
          const replaced = replaceAllLiteral(original, params.find, params.replace);
          replacedCount = replaced.count;
          next = replaced.text;
        } else {
          const index = original.indexOf(params.find);
          if (index >= 0) {
            replacedCount = 1;
            next =
              original.slice(0, index) +
              params.replace +
              original.slice(index + params.find.length);
          }
        }

        if (replacedCount === 0) {
          return errResult("未匹配到可替换文本", {
            code: "CONFLICT",
            message: "未匹配到可替换文本",
          });
        }

        if (
          typeof params.expectedCount === "number" &&
          params.expectedCount !== replacedCount
        ) {
          return errResult(
            `命中次数不符，期望 ${params.expectedCount}，实际 ${replacedCount}`,
            {
              code: "CONFLICT",
              message: `expectedCount=${params.expectedCount}, actual=${replacedCount}`,
            },
          );
        }

        if (!enforceTextSizeLimit(next, 10 * 1024 * 1024)) {
          return errResult("更新后的文件内容过大", {
            code: "INVALID_ARGUMENT",
            message: "更新后的内容超过 10MB 限制",
          });
        }

        await atomicWriteText(filePath, next);
        const durationMs = Date.now() - started;
        toolLogger.info(
          `tool=update path=${filePath} replacedCount=${replacedCount} durationMs=${durationMs}`,
        );
        return okResult(
          `Updated ${params.path} with ${replacedCount} replacement(s).`,
          {
            path: filePath,
            replacedCount,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.warn(`tool=update path=${filePath} error=${message}`);
        return errResult(`更新失败: ${message}`, {
          code: "IO_ERROR",
          message,
        });
      }
    },
  };
}
