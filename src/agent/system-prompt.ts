import { type AgentChannel } from "./channel-policy.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";
import {
  PromptSectionPriority,
  type PromptSection,
} from "./prompt/section-pipeline.js";

const logger = getSubsystemConsoleLogger("system-prompt");

function nonEmptyOrFallback(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
}

function nonEmptyListOrFallback(
  value: string[] | undefined,
  fallback: string[],
): string[] {
  if (!Array.isArray(value)) return fallback;
  const list = value.map((item) => item.trim()).filter(Boolean);
  return list.length > 0 ? list : fallback;
}

/** 多块 prompt 拼接；Hook / 调用方累加时用 */
export function joinPromptBlocks(...blocks: string[]): string {
  return blocks.filter((b) => b.length > 0).join("\n\n");
}

export function createPromptSection(params: {
  id: string;
  content: string;
  priority: number;
  source: string;
  cacheable?: boolean;
  required?: boolean;
}): PromptSection {
  return {
    id: params.id,
    content: params.content,
    priority: params.priority,
    source: params.source,
    cacheable: params.cacheable ?? false,
    required: params.required ?? false,
  };
}

// --- 共用块（每段自包含 ## 标题与正文）---

export function whoYouArePromptBlock(soul: string): string {
  const text = nonEmptyOrFallback(soul, "N/A");
  return `## who you are
${text}`;
}

export function whoYouArePromptSection(soul: string): PromptSection {
  return createPromptSection({
    id: "who-you-are",
    content: whoYouArePromptBlock(soul),
    priority: PromptSectionPriority.CORE,
    source: "system.stem",
    required: true,
    cacheable: true,
  });
}

export function environmentPromptBlock(nowText: string): string {
  const t = nonEmptyOrFallback(nowText, "N/A");
  return `## Environment
Please current date is ${t}! don't forget it!
If you see other time information elsewhere, those are outdated; ${t} is the correct one!`;
}

export function environmentPromptSection(nowText: string): PromptSection {
  return createPromptSection({
    id: "environment",
    content: environmentPromptBlock(nowText),
    priority: PromptSectionPriority.CORE,
    source: "system.stem",
    required: true,
  });
}

export function channelPromptBlock(
  channel: AgentChannel | undefined,
  tenantId: string,
): string {
  return `## Channel
Current channel is ${channel}. 
Current tenantId is ${tenantId}.`;
}

export function channelPromptSection(
  channel: AgentChannel | undefined,
  tenantId: string,
): PromptSection {
  return createPromptSection({
    id: "channel",
    content: channelPromptBlock(channel, tenantId),
    priority: PromptSectionPriority.CORE,
    source: "system.stem",
    required: true,
  });
}

export function channelRulesPromptBlock(
  channel: AgentChannel | undefined,
  tenantId: string,
): string {
  return `## Channel rules
1. **currentChannel** must exactly match the channel shown above under **## Channel** (expected: \`${channel}\`).
2. **currentTenantId** must exactly match the tenantId shown above (expected: \`${tenantId}\`).
3. **sendToChannel / sendToTenantId** (tool-dependent): **createReminderTask** may omit both; the server defaults to the runtime channel and tenantId. **sendIMMessage** must always pass **sendToChannel** (qq or weixin); **sendToTenantId** may be omitted (defaults to runtime tenantId).
4. Do not invent arbitrary channel or tenant values.`;
}

export function channelRulesPromptSection(
  channel: AgentChannel | undefined,
  tenantId: string,
): PromptSection {
  return createPromptSection({
    id: "channel-rules",
    content: channelRulesPromptBlock(channel, tenantId),
    priority: PromptSectionPriority.POLICY,
    source: "system.stem",
    required: true,
  });
}

export function userPromptBlock(user: string): string {
  const text = nonEmptyOrFallback(user, "N/A");
  return `## User
Summaries from workspace **userinfo/*.md** (YAML frontmatter \`name\` / \`description\`). For full text or fuzzy recall use **memorySearch** and **read** on \`userinfo/...\`.

${text}`;
}

export function userPromptSection(user: string): PromptSection {
  return createPromptSection({
    id: "user-profile",
    content: userPromptBlock(user),
    priority: PromptSectionPriority.CONTEXT,
    source: "system.stem",
    cacheable: true,
  });
}

export function languagePromptBlock(language: string): string {
  const lang = nonEmptyOrFallback(language, "zh-CN");
  return `## Language
If the user does not request it, reply in ${lang}.`;
}

export function languagePromptSection(language: string): PromptSection {
  return createPromptSection({
    id: "language",
    content: languagePromptBlock(language),
    priority: PromptSectionPriority.CORE,
    source: "system.stem",
    required: true,
    cacheable: true,
  });
}

// --- heavy 块 ---

export function toolingsPromptBlock(toolings: string[]): string {
  const list = nonEmptyListOrFallback(toolings, ["N/A"]);
  return `## Toolings

You have access to the following toolings:
- ${list.join("\n- ")}`;
}

export function toolingsPromptSection(toolings: string[]): PromptSection {
  return createPromptSection({
    id: "toolings",
    content: toolingsPromptBlock(toolings),
    priority: PromptSectionPriority.TOOLS,
    source: "hook.prompt",
    cacheable: true,
  });
}

export function skillsPromptBlock(skillsMeta: string): string {
  const text = nonEmptyOrFallback(skillsMeta, "No skills loaded.");
  return `## Skills
${text}`;
}

export function skillsPromptSection(skillsMeta: string): PromptSection {
  return createPromptSection({
    id: "skills",
    content: skillsPromptBlock(skillsMeta),
    priority: PromptSectionPriority.TOOLS,
    source: "hook.prompt",
    cacheable: true,
  });
}

