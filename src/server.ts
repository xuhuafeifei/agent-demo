import express from "express";
import path from "path";
import cors from "cors";
import fs from "fs";
import { Agent } from "@mariozechner/pi-agent-core";
import dotenv from "dotenv";
import {
  normalizeProviderId,
  parseModelRef,
  resolveApiKeyForProvider,
  resolveModel,
} from "./model-selection";

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

// ========== 从 JSON 配置文件读取大模型配置 ==========
const configPath = path.join(__dirname, "..", "config", "model.json");
type ModelConfig = {
  model?: {
    provider?: string;
    model?: string;
    contextTokens?: number;
  };
  apiKey?: Record<string, string>;
};
let modelConfig: ModelConfig = {};

try {
  const configContent = fs.readFileSync(configPath, "utf-8");
  modelConfig = JSON.parse(configContent);
} catch (error) {
  // 使用默认配置或环境变量
}

const defaultProvider = normalizeProviderId(modelConfig.model?.provider ?? "minimax");
const defaultModel = modelConfig.model?.model ?? "MiniMax-M2.1";
const modelRef = parseModelRef(`${defaultProvider}/${defaultModel}`, defaultProvider) ?? {
  provider: defaultProvider,
  model: defaultModel,
};

// 统一通过 model-selection 解析模型与 API key，避免 server.ts 写 provider 分支。
const resolved = resolveModel(modelRef.provider, modelRef.model, { apiKey: modelConfig.apiKey });
const model = resolved.model;
const modelError = resolved.error;
const defaultApiKey = resolveApiKeyForProvider({
  provider: modelRef.provider,
  config: { apiKey: modelConfig.apiKey },
});

if (defaultApiKey) {
  // API Key 已配置
} else {
  console.warn(`警告：未配置 ${modelRef.provider.toUpperCase()}_API_KEY，模型可能无法工作`);
}
if (!model) {
  console.error(`模型初始化失败: ${modelError ?? "unknown error"}`);
}
if (model && modelRef.provider === "minimax") {
  // MiniMax 文档推荐 Anthropic 兼容地址：https://api.minimaxi.com/anthropic
  // 覆盖库内置的历史地址，避免命中旧域名导致鉴权失败。
  (model as { baseUrl?: string }).baseUrl =
    process.env.MINIMAX_ANTHROPIC_BASE_URL?.trim() || "https://api.minimaxi.com/anthropic";
  // 与 MiniMax 官方文档保持一致：同步设置 Anthropic 兼容环境变量。
  if (!(process.env.ANTHROPIC_BASE_URL || "").trim()) {
    process.env.ANTHROPIC_BASE_URL = (model as { baseUrl?: string }).baseUrl;
  }
  if (defaultApiKey && !(process.env.ANTHROPIC_API_KEY || "").trim()) {
    process.env.ANTHROPIC_API_KEY = defaultApiKey;
  }
}

// 初始化 Agent（按 provider 动态读取 API Key）
const agent = new Agent({
  getApiKey: (provider) => {
    const normalized = normalizeProviderId(provider);
    const resolvedKey = resolveApiKeyForProvider({
      provider: normalized,
      config: { apiKey: modelConfig.apiKey },
    });
    // minimax 走 anthropic 兼容接口时，部分调用链可能按 anthropic provider 取 key。
    if (!resolvedKey && modelRef.provider === "minimax" && normalized === "anthropic") {
      return defaultApiKey;
    }
    return resolvedKey;
  },
  initialState: {
    model: model ?? undefined,
    systemPrompt: "你是一个友好的助手。请使用简单的语言回答用户的问题。",
    thinkingLevel: "medium",
    tools: [],
    messages: [],
    isStreaming: false,
    streamMessage: null,
    pendingToolCalls: new Set(),
  },
});

// 存储每个请求的流式回调
const streamCallbacks = new Map<string, (data: any) => void>();

// ========== 大模型请求与返回值 ==========
// 1. 请求入口：下方 POST /api/chat 里的 await agent.prompt(message) 会触发请求。
// 2. 真正发 HTTP 请求在库内部：pi-agent-core 的 agent-loop 调用 streamFn（默认 pi-ai 的 streamSimple），
//    向 Minimax 发流式请求，见 node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js 约 150 行。
// 3. 返回值不通过 prompt() 的 return，而是通过本 subscribe 回调的事件流捕获：
//    - message_update：流式片段（event.message / event.assistantMessageEvent）
//    - message_end：最终完整回复（event.message）
// ==========

