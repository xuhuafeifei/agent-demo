import type { RuntimeModel } from "../../types.js";
import type { RouterLaneHistoryLine } from "../runtime/run.helper.js";

/**
 * 路由 LLM：固定走 OpenAI Chat Completions 兼容协议。
 * POST JSON：`{ model, messages, temperature, max_tokens, stream: true }`
 * 流式响应：SSE `data: { choices[0].delta.content }` 拼接为完整文本后再解析 JSON。
 */

/**
 * 构建 OpenAI 兼容的 Chat Completions API  URL
 * @param baseUrl - 模型的基础 URL（支持带 /v1 后缀或不带的格式）
 * @returns 完整的 Chat Completions API 端点 URL
 */
function openAiCompatChatCompletionsUrl(baseUrl: string): string {
  // 去除 URL 末尾的斜杠
  const trimmed = baseUrl.replace(/\/+$/, "");
  // 确保返回 /v1/chat/completions 格式的端点
  return trimmed.endsWith("/v1")
    ? `${trimmed}/chat/completions`
    : `${trimmed}/v1/chat/completions`;
}

/**
 * 路由模型输出类型定义
 */
export type RouterModelOutput = {
  /**
   * 路由 lane 类型：
   * - light：偏日常闲聊、情绪表达、生活琐事、轻量问答；通常不需要复杂工具、长程推理或大规模代码改动。
   * - heavy：偏工程实现、代码与调试、复杂多步任务、工具编排、严肃问题分析与方案落地。
   */
  lane: "light" | "heavy";
  /**
   * 简要的判断依据/思考过程（与 lane 等在同一 JSON 内输出，用于排查与继续优化提示词；不要求很长）。
   */
  reasoning: string;
  /** 用户情绪标签数组（简短中文情绪词） */
  emotions: string[];
  /** 用户情绪/激动程度（0~1 的浮点数） */
  emotionRate: number;
};

/** 历史输入片段的最大字符数限制 */
const ROUTER_HISTORY_SNIPPET_MAX_CHARS = 200;
/** 当前输入的最大字符数限制 */
const ROUTER_CURRENT_INPUT_MAX_CHARS = 8000;
/** 路由模型请求超时时间（毫秒） */
const ROUTER_REQUEST_TIMEOUT_MS = 10_000;

/** 路由系统提示词 - 定义路由 Agent 的行为和输出约束 */
const ROUTER_SYSTEM_PROMPT = `You are a routing Agent (lane router). Your task is to determine which execution lane (agent capability level) should be used for the current response, combining both "recent user inputs" and "the current user input".

Lane definitions:
- light: This lane is for casual conversations, emotional expressions, daily life matters, or lightweight Q&A; usually does not require complex tools, long-term reasoning, or large-scale code modifications.
- heavy: This lane is for engineering implementations, code and debugging, complex multi-step tasks, tool orchestration, rigorous problem analysis, solution implementation, or knowledge/design-related scenarios.

Output constraints (must be strictly followed):
- Output ONLY a single JSON object, and nothing else (no Markdown code blocks, no explanations, no prefixes or suffixes).
- The JSON must include the field "reasoning" (string): in 1-5 concise sentences, briefly explain in Chinese "why this lane was selected based on the history/current content"; this is for debugging and optimization, and comes before the structured result.
- Must include the fields: lane, emotions, emotionRate; the key names and types are as follows:
  {"reasoning":string,"lane":"light"|"heavy","emotions":string[],"emotionRate":number}
- emotionRate is a floating-point number between 0 and 1; emotions are short Chinese emotion words (can be an empty array).
- Do NOT use unescaped double quotes in strings, to ensure the entire output is valid JSON.

Please take into account the continuity between the historic dialogue and the current input; if the history is empty, judge based only on the current input. In the user message, the "Earlier dialogue" block lists lane timeline events in chronological order (oldest first): each line uses the same event timestamp as stored in lane jsonl (the numeric "timestamp" field on each line, shown as ISO-8601 in brackets), then role, lane mode, and body. The "Current turn" line uses the routing request time because this turn is not yet appended to lane when routing runs.`;

/**
 * 当前轮（尚未写入 lane）：`[ISO-8601] current (pending lane) 正文`。
 */
