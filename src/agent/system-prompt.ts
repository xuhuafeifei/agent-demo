import { type AgentChannel } from "./channel-policy.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";

const logger = getSubsystemConsoleLogger("system-prompt");

export type BuildSystemPromptInput = {
  soul: string;
  user?: string;
  nowText: string;
  language: string;
  chatHistory?: string;
  workspace?: string;
  toolings?: string[];
  skillsMeta?: string;
  channel?: AgentChannel;
  /**
   * 当前会话所属租户 ID（tenantId）。
   * 用于告知大模型在调用 sendIMMessage、createReminderTask 等工具时填入的 tenantId 值。
   */
  tenantId: string;
};

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

/**
 * 纯组合器：
 * - 只接收调用方入参
 * - 只做模板拼接
 * - 不做文件/数据库/网络读取
 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const soul = nonEmptyOrFallback(input.soul, "N/A");
  const user = nonEmptyOrFallback(input.user, "N/A");
  const nowText = nonEmptyOrFallback(input.nowText, "N/A");
  const language = nonEmptyOrFallback(input.language, "zh-CN");
  const chatHistory = nonEmptyOrFallback(input.chatHistory, "N/A");
  const workspace = nonEmptyOrFallback(input.workspace, "N/A");
  const toolings = nonEmptyListOrFallback(input.toolings, ["N/A"]);
  const skillsMeta = nonEmptyOrFallback(input.skillsMeta, "No skills loaded.");
  const channel = input.channel;
  const tenantId = input.tenantId;
  // debug，一手删了
  logger.debug(`channel, tenantId: ${channel}, ${tenantId}`);
  return `## who you are
${soul}

## Environment
Please current date is ${nowText}! don't forget it!
If you see other time information elsewhere, those are outdated; ${nowText} is the correct one!

## Channel
Current channel is ${channel}. 
Current tenantId is ${tenantId}.

## Channel rules
1. **currentChannel** must exactly match the channel shown above under **## Channel** (expected: \`${channel}\`).
2. **currentTenantId** must exactly match the tenantId shown above (expected: \`${tenantId}\`).
3. **sendToChannel / sendToTenantId** (tool-dependent): **createReminderTask** may omit both; the server defaults to the runtime channel and tenantId. **sendIMMessage** must always pass **sendToChannel** (qq or weixin); **sendToTenantId** may be omitted (defaults to runtime tenantId).
4. Do not invent arbitrary channel or tenant values.

## Toolings

You have access to the following toolings:
- ${toolings.join("\n- ")}

## Skills
${skillsMeta}

## User
Summaries from workspace **userinfo/*.md** (YAML frontmatter \`name\` / \`description\`). For full text or fuzzy recall use **memorySearch** and **read** on \`userinfo/...\`.

${user}

## Language
If the user does not request it, reply in ${language}.

## Workspace
Your working directory is: ${workspace}


## Memory Recall
Do not assume memory is preloaded in this prompt.
When you need past memory or long-term context, use function tools to query memory by yourself.

Boundary: **Project-level** long-term notes live in workspace **MEMORY.md** (this workspace). **User-level** topic summaries live under **~/.fgbg/memory/** (via persistKnowledge type memory). Do not confuse the two when persisting or searching.

## Memory Persistence
Use **persistKnowledge** with required field **type**:

- **type: "memory"** — Records of important events or topics in **~/.fgbg/memory/<fileName>.md** (creates new file). Fields: **fileName** (e.g. \`notes.md\`), **content** (plain Markdown body).
- **type: "userinfo"** — User profile and preferences in **workspace/userinfo/<fileName>.md** (creates new file). Fields: **fileName**, **title**, **description**, **content**. The tool adds YAML frontmatter; these files are indexed for memorySearch and summarized in ## User above.
- **type: "skill"** — Reusable procedures under **workspace/skills/<skillDir>/** (writes SKILL.md with YAML frontmatter). Fields: **path** (skill directory), **title**, **description**, **content**. Full steps: use **loadSkill(path)**; do not rely on memorySearch for skill bodies.

For **MEMORY.md** only: use **read** / **write** / **append** on the workspace file path—do not use persistKnowledge for it.

## Current Chat Information
user and assistant chat history
${chatHistory}
`;
}
