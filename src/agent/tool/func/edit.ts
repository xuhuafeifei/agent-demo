import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { createEditTool as createPiEditTool } from "@mariozechner/pi-coding-agent";
import type { EditToolDetails } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import type { AgentChannel } from "../../channel-policy.js";

const toolLogger = getSubsystemConsoleLogger("edit");

// edit 工具的参数 schema（与 pi-core 一致）
const editParameters = Type.Object({
  path: Type.String({ minLength: 1 }),
  oldText: Type.String({ minLength: 1 }),
  newText: Type.String({ minLength: 1 }),
});

type EditParams = Static<typeof editParameters>;

/**
 * 创建 edit 工具实例。
 * 安全检查（路径校验 + 审批）由 createToolBundle 的 security wrapper 自动织入。
 */
export function createEditTool(
  tenantId: string,
  channel: AgentChannel,
  _agentId: string,
): ToolDefinition<typeof editParameters, EditToolDetails> {
  void _agentId;
  void tenantId;

  const piEdit = createPiEditTool(process.cwd());

  return {
    name: "edit",
    label: "Edit",
    description:
      "edit(path, oldText, newText) - find and replace exact text in a file",
    parameters: editParameters,
    execute: async (_toolCallId, params, signal, onUpdate) => {
      try {
        return piEdit.execute(_toolCallId, params, signal, onUpdate);
      } catch (error: unknown) {
        const detail =
          error instanceof Error ? error.message : String(error);
        toolLogger.warn(`Error executing edit:\n${detail}`);
        throw error;
      }
    },
  };
}
