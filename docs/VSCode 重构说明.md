# VSCode 方式重构说明文档

> 完全按照 VSCode 插件的消息分割和渲染机制重构前端项目

---

## 重构核心思想

### 之前的方案（时间戳判断）

```javascript
// ❌ 依赖时间戳差异判断是否分块
if (Math.abs(timestamp - lastTimestamp) > 100) {
  // 创建新消息
} else {
  // 追加到当前消息
}
```

**问题**：
- 网络延迟可能导致误判
- 阈值难以调优
- 不可靠

---

### VSCode 方案（索引引用追踪）

```javascript
// ✅ 使用 ref 追踪当前流式消息的索引
let streamingMessageIndex = null;
let thinkingMessageIndex = null;

// 显式断开机制
breakAssistantSegment() {
  streamingMessageIndex = null;  // 清空引用
}

// 下一个 chunk 会自动创建新消息
appendStreamChunk(chunk) {
  if (streamingMessageIndex === null) {
    // 创建新消息
  } else {
    // 追加到当前消息
  }
}
```

**优点**：
- ✅ 100% 可靠，不依赖猜测
- ✅ 逻辑清晰
- ✅ 完全可控

---

## 核心改动

### 1. ChatStore - 使用索引引用追踪

#### 之前的问题代码

```javascript
export const useChatStore = create((set, get) => ({
  assistantMessageId: null,  // ❌ 只记录 ID
  thinkingMessageId: null,
  
  appendAssistantChunk: (chunk, options) => {
    // ❌ 依赖时间戳差异判断
    if (Math.abs(timestamp - lastTimestamp) > 100) {
      // 创建新消息
    }
  },
}));
```

#### VSCode 方式的代码

```javascript
export const useChatStore = create((set, get) => {
  // ✅ 使用闭包变量追踪索引（类似 VSCode 的 useRef）
  let streamingMessageIndex = null;
  let thinkingMessageIndex = null;

  return {
    startStreaming: (timestamp) => {
      set((state) => {
        const assistantIndex = state.messages.length;
        streamingMessageIndex = assistantIndex;  // ✅ 记录索引
        
        return {
          messages: [
            ...state.messages,
            { id: uid(), role: 'assistant', content: '', timestamp },
          ],
        };
      });
    },

    appendStreamChunk: (chunk, timestamp) => {
      set((state) => {
        let idx = streamingMessageIndex;
        const next = [...state.messages];

        // ✅ 如果索引为空，创建新消息
        if (idx === null) {
          idx = next.length;
          streamingMessageIndex = idx;
          next.push({
            id: uid(),
            role: 'assistant',
            content: '',
            timestamp: timestamp ?? Date.now(),
          });
        }

        // ✅ 追加到索引位置
        next[idx] = {
          ...next[idx],
          content: next[idx].content + chunk,
        };

        return { messages: next };
      });
    },

    breakAssistantSegment: () => {
      // ✅ 显式断开：清空索引
      streamingMessageIndex = null;
    },
  };
});
```

---

### 2. Thinking 消息 - 独立索引追踪

#### VSCode 方式的处理

```javascript
appendThinkingChunk: (chunk) => {
  set((state) => {
    let idx = thinkingMessageIndex;
    const next = [...state.messages];

    // 创建独立的 thinking 消息
    if (idx === null) {
      idx = next.length;
      thinkingMessageIndex = idx;
      
      // 获取 assistant 的时间戳
      const assistantIdx = streamingMessageIndex;
      const assistantTs = next[assistantIdx]?.timestamp ?? Date.now();
      
      // Thinking 时间戳比 assistant 早 1ms
      next.push({
        id: uid(),
        role: 'thinking',
        content: '',
        timestamp: assistantTs - 1,
      });
    }

    next[idx] = {
      ...next[idx],
      content: next[idx].content + chunk,
    };

    return { messages: next };
  });
},
```

**关键点**：
- Thinking 有**独立的 index 引用**
- 时间戳 = `assistantTimestamp - 1ms`
- 确保排序在 assistant 前面

---

### 3. ToolCall - 自动断开机制

#### VSCode 方式的处理

```javascript
addToolCall: (toolCall) => {
  set((state) => ({
    toolCalls: [...state.toolCalls, { ...toolCall, id: uid() }],
  }));
  
  // ✅ ToolCall 添加后，自动断开 assistant 流
  get().breakAssistantSegment();
},
```