function formatRouterCurrentTurnLine(
  atMs: number,
  rawText: string,
  bodyMaxChars: number,
): string {
  const normalized = rawText.replace(/\s+/g, " ").trim();
  const body =
    normalized.length > bodyMaxChars
      ? `${normalized.slice(0, bodyMaxChars)}...`
      : normalized;
  const timeLabel = new Date(atMs).toISOString();
  return `[${timeLabel}] current (pending lane) ${body || "(empty)"}`;
}

/**
 * lane 历史一行：时间与 jsonl 中该条 `timestamp` 对齐；`role` / `laneMode` 与落盘字段一致。
 */
function formatLaneHistoryLine(
  line: RouterLaneHistoryLine,
  bodyMaxChars: number,
): string {
  const body =
    line.text.length > bodyMaxChars
      ? `${line.text.slice(0, bodyMaxChars)}...`
      : line.text;
  const timeLabel = new Date(line.atMs).toISOString();
  return `[${timeLabel}] ${line.role} (${line.laneMode}) ${body}`;
}

/**
 * 组装路由模型的 user 消息：**当前轮在前**，其后为 lane jsonl 对齐的对话时间线（从旧到新）。
 */
function buildRouterUserContent(input: {
  currentUserInput: string;
  currentAtMs: number;
  recentLaneDialogue: RouterLaneHistoryLine[];
}): string {
  const currentLine = formatRouterCurrentTurnLine(
    input.currentAtMs,
    input.currentUserInput,
    ROUTER_CURRENT_INPUT_MAX_CHARS,
  );

  const historyLines = input.recentLaneDialogue.map((item) =>
    formatLaneHistoryLine(item, ROUTER_HISTORY_SNIPPET_MAX_CHARS),
  );
  const historyBlock =
    historyLines.length === 0
      ? "Earlier dialogue (from lane jsonl): (none — no prior events.)"
      : `Earlier dialogue (from lane jsonl, oldest first; body up to ${ROUTER_HISTORY_SNIPPET_MAX_CHARS} chars per line; bracketed time = event timestamp):\n${historyLines.join("\n")}`;

  return `Current turn (route primarily for this message; time is request time, not yet in lane):
${currentLine}

${historyBlock}`;
}

/**
 * 从单行 SSE data 中提取 delta.content
 * @param dataLine - SSE 数据行（格式：data: {...}）
 * @param onDelta - 处理 delta 内容的回调函数
 * @returns 提取到的内容字符串（空字符串表示未提取到有效内容）
 */
function appendContentFromSseDataLine(
  dataLine: string,
  onDelta: (delta: string) => void,
): string {
  const t = dataLine.trim();
  if (!t.startsWith("data:")) {
    return "";
  }
  // 去除 data: 前缀
  const data = t.slice(5).trim();
  if (data === "" || data === "[DONE]") {
    return "";
  }
  try {
    // 解析 JSON 并提取 delta.content
    const j = JSON.parse(data) as {
      choices?: Array<{
        delta?: { content?: string | null };
      }>;
    };
    const c = j.choices?.[0]?.delta?.content;
    if (typeof c === "string" && c.length > 0) {
      onDelta(c);
      return c;
    }
  } catch {
    // 忽略单帧非 JSON 格式的错误
  }
  return "";
}

/**
 * 消费整段 text/event-stream 响应
 * @param res - fetch 响应对象
 * @param onDelta - 处理流式内容分片的回调函数
 * @returns 完整的响应文本
 */
async function readChatCompletionSse(
  res: Response,
  onDelta: (delta: string) => void,
): Promise<string> {
  const body = res.body;
  if (!body) {
    throw new Error("router stream: empty body");
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  // 逐块读取响应流
  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }

    // 按行分割缓冲区
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    // 处理每一行数据
    for (const line of lines) {
      const piece = appendContentFromSseDataLine(line, onDelta);
      if (piece) {
        full += piece;
      }
    }

    if (done) {
      break;
    }
  }

  // 处理最后剩余的缓冲区内容
  if (buffer.trim()) {
    const piece = appendContentFromSseDataLine(buffer, onDelta);
    if (piece) {
      full += piece;
    }
  }

  return full;
}

