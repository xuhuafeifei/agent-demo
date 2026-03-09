export type BuildSystemPromptInput = {
  soul: string;
  user?: string;
  nowText: string;
  language: string;
  chatHistory?: string;
  workspace?: string;
  toolings?: string[];
};

function nonEmptyOrFallback(value: string | undefined, fallback: string): string {
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
  return `## who you are
${soul}

## Toolings

You have access to the following toolings:
- ${toolings.join("\n- ")}

## User
${user}

## Environment
current date ${nowText}

## Language
current language is ${language}, you need answer in ${language}

## Workspace
Your working directory is: ${workspace}

## Current Chat Information
user and assistant chat history
${chatHistory}

## Memory Recall
Do not assume memory is preloaded in this prompt.
When you need past memory or long-term context, use function tools to query memory by yourself.
`;
}
