import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { prepareBeforeGetReply } from "../pre-run.js";
import { createRuntimeAgentSession } from "../pi-embedded-runner/attempt.js";

const logger = getSubsystemConsoleLogger("compact-tool");

/**
 * 压缩会话上下文的工具
 * 这个工具会使用 Pi-core 内置的压缩功能，自动压缩会话历史
 */
export function createCompactContextTool() {
  return {
    name: "compactContext",
    description: "压缩会话上下文，当会话过长时调用此工具来减少上下文大小",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    async execute() {
      logger.info("开始压缩会话上下文");

      try {
        // 准备会话信息
        const prepared = await prepareBeforeGetReply({
          sessionKey: "agent:main:main", // 使用默认会话
        });

        // 创建运行时会话
        const session = await createRuntimeAgentSession({
          model: prepared.model!, // 此时模型应该已经准备好
          sessionDir: prepared.sessionDir,
          sessionFile: prepared.sessionFile,
          cwd: prepared.cwd,
          agentDir: prepared.agentDir,
          provider: prepared.normalizedProvider,
          apiKey: prepared.apiKey,
          thinkingLevel: prepared.thinkingLevel,
        });

        // 使用 Pi-core 内置的压缩方法
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
          details: {
            error: error instanceof Error ? error.message : "未知错误",
          },
          isError: true,
        };
      }
    },
  };
}
