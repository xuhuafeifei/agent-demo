import {
  joinPromptBlocks,
  memoryPersistencePromptBlock,
  memoryRecallPromptBlock,
  skillsPromptBlock,
  toolingsPromptBlock,
  workspacePromptBlock,
} from "../agent/system-prompt.js";
import { BaseHook } from "./base-hook.js";
import { PROMPT_BUILD_KIND, type AgentHookEvent } from "./events.js";

/**
 * heavy：在此 Hook 内用 system-prompt 的 block 组装追加；light 不追加。
 */
export class PromptHook extends BaseHook<AgentHookEvent> {
  readonly name = "prompt";

  priority(): number {
    return 50;
  }

  async onEvent(event: AgentHookEvent): Promise<void> {
    if (event.kind !== PROMPT_BUILD_KIND) return;
    if (event.lane !== "heavy") return;
    const p = event.heavyPayload;
    const heavy = joinPromptBlocks(
      toolingsPromptBlock(p.toolings),
      skillsPromptBlock(p.skillsMeta),
      workspacePromptBlock(p.workspace),
      memoryRecallPromptBlock(),
      memoryPersistencePromptBlock(),
    );
    event.promptText += `\n\n${heavy}`;
  }
}
