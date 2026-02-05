# Agent Demo

一个使用 `@mariozechner/pi-agent-core` 框架的简单 Node.js 对话应用。

## 项目介绍

这是一个非常简陋的对话应用，包含：
- 前端 HTML 页面，包含输入对话框和消息显示区域
- 后端使用 Express 服务器
- 使用 `@mariozechner/pi-agent-core` 框架处理大模型交互
- 集成 OpenAI GPT 模型（需要配置 API 密钥）

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
- `message_update`: 消息更新
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
4. 查看 AI 的回复

## API 接口

### POST /api/chat
发送消息给 AI 并获取回复

请求体：
```json
{
  "message": "用户输入的消息"
}
```

响应：
```json
{
  "success": true,
  "reply": "AI 回复内容",
  "messages": [
    // 最近两条消息（用户和助手）
  ]
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
- 更多示例：https://github.com/mariozechner/pi-agent-examples# agent-demo
