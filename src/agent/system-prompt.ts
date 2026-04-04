import {
  getChannelFormattingInstruction,
  normalizeChannel,
  type AgentChannel,
} from "./channel-policy.js";

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
  const channel = normalizeChannel(input.channel);
  return `## who you are
${soul}

## Environment
Please current date is ${nowText}! don't forget it!
if you forget it, you can use the function tool, getNow to get the current date!
In addition, if you see other time information elsewhere, those are outdated; ${nowText} is the correct one!

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

## Channel
${channel}

## Memory Recall
Do not assume memory is preloaded in this prompt.
When you need past memory or long-term context, use function tools to query memory by yourself.

Boundary: **Project-level** long-term notes live in workspace **MEMORY.md** (this workspace). **User-level** topic summaries live under **~/.fgbg/memory/** (via persistKnowledge type memory). Do not confuse the two when persisting or searching.

## Memory Persistence
Use **persistKnowledge** with required field **type**:

- **type: "memory"** — User-wide topic summaries in **~/.fgbg/memory/<fileName>.md** (append if file exists, else create). Fields: **fileName** (basename only, e.g. \`notes.md\`), **content** (plain Markdown body, no skill-style header).
- **type: "userinfo"** — Preferences and collaboration habits in **workspace/userinfo/<fileName>.md** (overwrites file). Fields: **fileName**, **name**, **description**, **content**. The tool adds YAML frontmatter; these files are indexed for memorySearch and summarized in ## User above.
- **type: "skill"** — Reusable procedures under **workspace/skills/<skillDir>/** (overwrites SKILL.md and meta.json). Fields: **skillDir**, **name**, **description**, **content**. Full steps: use **loadSkill(skillDir)**; do not rely on memorySearch for skill bodies.

For **MEMORY.md** only: use **read** / **write** / **append** on the workspace file path—do not use persistKnowledge for it.

## Current Chat Information
user and assistant chat history
${chatHistory}
`;
}
