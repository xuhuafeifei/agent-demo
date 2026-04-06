# 上下文使用占比指示器

## 功能说明

在聊天输入框的右下角添加了一个圆形指示器,实时显示当前上下文 token 使用占比。

## 特性

### 1. 实时显示
- 每次 AI 请求完成后,自动更新上下文使用信息
- 圆形进度条动态显示占比百分比

### 2. 颜色编码
根据使用占比自动切换颜色,直观警示:
- 🟢 **绿色** (0-50%): 正常范围
- 🔵 **蓝色** (50-70%): 中等使用
- 🟠 **橙色** (70-90%): 警告级别
- 🔴 **红色** (90-100%): 危险级别,接近上限

### 3. 交互提示
- **悬停提示**: 鼠标悬停显示详细信息
  ```
  上下文使用: 12,345 / 32,768 tokens (38%)
  ```
- **动画效果**: 悬停时圆圈放大,视觉反馈更明显

### 4. 智能显示
- 仅在上下文使用后显示(首次请求前隐藏)
- 平滑的过渡动画,避免突兀变化

## 技术实现

### 组件结构
```
InputArea
  └─ ContextUsageIndicator (新增)
```

### 数据流
```
后端 (run.ts)
  ↓ SSE: context_used { totalTokens, contextWindow }
前端 (useSSEChat.ts)
  ↓ 解析事件
Store (chatStore.ts)
  ↓ 存储到 contextEvents
组件 (ContextUsageIndicator.tsx)
  ↓ 计算占比
UI 渲染
  └─ SVG 圆形进度条
```

### 修改的文件

1. **新增文件**:
   - `web/src/components/ContextUsageIndicator.tsx` - 核心组件
   - `docs/context-usage-indicator.md` - 本文档

2. **修改文件**:
   - `web/src/components/InputArea.tsx` - 集成组件
   - `web/src/styles/input-area.css` - 添加样式
   - `web/src/types/index.ts` - 添加 `totalTokens` 字段
   - `web/src/store/chatStore.ts` - 存储 `totalTokens`
   - `web/src/hooks/useSSEChat.ts` - 解析 `totalTokens`

## 使用方法

### 基本使用
组件已自动集成到输入框,无需额外配置。每次对话后会自动更新。

### 自定义最大上下文窗口
如果需要手动指定最大上下文窗口(例如使用不同的模型):

```tsx
<ContextUsageIndicator maxContextWindow={65536} />
```

默认情况下,组件会从后端返回的 `contextWindow` 字段自动获取。

## 计算逻辑

```typescript
占比百分比 = (totalTokens / contextWindow) × 100%

示例:
- 已使用: 12,345 tokens
- 最大窗口: 32,768 tokens
- 占比: 37.7% → 显示 38%
```

## 注意事项

1. **首次显示**: 只有在 AI 完成第一次回复后才会显示(此时后端发送 `context_used` 事件)
2. **数据准确性**: 占比基于后端返回的实际 token 统计,确保后端正确发送事件
3. **性能优化**: 使用 `useMemo` 缓存计算结果,避免不必要的重渲染

## 样式定制

如需调整样式,修改 `web/src/styles/input-area.css`:

```css
/* 调整圆圈大小 */
.context-usage-indicator svg {
  width: 40px;  /* 修改宽度 */
  height: 40px; /* 修改高度 */
}

/* 调整颜色阈值 */
/* 在 ContextUsageIndicator.tsx 的 getColor 函数中修改 */
```

## 故障排查

### 问题: 圆圈不显示
**原因**: 后端未发送 `context_used` 事件
**解决**: 检查后端 `src/agent/run.ts` 是否正确 emit 事件

### 问题: 占比显示为 0%
**原因**: `totalTokens` 字段未正确传递
**解决**: 检查事件链路:
1. 后端发送 `totalTokens`
2. 前端 `useSSEChat.ts` 解析
3. `chatStore.ts` 存储
4. 组件读取计算

### 问题: 颜色不符合预期
**解决**: 调整 `getColor` 函数中的阈值:
```typescript
const getColor = (percentage: number) => {
  if (percentage >= 90) return '#ef4444'; // 修改阈值
  // ...
};
```

## 未来优化

- [ ] 支持点击显示详细的 token 分布(输入/输出/系统提示词)
- [ ] 添加历史记录,展示 token 使用趋势
- [ ] 支持不同模型自动切换不同的最大上下文窗口
- [ ] 添加预警通知(当占比超过 90% 时提示用户)
