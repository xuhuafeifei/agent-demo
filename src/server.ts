import express from "express";
import path from "path";
import cors from "cors";
import { Agent } from "@mariozechner/pi-agent-core";
import dotenv from "dotenv";
import {
  getGlobalModelConfigPath,
  getResolvedApiKey,
  normalizeProviderId,
} from "./agent/model-config";
import { resolveModel } from "./agent/pi-embedded-runner/model";
import { selectModelForRuntime } from "./model-selection";

// 加载环境变量
dotenv.config();

const app = express();
// 未设置 PORT 时使用 0，由系统分配一个可用端口
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;

// 静态文件目录：编译后 __dirname 为 dist/，页面在 src/public
const publicDir = path.join(__dirname, "..", "src", "public");

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

let modelRef: { provider: string; model: string } | undefined;
let model: ReturnType<typeof resolveModel>["model"];
let modelError: string | undefined;

// 存储每个请求的流式回调
const streamCallbacks = new Map<string, (data: unknown) => void>();

function buildAgent() {
  return new Agent({
    getApiKey: (provider) => {
      // 动态按 provider 解析 apiKey，避免调用侧写 if-else。
      return getResolvedApiKey({
        provider: normalizeProviderId(provider),
      });
    },
    initialState: {
      model: model ?? undefined,
      systemPrompt: "你是一个友好的人,能快速回复别人信息",
      thinkingLevel: "off",
      tools: [],
      messages: [],
      isStreaming: false,
      streamMessage: null,
      pendingToolCalls: new Set(),
    },
  });
}

let agent = buildAgent();

function extractAssistantText(content: unknown[] | undefined): string {
  if (!content || !Array.isArray(content)) return "";

  // 仅拼接文本块，忽略 thinking/tool 等非文本内容。
  return (content as { type?: string; text?: string }[])
    .filter((item) => item.type === "text")
    .map((item) => item.text || "")
    .join("");
}

function attachAgentSubscription() {
  agent.subscribe((event) => {
    switch (event.type) {
      case "agent_start":
      case "turn_start":
      case "turn_end":
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end":
        break;
      case "agent_end":
        // Agent 结束时通知所有 SSE 客户端并清理回调。
        streamCallbacks.forEach((callback) => callback({ type: "agent_end" }));
        streamCallbacks.clear();
        break;
      case "message_start":
        // 只把 assistant 消息推给前端，避免 user 事件干扰渲染。
        if (event.message?.role !== "assistant") break;
        streamCallbacks.forEach((callback) => {
          callback({ type: "message_start", message: event.message });
        });
        break;
      case "message_update": {
        // 只处理 assistant 的增量文本事件。
        if (event.message?.role !== "assistant") break;

        const assistantEvent = event.assistantMessageEvent as {
          type?: string;
          delta?: string;
          partial?: { content?: unknown[] };
        };

        const textDelta =
          assistantEvent.type === "text_delta" &&
          typeof assistantEvent.delta === "string"
            ? assistantEvent.delta
            : undefined;

        const fullText = extractAssistantText(assistantEvent.partial?.content);

        streamCallbacks.forEach((callback) => {
          callback({
            type: "message_update",
            message: event.message,
            delta: textDelta,
            text: fullText || undefined,
          });
        });
        break;
      }
      case "message_end": {
        // 只把 assistant 的结束消息发给前端。
        if (event.message?.role !== "assistant") break;

        const message = event.message as { content?: unknown[] };
        streamCallbacks.forEach((callback) => {
          callback({
            type: "message_end",
            message: event.message,
            text: extractAssistantText(message.content),
          });
        });
        break;
      }
    }
  });
}

async function bootstrapModel() {
  const globalConfigPath = getGlobalModelConfigPath();
  console.log(`全局配置路径: ${globalConfigPath}`);

  // 统一选模入口：全局默认 -> 项目回退 -> 代码兜底，然后 resolveModel。
  const selected = await selectModelForRuntime();
  modelRef = selected.modelRef;
  model = selected.model;
  modelError = selected.modelError;

  if (selected.discoveryError) {
    console.error(`模型发现失败: ${selected.discoveryError}`);
  }

  const apiKey = getResolvedApiKey({ provider: modelRef.provider });
  if (!apiKey && modelRef.provider !== "ollama") {
    console.warn(`警告：未配置 ${modelRef.provider.toUpperCase()}_API_KEY，模型可能无法工作`);
  }

  if (!model) {
    console.error(`模型初始化失败: ${modelError ?? "unknown error"}`);
  }

  // 模型变更后重建 agent，保证 initialState 使用最新 model。
  agent = buildAgent();
  attachAgentSubscription();
}