/**
 * 调用路由模型的选项
 */
export type InvokeLaneRouterModelOptions = {
  /** 流式分片回调：便于日志观察模型逐字输出再拼成路由 JSON */
  onStreamDelta?: (delta: string) => void;
};

/**
 * 调用路由模型并获取路由决策
 * @param model - 运行时模型配置
 * @param input - 用户输入信息：`currentUserInput` / `currentAtMs` 为当前轮；`recentLaneDialogue` 为 lane 活跃 jsonl 尾部片段（`timestamp` / `role` / `laneMode` / `content` 与落盘一致）
 * @param options - 调用选项（支持流式分片回调）
 * @returns 包含解析后的路由结果和原始文本的对象
 */
export async function invokeLaneRouterModel(
  model: RuntimeModel,
  input: {
    currentUserInput: string;
    currentAtMs: number;
    recentLaneDialogue: RouterLaneHistoryLine[];
  },
  options: InvokeLaneRouterModelOptions = {},
): Promise<{ parsed: RouterModelOutput; rawText: string }> {
  const { onStreamDelta = () => {} } = options;
  // 构建 API 端点 URL
  const url = openAiCompatChatCompletionsUrl(model.baseUrl);
  // 构建用户输入内容
  const userContent = buildRouterUserContent(input);

  // 构建请求体
  const body = {
    model: model.id,
    messages: [
      { role: "system" as const, content: ROUTER_SYSTEM_PROMPT },
      { role: "user" as const, content: userContent },
    ],
    temperature: 0, // 0 表示确定性输出
    max_tokens: 1024, // reasoning + 结构化字段，给足长度
    stream: true, // 启用流式响应
  };

  // 构建请求头
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}),
    ...(model.headers ?? {}),
  };

  // 发送请求（10s 超时保护）
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    ROUTER_REQUEST_TIMEOUT_MS,
  );
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `router request timeout after ${ROUTER_REQUEST_TIMEOUT_MS}ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`router http ${res.status}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  let rawText: string;

  // 处理不同类型的响应
  if (contentType.includes("application/json")) {
    // 非流式响应（JSON 格式）
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    rawText = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (rawText) {
      onStreamDelta(rawText);
    }
  } else {
    // 流式响应（SSE 格式）
    rawText = (await readChatCompletionSse(res, onStreamDelta)).trim();
  }

  // 解析响应内容
  const parsed = parseRouterJson(rawText);
  return { parsed, rawText };
}

/**
 * 解析路由模型返回的 JSON 字符串
 * @param rawText - 原始文本（支持包含 JSON 的原始响应）
 * @returns 解析后的路由结果
 * @throws 当无法解析有效的 JSON 或 lane 字段无效时抛出错误
 */
function parseRouterJson(rawText: string): RouterModelOutput {
  /**
   * 内部 JSON 解析函数
   * @param s - JSON 字符串
   * @returns 解析后的路由结果
   */
  const tryJson = (s: string): RouterModelOutput => {
    const o = JSON.parse(s) as Record<string, unknown>;
    // 验证 lane 字段
    const lane = o.lane === "light" || o.lane === "heavy" ? o.lane : null;
    if (!lane) throw new Error("bad lane");
    const reasoningRaw =
      typeof o.reasoning === "string" && o.reasoning.trim() !== ""
        ? o.reasoning.trim()
        : typeof o.thinking === "string"
          ? o.thinking.trim()
          : "";
    // 验证 emotions 字段
    const emotions = Array.isArray(o.emotions)
      ? o.emotions.map((x) => String(x)).filter(Boolean)
      : [];
    // 验证 emotionRate 字段
    const emotionRate =
      typeof o.emotionRate === "number" && !Number.isNaN(o.emotionRate)
        ? o.emotionRate
        : 0;
    return { lane, reasoning: reasoningRaw, emotions, emotionRate };
  };

  try {
    // 首先尝试直接解析整个文本
    return tryJson(rawText);
  } catch {
    // 如果直接解析失败，尝试从文本中提取 JSON 对象
    const m = rawText.match(/\{[\s\S]*\}/);
    if (m) {
      return tryJson(m[0]);
    }
    throw new Error("no json");
  }
}
