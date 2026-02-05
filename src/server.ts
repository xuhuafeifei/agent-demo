import express from 'express';
import cors from 'cors';
import { Agent } from '@mariozechner/pi-agent-core';
import { getModel } from '@mariozechner/pi-ai';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 初始化 OpenAI 模型（需要配置环境变量）
const model = getModel('openai', 'gpt-4o');

// 初始化 Agent
const agent = new Agent({
  initialState: {
    model,
    systemPrompt: '你是一个友好的助手。请使用简单的语言回答用户的问题。',
    thinkingLevel: 'medium',
    tools: [],
    messages: [],
    isStreaming: false,
    streamMessage: null,
    pendingToolCalls: new Set(),
  },
});

// 存储每个请求的流式回调
const streamCallbacks = new Map<string, (data: any) => void>();

// 监听 Agent 事件
agent.subscribe((event) => {
  console.log('Agent 事件:', event.type);

  switch (event.type) {
    case 'agent_start':
      console.log('Agent 开始运行');
      break;
    case 'agent_end':
      console.log('Agent 运行结束，总消息数:', event.messages.length);
      // 发送结束事件到所有活跃的流
      streamCallbacks.forEach((callback) => {
        callback({ type: 'agent_end' });
      });
      streamCallbacks.clear();
      break;
    case 'turn_start':
      console.log('新一轮对话开始');
      break;
    case 'turn_end':
      console.log('对话轮次结束');
      break;
    case 'message_start':
      console.log('新消息开始:', event.message?.role);
      // 发送消息开始事件
      streamCallbacks.forEach((callback) => {
        callback({ type: 'message_start', message: event.message });
      });
      break;
    case 'message_update':
      // 这是一个流式输出事件！大模型返回的增量数据会触发这个事件
      // event.assistantMessageEvent 包含详细的信息，比如新增的文本 delta
      console.log('消息更新 - 流式输出事件');

      // 发送流式更新到客户端
      streamCallbacks.forEach((callback) => {
        callback({
          type: 'message_update',
          message: event.message,
          assistantMessageEvent: event.assistantMessageEvent,
        });
      });
      break;
    case 'message_end':
      console.log('消息结束');
      // 发送消息结束事件
      streamCallbacks.forEach((callback) => {
        callback({ type: 'message_end', message: event.message });
      });
      break;
    case 'tool_execution_start':
      console.log('工具执行开始:', event.toolName);
      break;
    case 'tool_execution_update':
      console.log('工具执行更新');
      break;
    case 'tool_execution_end':
      console.log('工具执行结束:', event.toolName, '是否错误:', event.isError);
      break;
  }
});

// API 路由：与 Agent 对话（流式输出）
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  const requestId = Date.now().toString();

  if (!message) {
    return res.status(400).json({ error: '缺少消息内容' });
  }

  console.log('收到用户消息:', message);

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 注册流式回调
  const callback = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  streamCallbacks.set(requestId, callback);

  try {
    // 添加用户消息到 Agent
    const userMessage = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: message }],
      timestamp: Date.now(),
    };
    agent.appendMessage(userMessage);

    // 启动 Agent 循环，这将触发流式事件
    await agent.prompt(message);

    // 发送完成信号
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    console.error('对话处理失败:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error instanceof Error ? error.message : '服务器内部错误',
    })}\n\n`);
    res.end();
  } finally {
    // 清理回调
    streamCallbacks.delete(requestId);
  }
});

// API 路由：获取对话历史
app.get('/api/history', async (req, res) => {
  try {
    const history = agent.state.messages;
    res.json({
      success: true,
      history,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '服务器内部错误',
    });
  }
});

// API 路由：清除对话历史
app.post('/api/clear', async (req, res) => {
  try {
    agent.clearMessages();
    res.json({
      success: true,
      message: '对话历史已清除',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '服务器内部错误',
    });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器正在运行在 http://localhost:${PORT}`);
  console.log('请在浏览器中打开 http://localhost:3000 查看应用');
  console.log('注意：需要在 .env 文件中配置 OPENAI_API_KEY');
});