// 监听 Agent 事件（这里就是“捕获大模型返回值”的地方）
agent.subscribe((event) => {
  switch (event.type) {
    case "agent_start":
      break;
    case "agent_end":
      // 发送结束事件到所有活跃的流
      streamCallbacks.forEach((callback) => {
        callback({ type: "agent_end" });
      });
      streamCallbacks.clear();
      break;
    case "turn_start":
      break;
    case "turn_end":
      break;
    case "message_start":
      // 只把 assistant 消息推给前端流式卡片，避免 user 事件污染 assistant 渲染状态。
      if (event.message?.role !== "assistant") {
        break;
      }
      // 发送消息开始事件
      streamCallbacks.forEach((callback) => {
        callback({ type: "message_start", message: event.message });
      });
      break;
    case "message_update":
      // 只处理 assistant 的增量文本事件。
      if (event.message?.role !== "assistant") {
        break;
      }
      // 流式输出：发送 delta（若有）和当前完整 partial，便于前端逐字或整段显示
      const ev = event.assistantMessageEvent as {
        type?: string;
        delta?: string;
        partial?: { content?: unknown[] };
      };
      const textDelta =
        ev.type === "text_delta" && typeof ev.delta === "string"
          ? ev.delta
          : undefined;
      const fullText =
        ev.partial?.content && Array.isArray(ev.partial.content)
          ? (ev.partial.content as { type?: string; text?: string }[])
              .filter((c) => c.type === "text")
              .map((c) => c.text || "")
              .join("")
          : undefined;
      streamCallbacks.forEach((callback) => {
        callback({
          type: "message_update",
          message: event.message,
          delta: textDelta,
          text: fullText,
        });
      });
      break;
    case "message_end":
      // 只把 assistant 结束事件返回给前端，避免用户消息覆盖 assistant 输出。
      if (event.message?.role !== "assistant") {
        break;
      }
      // 发送结束事件并带上完整内容（非流式时前端依赖此处显示）
      const msg = event.message as { content?: unknown[] };
      const endText =
        msg.content && Array.isArray(msg.content)
          ? (msg.content as { type?: string; text?: string }[])
              .filter((c) => c.type === "text")
              .map((c) => c.text || "")
              .join("")
          : "";
      streamCallbacks.forEach((callback) => {
        callback({
          type: "message_end",
          message: event.message,
          text: endText,
        });
      });
      break;
    case "tool_execution_start":
      break;
    case "tool_execution_update":
      break;
    case "tool_execution_end":
      break;
  }
});

// API 路由：与 Agent 对话（流式输出）
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;
  const requestId = Date.now().toString();

  if (!message) {
    return res.status(400).json({ error: "缺少消息内容" });
  }

  // 未完成模型初始化时直接返回，避免进入 prompt 后才报 provider/auth 错误。
  if (!model) {
    return res.status(503).json({
      error: "模型未初始化，请检查 provider/model 与 API Key 配置",
      provider: modelRef.provider,
      model: modelRef.model,
      detail: modelError,
    });
  }

  // 设置 SSE 响应头
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // 注册流式回调
  const callback = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  streamCallbacks.set(requestId, callback);

  try {
    // 添加用户消息到 Agent
    const userMessage = {
      role: "user" as const,
      content: [{ type: "text" as const, text: message }],
      timestamp: Date.now(),
    };
    agent.appendMessage(userMessage);

    // 这里会触发对大模型的请求；返回值通过上面的 agent.subscribe() 以事件形式收到
    await agent.prompt(message);

    // 发送完成信号
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        error: error instanceof Error ? error.message : "服务器内部错误",
      })}\n\n`,
    );
    res.end();
  } finally {
    // 清理回调
    streamCallbacks.delete(requestId);
  }
});

// API 路由：获取对话历史
app.get("/api/history", async (req, res) => {
  try {
    const history = agent.state.messages;
    res.json({
      success: true,
      history,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "服务器内部错误",
    });
  }
});

// API 路由：清除对话历史
app.post("/api/clear", async (req, res) => {
  try {
    agent.clearMessages();
    res.json({
      success: true,
      message: "对话历史已清除",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "服务器内部错误",
    });
  }
});

// 启动服务器：先试指定端口，若被占用则自动改用随机可用端口
function startServer(port: number) {
  const server = app.listen(port, () => {
    const addr = server.address();
    const actualPort =
      typeof addr === "object" && addr !== null && "port" in addr ? addr.port : port;
    console.log(`服务器正在运行在 http://localhost:${actualPort}`);
    console.log(`请在浏览器中打开 http://localhost:${actualPort} 查看应用`);
    console.log("注意：需要在 .env 文件中配置 MINIMAX_API_KEY");
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && port !== 0) {
      console.warn(`端口 ${port} 已被占用，正在改用随机可用端口...`);
      server.close(() => startServer(0));
    } else {
      console.error("服务器启动失败:", err.message);
      process.exit(1);
    }
  });
}

startServer(PORT);