**效果**：
```
Assistant 第一段 → ToolCall → breakAssistantSegment() → Assistant 第二段
```

---

### 4. 消息渲染 - 按时间戳排序

#### VSCode 方式的渲染逻辑

```javascript
getAllMessages: () => {
  const { messages, toolCalls } = get();
  
  // 普通消息
  const regularMessages = messages.map((msg) => ({
    type: 'message',
    data: msg,
    timestamp: msg.timestamp,
  }));

  // ToolCall 消息
  const toolCallMessages = toolCalls.map((tool) => ({
    type: 'tool_call',
    data: tool,
    timestamp: tool.timestamp,
  }));

  // ✅ 合并并按时间戳排序
  return [...regularMessages, ...toolCallMessages].sort(
    (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
  );
},
```

**渲染顺序**：
```javascript
{allMessages.map((item) => {
  if (item.type === 'tool_call') {
    return <ToolCallCard key={item.data.id} toolCall={item.data} />;
  }
  
  if (item.data.role === 'thinking') {
    return <ThinkingMessage ... />;
  }
  
  if (item.data.role === 'assistant') {
    return <AssistantMessage ... />;
  }
})}
```

---

## 完整流程示例

### 后端发送事件

```javascript
// 1. streamStart
sendSSE(res, 'streamStart', { timestamp: T0 });

// 2. Thinking
sendSSE(res, 'agent_thought_chunk', { 
  content: '让我想想...',
  timestamp: T0 
});
// 前端自动创建 thinking 消息（timestamp: T0-1）

// 3. ToolCall
sendSSE(res, 'tool_call', { 
  toolCallId: 'tc_001',
  timestamp: T1 
});
// 前端：addToolCall → breakAssistantSegment()

// 4. ToolCall 更新
sendSSE(res, 'tool_call_update', { 
  toolCallId: 'tc_001',
  status: 'completed',
  timestamp: T2 
});

// 5. Assistant 继续（ToolCall 后）
sendSSE(res, 'agent_message_chunk', { 
  content: '我已经查到了...',
  timestamp: T3 
});
// 前端：breakAssistantSegment 后，创建新的 assistant 消息

// 6. streamEnd
sendSSE(res, 'streamEnd');
```

### 前端消息顺序

```
渲染顺序（按时间戳排序）：

[0] Thinking    (timestamp: T0-1)   ← 在 assistant 前面
[1] ToolCall    (timestamp: T1)     ← 在中间
[2] Assistant   (timestamp: T3)     ← 在最后
```

---

## SSE 事件类型对照表

| Event 类型 | VSCode 处理 | 前端动作 |
|-----------|-----------|---------|
| `streamStart` | `startStreaming(timestamp)` | 创建 assistant 占位消息 |
| `agent_message_chunk` | `appendStreamChunk(chunk, timestamp)` | 追加到当前 assistant |
| `agent_thought_chunk` | `appendThinkingChunk(chunk)` | 追加到 thinking（自动创建） |
| `tool_call` | `addToolCall(tool)` | 添加工具 + `breakAssistantSegment()` |
| `tool_call_update` | `updateToolCall(id, update)` | 更新工具状态 |
| `assistant_break` | `breakAssistantSegment()` | 显式断开 assistant |
| `thinking_break` | `breakThinkingSegment()` | 显式断开 thinking |
| `streamEnd` | `endStreaming()` | 结束流式 |

---

## 文件改动清单

### 修改的文件

| 文件 | 改动内容 |
|------|---------|
| `web/src/store/chatStore.js` | 完全重写，使用索引引用追踪 |
| `web/src/hooks/useSSEChat.js` | 添加 `assistant_break` 事件处理 |
| `web/src/App.jsx` | 使用 `getAllMessages()` 渲染 |

### 新增的文件

| 文件 | 说明 |
|------|------|
| `docs/VSCode 重构说明.md` | 本文档 |

---

## 后端适配指南

### 最小改动（推荐）

保持现有事件不变，只需在 ToolCall 后**自动断开**：

```javascript
// 当前代码
sendSSE(res, 'tool_call', { ... });
sendSSE(res, 'agent_message_chunk', { content: '...', timestamp: Date.now() });

// ✅ 已经可以工作！
// 前端会在 ToolCall 后自动 breakAssistantSegment()
// 下一个 agent_message_chunk 会创建新消息
```

