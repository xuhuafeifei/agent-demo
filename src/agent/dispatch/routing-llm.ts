import type { RuntimeModel } from "../../types.js";

/**
 * 路由 LLM：固定走 OpenAI Chat Completions 兼容协议。
 * POST JSON：`{ model, messages, temperature, max_tokens }`
 * 响应：`choices[0].message.content`
 */
function openAiCompatChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1")
    ? `${trimmed}/chat/completions`
    : `${trimmed}/v1/chat/completions`;
}

export type RouterModelOutput = {
  lane: "light" | "heavy";
  emotions: string[];
  emotionRate: number;
};

const ROUTER_HISTORY_SNIPPET_MAX_CHARS = 200;
const ROUTER_CURRENT_INPUT_MAX_CHARS = 8000;

const ROUTER_SYSTEM_PROMPT = `你是路由 Agent（lane router）。你的任务是结合「最近一段时间内的用户输入」与「当前这一轮用户输入」，判断本次应答应路由到哪条执行 lane（agent 能力档位）。

lane 含义：
- light：偏日常闲聊、情绪表达、生活琐事、轻量问答；通常不需要复杂工具、长程推理或大规模代码改动。
- heavy：偏工程实现、代码与调试、复杂多步任务、工具编排、严肃问题分析与方案落地。

输出约束（必须严格遵守）：
- 只输出一个 JSON 对象，不要输出任何其它内容（不要 Markdown 代码块、不要解释、不要前后缀）。
- 键名与类型必须一致：{"lane":"light"|"heavy","emotions":字符串数组,"emotionRate":数字}
- emotionRate 为 0~1 的浮点数，表示用户情绪/激动程度；emotions 为简短中文情绪词（可空数组）。

请综合历史用户输入与当前输入的连续性；若历史为空，仅依据当前输入即可。`;

function buildRouterUserContent(input: {
  currentUserInput: string;
  recentUserInputs: string[];
}): string {
  const recent = input.recentUserInputs
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((t) =>
      t.length > ROUTER_HISTORY_SNIPPET_MAX_CHARS
        ? `${t.slice(0, ROUTER_HISTORY_SNIPPET_MAX_CHARS)}…`
        : t,
    );

  const historyBlock =
    recent.length === 0
      ? "（无历史记录：会话中尚无可用的近期用户输入。）"
      : recent.map((line, i) => `${i + 1}. ${line}`).join("\n");

  const current = input.currentUserInput
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ROUTER_CURRENT_INPUT_MAX_CHARS);

  return `以下为从会话记录中读取的最近若干条用户输入（不含当前这一轮；按时间从旧到新；每条至多 ${ROUTER_HISTORY_SNIPPET_MAX_CHARS} 字）：

${historyBlock}

当前这一轮用户输入：
${current || "（空）"}`;
}

export async function invokeLaneRouterModel(
  model: RuntimeModel,
  input: { currentUserInput: string; recentUserInputs: string[] },
): Promise<{ parsed: RouterModelOutput; rawText: string }> {
  const url = openAiCompatChatCompletionsUrl(model.baseUrl);
  const userContent = buildRouterUserContent(input);
  const body = {
    model: model.id,
    messages: [
      { role: "system" as const, content: ROUTER_SYSTEM_PROMPT },
      { role: "user" as const, content: userContent },
    ],
    temperature: 0,
    max_tokens: 256,
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}),
    ...(model.headers ?? {}),
  };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`router http ${res.status}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = json.choices?.[0]?.message?.content?.trim() ?? "";
  const parsed = parseRouterJson(rawText);
  return { parsed, rawText };
}

function parseRouterJson(rawText: string): RouterModelOutput {
  const tryJson = (s: string): RouterModelOutput => {
    const o = JSON.parse(s) as Record<string, unknown>;
    const lane = o.lane === "light" || o.lane === "heavy" ? o.lane : null;
    if (!lane) throw new Error("bad lane");
    const emotions = Array.isArray(o.emotions)
      ? o.emotions.map((x) => String(x)).filter(Boolean)
      : [];
    const emotionRate =
      typeof o.emotionRate === "number" && !Number.isNaN(o.emotionRate)
        ? o.emotionRate
        : 0;
    return { lane, emotions, emotionRate };
  };
  try {
    return tryJson(rawText);
  } catch {
    const m = rawText.match(/\{[\s\S]*\}/);
    if (m) return tryJson(m[0]);
    throw new Error("no json");
  }
}
