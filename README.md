# Agent Demo

一个使用 `@mariozechner/pi-agent-core` 框架的简单 Node.js 对话应用，支持流式输出。

## 项目介绍

这是一个简陋的对话应用，包含：
- 前端 HTML 页面，包含输入对话框和消息显示区域
- 后端使用 Express 服务器
- 使用 `@mariozechner/pi-agent-core` 框架处理大模型交互
- 集成 OpenAI GPT 模型（需要配置 API 密钥）
- **支持流式输出**：实时显示大模型返回的增量数据

## 框架使用示例

项目使用了 `@mariozechner/pi-agent-core` 的以下核心组件：

### Agent 类
- 初始化 Agent 实例
- 监听 Agent 事件
- 处理用户输入
- 管理对话状态

### AgentState
- 存储系统提示词
- 模型配置
- 思考级别（ThinkingLevel）
- 工具列表
- 对话历史
- 流式传输状态
- 待处理的工具调用

### AgentEvent
监听的事件类型：
- `agent_start`: Agent 开始运行
- `agent_end`: Agent 运行结束
- `turn_start`: 新一轮对话开始
- `turn_end`: 对话轮次结束
- `message_start`: 新消息开始
- `message_update`: **消息更新（流式输出事件）** - 大模型返回的增量数据会触发这个事件
- `message_end`: 消息结束
- `tool_execution_start`: 工具执行开始
- `tool_execution_update`: 工具执行更新
- `tool_execution_end`: 工具执行结束

### 其他类型
- `ThinkingLevel`: 思考级别（off、minimal、low、medium、high、xhigh）
- `AgentContext`: Agent 上下文
- `AgentMessage`: 支持的消息类型
- `AgentTool`: 工具定义
- `AgentToolResult`: 工具执行结果
- `AgentToolUpdateCallback`: 工具更新回调

## 流式输出实现

### 服务器端 (src/server.ts)

使用 SSE (Server-Sent Events) 实现流式输出：

```typescript
// 1. 监听 Agent 的 message_update 事件
agent.subscribe((event) => {
  switch (event.type) {
    case 'message_update':
      // 这是一个流式输出事件！大模型返回的增量数据会触发这个事件
      // event.assistantMessageEvent 包含详细的信息，比如新增的文本 delta
      console.log('消息更新 - 流式输出事件');

      // 发送通过 SSE 到客户端
      streamCallbacks.forEach((callback) => {
        callback({
          type: 'message_update',
          message: event.message,
          assistantMessageEvent: event.assistantMessageEvent,
        });
      });
      break;
  }
});

// 2. 设置 SSE 响应头
app.post('/api/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 注册流式回调
  const callback = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  streamCallbacks.set(requestId, callback);

  // 启动 Agent 循环，这将触发流式事件
  await agent.prompt(message);
});
```

### 客户端 (src/public/index.html)

使用 Fetch API 读取流式响应：

```javascript
// 处理流式响应
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();

  if (done) {
    break;
  }

  buffer += decoder.decode(value, { stream: true });

  // 分割 SSE 事件
  const events = buffer.split('\n\n');
  buffer = events.pop();

  for (const event of events) {
    if (!event.startsWith('data: ')) continue;

    const data = JSON.parse(event.slice(6));

    switch (data.type) {
      case 'message_update':
        // 处理流式更新
        const { message: assistantMessage } = data;
        updateMessage(assistantMessageId, getMessageContent(assistantMessage));
        break;
    }
  }
}
```

## 安装依赖

```bash
npm install
```

## 配置

1. 复制 `.env.example` 为 `.env`：
```bash
cp .env.example .env
```

2. 编辑 `.env` 文件，配置 OpenAI API 密钥：
```env
OPENAI_API_KEY=your_actual_api_key
```

## 运行项目

### 开发模式
```bash
npm run dev
```

### 生产模式
```bash
npm run build
npm run start
```

### 监听文件变化
```bash
npm run watch
```

## 使用

1. 启动服务器后，在浏览器中访问：http://localhost:3000
2. 在输入框中输入消息
3. 点击发送按钮或按 Enter 发送消息
4. **实时查看 AI 的流式回复**

## API 接口

### POST /api/chat
发送消息给 AI 并获取流式回复

请求体：
```json
{
  "message": "用户输入的消息"
}
```

响应（SSE 流式事件）：
```json
{
  "type": "message_update",
  "message": { ... },
  "assistantMessageEvent": { ... }
}
```

### GET /api/history
获取完整的对话历史

响应：
```json
{
  "success": true,
  "history": [
    // 所有对话消息
  ]
}
```

### POST /api/clear
清除对话历史

响应：
```json
{
  "success": true,
  "message": "对话历史已清除"
}
```

## 项目结构

```
agent-demo/
├─ src/
│  ├─ server.ts          # 服务器端代码（TypeScript）
│  └─ public/
│     └─ index.html      # 前端页面
├─ dist/                 # 编译后的 JavaScript 文件（生成）
├─ node_modules/         # 依赖包（生成）
├─ package.json          # 项目配置
├─ tsconfig.json         # TypeScript 配置
├─ .env.example          # 环境变量示例
└─ README.md             # 项目说明
```

## 注意事项

- 项目需要 Node.js v18 或更高版本
- 必须配置有效的 OpenAI API 密钥才能正常使用
- 框架文档：https://github.com/mariozechner/pi-agent
- 更多示例：https://github.com/mariozechner/pi-agent-examples

## 关于 sessionManager 和 AgentSession

在 `@mariozechner/pi-agent-core` 的当前版本中，**没有 `sessionManager` 或 `AgentSession` 类**。

框架通过以下方式实现会话管理：

1. **Agent 类本身**：每个 Agent 实例维护自己的状态（消息、工具、系统提示等）
2. **sessionId 属性**：Agent 支持设置 sessionId，用于提供商的会话缓存
3. **subscribe 方法**：监听 Agent 事件，包括流式输出事件

如需管理多个会话，可以创建多个 Agent 实例，每个实例代表一个独立的会话。