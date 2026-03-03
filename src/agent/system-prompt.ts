export type BuildSystemPromptInput = {
  soul: string;
  user?: string;
  nowText: string;
  language: string;
  sessionMemory?: string;
  historyMemory?: string;
};

function nonEmptyOrFallback(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
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
  const sessionMemory = nonEmptyOrFallback(input.sessionMemory, "N/A");
  const historyMemory = nonEmptyOrFallback(input.historyMemory, "N/A");

  return `## who you are
${soul}

## user
${user}

## environment
current date ${nowText}

## language
current language is ${language}, you need answer in ${language}

## memory recall
memory from session
${sessionMemory}

memory from history
${historyMemory}
`;
}