// API 路由：与 Agent 对话（流式输出）
app.post("/api/chat", async (req, res) => {
  const { message } = req.body as { message?: string };
  const requestId = Date.now().toString();

  if (!message) {
    return res.status(400).json({ error: "缺少消息内容" });
  }

  // 模型不可用时直接返回，避免进入 prompt 后才报 provider/auth 错误。
  if (!model) {
    return res.status(503).json({
      error: "模型未初始化，请检查 provider/model 与 API Key 配置",
      provider: modelRef?.provider,
      model: modelRef?.model,
      detail: modelError,
    });
  }
  // activeRef 仅用于日志打印，避免 modelRef 可空带来的类型问题。
  const activeRef = modelRef ?? { provider: "unknown", model: "unknown" };

  // 设置 SSE 响应头。
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const requestStartedAt = Date.now();
  let promptStartedAt = 0;
  let firstAssistantAt = 0;
  let messageEndAt = 0;
  let doneAt = 0;
  let firstAssistantChunkLogged = false;

  // 阶段记录（参考 OpenClaw 的 cacheTrace）
  const stages = new Map<string, { timestamp: number; note?: string }>();
  stages.set("request:start", { timestamp: requestStartedAt });

  const logStage = (stage: string, note?: string) => {
    if (stages.has(stage)) return; // 避免重复记录
    stages.set(stage, { timestamp: Date.now(), note });
  };

  const logFirstAssistantLatency = (source: "message_update" | "message_end") => {
    // 只记录一次首包耗时，避免多段 delta 重复打印。
    if (firstAssistantChunkLogged || promptStartedAt <= 0) return;
    firstAssistantChunkLogged = true;
    firstAssistantAt = Date.now();
    logStage("prompt:first_assistant", `source=${source}`);

    const promptToFirstMs = firstAssistantAt - promptStartedAt;
    const requestToFirstMs = firstAssistantAt - requestStartedAt;
    console.log(
      `[LLM首包] requestId=${requestId} provider=${activeRef.provider} model=${activeRef.model} promptToFirstMs=${promptToFirstMs} requestToFirstMs=${requestToFirstMs} source=${source}`,
    );
  };

  const logRequestTimeline = (status: "done" | "error") => {
    if (doneAt <= 0) doneAt = Date.now();

    const requestToPromptMs = promptStartedAt > 0 ? promptStartedAt - requestStartedAt : -1;
    const promptToFirstMs =
      promptStartedAt > 0 && firstAssistantAt > 0 ? firstAssistantAt - promptStartedAt : -1;
    const firstToEndMs =
      firstAssistantAt > 0 && messageEndAt > 0 ? messageEndAt - firstAssistantAt : -1;
    const promptToEndMs =
      promptStartedAt > 0 && messageEndAt > 0 ? messageEndAt - promptStartedAt : -1;
    const totalMs = doneAt - requestStartedAt;

    // 详细阶段报告
    const stageReport = Array.from(stages.entries())
      .map(([key, value]) => `${key}=${value.timestamp - requestStartedAt}ms`)
      .join(" ");

    console.log(
      `[请求时间线] requestId=${requestId} status=${status} provider=${activeRef.provider} model=${activeRef.model} requestToPromptMs=${requestToPromptMs} promptToFirstMs=${promptToFirstMs} firstToEndMs=${firstToEndMs} promptToEndMs=${promptToEndMs} totalMs=${totalMs} stages=[${stageReport}]`,
    );
  };

  const callback = (data: unknown) => {
    const event = data as { type?: string; delta?: unknown; text?: unknown };

    // 以第一段 assistant 文本作为首包时间点（delta 或 text 任一非空）。
    if (
      !firstAssistantChunkLogged &&
      (event.type === "message_update" || event.type === "message_end")
    ) {
      const deltaText =
        typeof event.delta === "string" ? event.delta.trim() : "";
      const fullText = typeof event.text === "string" ? event.text.trim() : "";
      if (deltaText.length > 0 || fullText.length > 0) {
        logFirstAssistantLatency(event.type);
      }
    }

    if (event.type === "message_end" && messageEndAt <= 0) {
      messageEndAt = Date.now();
      logStage("prompt:end");
    }

    // 每个事件都按 SSE 协议写入，前端按行消费。
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  streamCallbacks.set(requestId, callback);

  try {
    const userMessage = {
      role: "user" as const,
      content: [{ type: "text" as const, text: message }],
      timestamp: Date.now(),
    };

    // 先写入状态，再触发 prompt，保证上下文完整。
    agent.appendMessage(userMessage);

    // 从真正调用模型开始计时。
    promptStartedAt = Date.now();
    logStage("prompt:start");
    await agent.prompt(message);

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
    doneAt = Date.now();
    logStage("request:end");
    logRequestTimeline("done");
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        error: error instanceof Error ? error.message : "服务器内部错误",
      })}\n\n`,
    );
    res.end();
    doneAt = Date.now();
    logStage("request:end");
    logRequestTimeline("error");
  } finally {
    // 请求结束后清理回调，避免内存泄漏。
    streamCallbacks.delete(requestId);
  }
});

// API 路由：获取对话历史
app.get("/api/history", async (_req, res) => {
  try {
    const history = agent.state.messages;
    res.json({ success: true, history });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "服务器内部错误",
    });
  }
});

// API 路由：清除对话历史
app.post("/api/clear", async (_req, res) => {
  try {
    agent.clearMessages();
    res.json({ success: true, message: "对话历史已清除" });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "服务器内部错误",
    });
  }
});

function startServer(port: number) {
  const server = app.listen(port, () => {
    const addr = server.address();
    const actualPort =
      typeof addr === "object" && addr !== null && "port" in addr
        ? addr.port
        : port;

    console.log(`服务器正在运行在 http://localhost:${actualPort}`);
    console.log(`请在浏览器中打开 http://localhost:${actualPort} 查看应用`);
    console.log("注意：需要在 .env 文件中配置 MINIMAX_API_KEY");
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && port !== 0) {
      console.warn(`端口 ${port} 已被占用，正在改用随机可用端口...`);
      server.close(() => startServer(0));
      return;
    }

    console.error("服务器启动失败:", err.message);
    process.exit(1);
  });
}

async function bootstrap() {
  await bootstrapModel();
  startServer(PORT);
}

void bootstrap();
