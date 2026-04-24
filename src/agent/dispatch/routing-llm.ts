import type { RuntimeModel } from "../../types.js";

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

/** 路由系统提示词 - 定义路由 Agent 的行为和输出约束 */
const ROUTER_SYSTEM_PROMPT = `你是路由 Agent（lane router）。你的任务是结合「最近一段时间内的用户输入」与「当前这一轮用户输入」，判断本次应答应路由到哪条执行 lane（agent 能力档位）。

lane 含义：
- light：偏日常闲聊、情绪表达、生活琐事、轻量问答；通常不需要复杂工具、长程推理或大规模代码改动。
- heavy：偏工程实现、代码与调试、复杂多步任务、工具编排、严肃问题分析与方案落地。

输出约束（必须严格遵守）：
- 只输出一个 JSON 对象，不要输出任何其它内容（不要 Markdown 代码块、不要解释、不要前后缀）。
- 必须包含字段 reasoning（字符串）：用 1～5 句中文简要说明「依据历史/当前内容为何选该 lane」；便于排障与优化，随后才是结构化结果。
- 必须包含字段：lane、emotions、emotionRate；键名与类型如下：
  {"reasoning":字符串,"lane":"light"|"heavy","emotions":字符串数组,"emotionRate":数字}
- emotionRate 为 0~1 的浮点数；emotions 为简短中文情绪词（可空数组）。
- 字符串里不要使用未转义的双引号，避免整段不是合法 JSON。

请综合历史用户输入与当前输入的连续性；若历史为空，仅依据当前输入即可。`;

/**
 * 构建路由模型的用户输入内容
 * @param input - 包含当前用户输入和最近用户输入历史的对象
 * @returns 格式化后的用户输入内容字符串
 */
function buildRouterUserContent(input: {
  currentUserInput: string;
  recentUserInputs: string[];
}): string {
  // 处理最近用户输入历史，确保格式统一且长度限制
  const recent = input.recentUserInputs
    .map((t) => t.replace(/\s+/g, " ").trim()) // 归一化空白字符
    .filter(Boolean) // 过滤空字符串
    .map((t) =>
      t.length > ROUTER_HISTORY_SNIPPET_MAX_CHARS
        ? `${t.slice(0, ROUTER_HISTORY_SNIPPET_MAX_CHARS)}…` // 过长内容截断
        : t,
    );

  // 构建历史记录块
  const historyBlock =
    recent.length === 0
      ? "（无历史记录：会话中尚无可用的近期用户输入。）"
      : recent.map((line, i) => `${i + 1}. ${line}`).join("\n");

  // 处理当前用户输入
  const current = input.currentUserInput
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ROUTER_CURRENT_INPUT_MAX_CHARS);

  // 组合成最终的用户输入内容
  return `以下为从会话记录中读取的最近若干条用户输入（不含当前这一轮；按时间从旧到新；每条至多 ${ROUTER_HISTORY_SNIPPET_MAX_CHARS} 字）：

${historyBlock}

当前这一轮用户输入：
${current || "（空）"}`;
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
 * @param input - 用户输入信息（当前输入 + 最近历史输入）
 * @param options - 调用选项（支持流式分片回调）
 * @returns 包含解析后的路由结果和原始文本的对象
 */
export async function invokeLaneRouterModel(
  model: RuntimeModel,
  input: { currentUserInput: string; recentUserInputs: string[] },
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

  // 发送请求
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

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