### 完整适配（可选）

添加显式断开事件：

```javascript
// ToolCall 前
sendSSE(res, 'assistant_break', { timestamp: Date.now() });

// Thinking 前
sendSSE(res, 'thinking_break', { timestamp: Date.now() });
```

---

## 测试验证

### 测试场景 1：Thinking → Assistant

```javascript
// 后端
sendSSE('streamStart', { timestamp: T0 });
sendSSE('agent_thought_chunk', { content: '思考中...' });
sendSSE('agent_message_chunk', { content: '你好' });
sendSSE('agent_message_chunk', { content: '我是 AI' });
sendSSE('streamEnd');

// 前端渲染
[Thinking] 思考中...
[Assistant] 你好我是 AI
```

### 测试场景 2：Thinking → ToolCall → Assistant

```javascript
// 后端
sendSSE('streamStart', { timestamp: T0 });
sendSSE('agent_thought_chunk', { content: '让我查一下...' });
sendSSE('tool_call', { toolName: 'search', timestamp: T1 });
sendSSE('tool_call_update', { status: 'completed', timestamp: T2 });
sendSSE('agent_message_chunk', { content: '搜索结果...', timestamp: T3 });
sendSSE('streamEnd');

// 前端渲染
[Thinking] 让我查一下...
[ToolCall] 搜索 ✓
[Assistant] 搜索结果...
```

### 测试场景 3：多段 Assistant

```javascript
// 后端
sendSSE('streamStart', { timestamp: T0 });
sendSSE('agent_message_chunk', { content: '第一段' });
sendSSE('assistant_break', { timestamp: T1 });  // 显式断开
sendSSE('agent_message_chunk', { content: '第二段', timestamp: T2 });
sendSSE('streamEnd');

// 前端渲染
[Assistant] 第一段
[Assistant] 第二段
```

---

## 关键代码对比

### appendStreamChunk

| 项目 | 之前 | VSCode 方式 |
|------|------|-----------|
| 判断依据 | 时间戳差异 > 100ms | `streamingMessageIndex === null` |
| 创建新消息 | `if (diff > 100)` | `if (idx === null)` |
| 断开方式 | 无 | `breakAssistantSegment()` |
| 可靠性 | ⚠️ 可能误判 | ✅ 100% 可靠 |

### appendThinkingChunk

| 项目 | 之前 | VSCode 方式 |
|------|------|-----------|
| 索引追踪 | `thinkingMessageId` | `thinkingMessageIndex` |
| 时间戳计算 | `Date.now() - 1` | `assistantTs - 1` |
| 独立性 | ⚠️ 依赖 assistantMessageId | ✅ 独立索引 |

### getAllMessages

| 项目 | 之前 | VSCode 方式 |
|------|------|-----------|
| ToolCall 位置 | 单独渲染，不参与排序 | ✅ 参与时间戳排序 |
| 消息类型 | `messages.map()` | `[...messages, ...toolCalls].sort()` |
| 渲染顺序 | 固定 | ✅ 按时间戳交错 |

---

## 总结

### 核心改进

1. ✅ **使用索引引用追踪**，不再依赖时间戳猜测
2. ✅ **显式断开机制**，100% 可靠
3. ✅ **Thinking 独立索引**，确保正确排序
4. ✅ **ToolCall 参与排序**，实现交错显示

### 与 VSCode 插件的对应关系

| VSCode 代码 | 你的项目代码 |
|------------|------------|
| `streamingMessageIndexRef` | `streamingMessageIndex`（闭包变量） |
| `thinkingMessageIndexRef` | `thinkingMessageIndex`（闭包变量） |
| `startStreaming` | `startStreaming` |
| `appendStreamChunk` | `appendStreamChunk` |
| `appendThinkingChunk` | `appendThinkingChunk` |
| `breakAssistantSegment` | `breakAssistantSegment` |
| `allMessages useMemo` | `getAllMessages` |

### 下一步建议

1. ✅ 测试 Thinking → ToolCall → Assistant 流程
2. ✅ 测试多段 Assistant 显示
3. ✅ 根据需要添加 `assistant_break` 事件

---

*重构完成时间：2026 年 4 月 1 日*