export function workspacePromptBlock(workspace: string): string {
  const path = nonEmptyOrFallback(workspace, "N/A");
  return `## Workspace
Your working directory is: ${path}`;
}

export function workspacePromptSection(workspace: string): PromptSection {
  return createPromptSection({
    id: "workspace",
    content: workspacePromptBlock(workspace),
    priority: PromptSectionPriority.CONTEXT,
    source: "hook.prompt",
    cacheable: true,
  });
}

export function memoryRecallPromptBlock(): string {
  return `## Memory Recall
Do not assume memory is preloaded in this prompt.
When you need past memory or long-term context, use function tools to query memory by yourself.

Boundary: **Project-level** long-term notes live in workspace **MEMORY.md** (this workspace). **User-level** topic summaries live under **~/.fgbg/memory/** (via persistKnowledge type memory). Do not confuse the two when persisting or searching.`;
}

export function memoryRecallPromptSection(): PromptSection {
  return createPromptSection({
    id: "memory-recall",
    content: memoryRecallPromptBlock(),
    priority: PromptSectionPriority.MEMORY,
    source: "hook.prompt",
    cacheable: true,
  });
}

export function memoryPersistencePromptBlock(): string {
  return `## Memory Persistence
Use **persistKnowledge** with required field **type**:

- **type: "memory"** — Records of important events or topics in **~/.fgbg/memory/<fileName>.md** (creates new file). Fields: **fileName** (e.g. \`notes.md\`), **content** (plain Markdown body).
- **type: "userinfo"** — User profile and preferences in **workspace/userinfo/<fileName>.md** (creates new file). Fields: **fileName**, **title**, **description**, **content**. The tool adds YAML frontmatter; these files are indexed for memorySearch and summarized in ## User above.
- **type: "skill"** — Reusable procedures under **workspace/skills/<skillDir>/** (writes SKILL.md with YAML frontmatter). Fields: **path** (skill directory), **title**, **description**, **content**. Full steps: use **loadSkill(path)**; do not rely on memorySearch for skill bodies.

For **MEMORY.md** only: use **read** / **write** / **append** on the workspace file path—do not use persistKnowledge for it.`;
}

export function memoryPersistencePromptSection(): PromptSection {
  return createPromptSection({
    id: "memory-persistence",
    content: memoryPersistencePromptBlock(),
    priority: PromptSectionPriority.MEMORY,
    source: "hook.prompt",
    cacheable: true,
  });
}

export function crossLaneBridgePromptBlock(params: {
  previousLane: string;
  currentLane: string;
  previousTurns: Array<{
    time: string;
    role: "user" | "assistant";
    text: string;
  }>;
  turnCount: number;
}): string {
  const prevSection =
    params.previousTurns.length > 0
      ? params.previousTurns
          .map((t) => `[${t.time}] ${t.role}: ${t.text}`)
          .join("\n")
      : "(none)";
  return `## Cross-Lane Bridge Context
Lane switched: ${params.previousLane} -> ${params.currentLane}
Use this section only for continuity. Prefer current user intent and latest constraints.

From previous lane (${params.previousLane}), latest ${params.turnCount} turns:
${prevSection}`;
}

export function crossLaneBridgePromptSection(params: {
  previousLane: string;
  currentLane: string;
  previousTurns: Array<{
    time: string;
    role: "user" | "assistant";
    text: string;
  }>;
  turnCount: number;
}): PromptSection {
  return createPromptSection({
    id: "cross-lane-bridge",
    content: crossLaneBridgePromptBlock(params),
    priority: PromptSectionPriority.OPTIONAL,
    source: "hook.prompt",
  });
}

export function currentChatPromptBlock(chatHistory: string): string {
  const text = nonEmptyOrFallback(chatHistory, "N/A");
  return `## Current Chat Information
user and assistant chat history
${text}`;
}

export function currentChatPromptSection(chatHistory: string): PromptSection {
  return createPromptSection({
    id: "current-chat",
    content: currentChatPromptBlock(chatHistory),
    priority: PromptSectionPriority.CONTEXT,
    source: "runtime",
  });
}

/**
 * 共用 stem（至 Language）：主流程构建后交给 Hook 追加；最后在 run 里再接 Current Chat。
 */
export function buildSystemPromptStem(params: {
  soul: string;
  user?: string;
  nowText: string;
  language: string;
  channel?: AgentChannel;
  tenantId: string;
}): string {
  const { channel, tenantId } = params;
  logger.debug(`channel, tenantId: ${channel}, ${tenantId}`);
  return joinPromptBlocks(
    whoYouArePromptBlock(params.soul),
    environmentPromptBlock(params.nowText),
    channelPromptBlock(channel, tenantId),
    channelRulesPromptBlock(channel, tenantId),
    userPromptBlock(params.user ?? ""),
    languagePromptBlock(params.language),
  );
}

export function buildSystemPromptStemSections(params: {
  soul: string;
  user?: string;
  nowText: string;
  language: string;
  channel?: AgentChannel;
  tenantId: string;
}): PromptSection[] {
  const { channel, tenantId } = params;
  logger.debug(`channel, tenantId: ${channel}, ${tenantId}`);
  return [
    whoYouArePromptSection(params.soul),
    environmentPromptSection(params.nowText),
    channelPromptSection(channel, tenantId),
    channelRulesPromptSection(channel, tenantId),
    userPromptSection(params.user ?? ""),
    languagePromptSection(params.language),
  ];
}

/** 主流程在 Hook 之后拼接对话历史块 */
export function appendCurrentChatSection(chatHistory: string | undefined): string {
  return `\n\n${currentChatPromptBlock(chatHistory ?? "")}`;
}
