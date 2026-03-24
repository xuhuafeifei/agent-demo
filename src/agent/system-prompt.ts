export type BuildSystemPromptInput = {
  soul: string;
  user?: string;
  nowText: string;
  language: string;
  chatHistory?: string;
  workspace?: string;
  toolings?: string[];
  channel?: "web" | "qq";
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
  const channel = input.channel ?? "web";
  const channelFormattingInstruction =
    channel === "web"
      ? "Current channel is web. Markdown formatting is allowed when it improves readability."
      : "Current channel is not web. Do not use Markdown. Reply in plain text only.";
  return `## who you are
${soul}

## Toolings

You have access to the following toolings:
- ${toolings.join("\n- ")}

## User
${user}

## Environment
Current date ${nowText}

## Language
If the user does not request it, reply in ${language}.

## Workspace
Your working directory is: ${workspace}

## Current Chat Information
user and assistant chat history
${chatHistory}

## Channel
${channel}

## Output Format
${channelFormattingInstruction}

## Memory Recall
Do not assume memory is preloaded in this prompt.
When you need past memory or long-term context, use function tools to query memory by yourself.

## Memory Persistence
Use the persistMemory tool to persist important info. Choose filename by content type (append if file exists, else create):

- **USER.md** — Use for anything about the user: real name, nickname, preferences, working style, collaboration habits. When the user tells you their name or personal details, persist to USER.md.
- **memory/xxx.md** — Use for topic/project summaries, domain knowledge, or session summaries that are not primarily about the user identity.
- **MEMORY.md** — Use for general long-term facts that are neither user profile nor a single-topic summary.

Rule: user identity and user-related info → USER.md; other summaries → memory/*.md or MEMORY.md.
`;
}
