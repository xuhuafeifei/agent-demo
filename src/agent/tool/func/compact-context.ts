import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { prepareBeforeGetReply } from "../../runtime/pre-run.js";
import { createRuntimeAgentSession } from "../../pi-embedded-runner/attempt.js";
import { errResult, okResult, type ToolDetails } from "../tool-result.js";
import { TOOL_HOOK_KIND } from "../../../hook/events.js";
import { invokeAgentHooks } from "../../runtime/run.js";
import { BUILTIN_TOOL_NAMES } from "../builtin-tools.js";
import { TOOL_ENTRY_BY_NAME } from "../tool-catalog.js";
import { createToolBundle } from "../tool-bundle.js";

const logger = getSubsystemConsoleLogger("compact-tool");
const compactContextParameters = Type.Object({});
type CompactContextInput = Static<typeof compactContextParameters>;
type CompactContextOutput = {
  message: string;
  summary: string;
  tokensBefore: number;
  firstKeptEntryId: string;
};

/**
 * 创建会话压缩工具。
 * 使用 Pi-core 内置压缩功能压缩会话历史，减少 token 占用。
 *
 * @param tenantId 租户 ID，用于定位租户 session 文件
 */
export function createCompactContextTool(
  tenantId: string,
): ToolDefinition<
  typeof compactContextParameters,
  ToolDetails<CompactContextOutput>
> {
  return {
    name: "compactContext",
    label: "Compact Context",
    description:
      "compactContext() — compress session context to reduce token usage.",
    parameters: compactContextParameters,
    async execute(_toolCallId: string, _params: CompactContextInput) {
      logger.info("开始压缩会话上下文");

      try {
        // 使用当前租户的主 session 键准备会话信息
        const sessionKey = `session:main:${tenantId}`;
        const prepared = await prepareBeforeGetReply({
          tenantId,
          sessionKey,
          channel: "web",
        });

        const agentId = `agent:main:${tenantId}`;
        const builtinNames = BUILTIN_TOOL_NAMES.filter((n) =>
          TOOL_ENTRY_BY_NAME.has(n),
        );
        const builtInBundle = createToolBundle(
          prepared.cwd,
          tenantId,
          "web",
          agentId,
          builtinNames,
        );
        const toolHookEvent = {
          kind: TOOL_HOOK_KIND,
          lane: "heavy" as const,
          tenantId,
          channel: "web" as const,
          cwd: prepared.cwd,
          agentId,
          tools: builtInBundle.tools,
          toolings: builtInBundle.toolings,
        };
        await invokeAgentHooks(prepared.hooks, toolHookEvent);

        const session = await createRuntimeAgentSession({
          model: prepared.model!,
          sessionDir: prepared.sessionDir,
          sessionFile: prepared.sessionFile,
          cwd: prepared.cwd,
          agentDir: prepared.agentDir,
          provider: prepared.normalizedProvider,
          apiKey: prepared.apiKey,
          thinkingLevel: prepared.thinkingLevel,
          tenantId,
          channel: "web",
          agentId,
          customTools: toolHookEvent.tools,
        });

        const compactionResult = await session.compact(
          "会话过长，需要压缩以适应上下文窗口限制",
        );

        logger.info(
          `压缩完成: 原 Token 数 ${compactionResult.tokensBefore}，保留内容从 ${compactionResult.firstKeptEntryId} 开始`,
        );

        return okResult(
          `会话上下文压缩成功！压缩前 Token 数: ${compactionResult.tokensBefore}`,
          {
            message: "会话上下文已成功压缩",
            summary: compactionResult.summary,
            tokensBefore: compactionResult.tokensBefore,
            firstKeptEntryId: compactionResult.firstKeptEntryId,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        logger.error(`压缩会话上下文失败: ${message}`);
        return errResult(`压缩会话上下文失败: ${message}`, {
          code: "INTERNAL_ERROR",
          message,
        });
      }
    },
  };
}
