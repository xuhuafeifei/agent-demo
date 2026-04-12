import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { prepareBeforeGetReply } from "../../pre-run.js";
import { createRuntimeAgentSession } from "../../pi-embedded-runner/attempt.js";

const logger = getSubsystemConsoleLogger("compact-tool");

/**
 * 创建会话压缩工具。
 * 使用 Pi-core 内置压缩功能压缩会话历史，减少 token 占用。
 *
 * @param tenantId 租户 ID，用于定位租户 session 文件
 */
export function createCompactContextTool(tenantId: string = "default") {
  return {
    name: "compactContext",
    description:
      "Compress session context when the conversation is too long to reduce token usage.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    async execute() {
      logger.info("开始压缩会话上下文");

      try {
        // 使用当前租户的主 session 键准备会话信息
        const sessionKey = `session:main:${tenantId}`;
        const prepared = await prepareBeforeGetReply({ tenantId, sessionKey });

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
        });

        const compactionResult = await session.compact(
          "会话过长，需要压缩以适应上下文窗口限制",
        );

        logger.info(
          `压缩完成: 原 Token 数 ${compactionResult.tokensBefore}，保留内容从 ${compactionResult.firstKeptEntryId} 开始`,
        );

        return {
          content: `会话上下文压缩成功！压缩前 Token 数: ${compactionResult.tokensBefore}`,
          details: {
            message: "会话上下文已成功压缩",
            summary: compactionResult.summary,
            tokensBefore: compactionResult.tokensBefore,
            firstKeptEntryId: compactionResult.firstKeptEntryId,
          },
        };
      } catch (error) {
        logger.error(
          `压缩会话上下文失败: ${error instanceof Error ? error.message : "未知错误"}`,
        );
        return {
          content: `压缩会话上下文失败: ${error instanceof Error ? error.message : "未知错误"}`,
          details: { error: error instanceof Error ? error.message : "未知错误" },
          isError: true,
        };
      }
    },
  };
}
