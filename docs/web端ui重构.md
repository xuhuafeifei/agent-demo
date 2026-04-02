# 🎨 AI 聊天客户端 - 完整技术说明文档

---

## 一、项目概述

### 1.1 设计理念
- **核心原则**：内容即界面、极简主义、呼吸感
- **视觉风格**：大面积留白、浅灰白色调、无边框设计
- **交互目标**：沉浸式阅读体验、最小化视觉干扰
- **参考风格**：Notion、Arc Browser、Linear、Claude

### 1.2 技术栈建议
| 层级     | 推荐技术                 |
| -------- | ------------------------ |
| 前端框架 | React 18+ / Next.js 14+  |
| 样式方案 | Tailwind CSS             |
| 组件库   | Shadcn/UI（按需引入）    |
| 图标库   | Lucide React / Heroicons |
| 状态管理 | Zustand / Jotai          |
| 动画库   | Framer Motion（可选）    |

---

## 二、配色方案

### 2.1 主色调（绿色主题）

```css
/* 主题色 - 绿色系 */
--primary-green: #22C55E;        /* 主绿色 */
--primary-green-hover: #16A34A;  /* 悬停绿色 */
--primary-green-light: #DCFCE7;  /* 浅绿背景 */
--primary-green-dark: #15803D;   /* 深绿 */

/* 背景色 */
--bg-primary: #FAFAFA;           /* 主背景 - 极浅灰 */
--bg-card: #FFFFFF;              /* 卡片/输入框 - 纯白 */
--bg-hover: rgba(0,0,0,0.02);    /* 悬停背景 */
--bg-selected: #F0F0F0;          /* 选中背景 */

/* 文字色 */
--text-primary: #333333;         /* 主文字 - 深灰 */
--text-secondary: #666666;       /* 次要文字 */
--text-placeholder: #999999;     /* 提示文字 */
--text-hint: #CCCCCC;            /* 底部提示 */
--text-inverse: #FFFFFF;         /* 反色文字 */

/* 边框/分割线 */
--border-light: #E5E5E5;         /* 极浅灰边框 */
--border-focus: #22C55E;         /* 焦点边框 - 绿色 */

/* 状态色 */
--status-green: #22C55E;         /* 在线/成功 */
--status-yellow: #EAB308;        /* 警告 */
--status-red: #EF4444;           /* 错误 */
```

### 2.2 配色使用规范

| 场景         | 颜色      | 说明               |
| ------------ | --------- | ------------------ |
| 主按钮       | `#22C55E` | 发送、确认等主操作 |
| 按钮悬停     | `#16A34A` | 交互反馈           |
| 用户消息气泡 | `#DCFCE7` | 浅绿背景区分       |
| 选中菜单项   | `#F0F0F0` | 浅灰背景           |
| 焦点状态     | `#22C55E` | 输入框边框         |
| 在线状态点   | `#22C55E` | 绿色圆点           |

---

## 三、布局结构

```
┌─────────────────────────────────────────────────────────────────┐
│  顶部栏 (Header) - 高度 48px                                     │
├──────────┬──────────────────────────────────────────────────────┤
│          │                                                      │
│  左侧    │                  主内容区                             │
│  导航栏   │                  (聊天对话区域)                      │
│  240px   │                                                      │
│  (可折叠  │                                                      │
│   64px)  │                                                      │
│          │                                                      │
│          │                                                      │
│          ├──────────────────────────────────────────────────────┤
│          │                  底部输入框                          │
│          │                  (悬浮卡片式)                        │
│          │                                                      │
└──────────┴──────────────────────────────────────────────────────┘
```

### 3.1 响应式断点

| 断点   | 宽度         | 导航栏状态 | 输入框宽度  |
| ------ | ------------ | ---------- | ----------- |
| 桌面端 | ≥1024px      | 展开 240px | max 768px   |
| 平板端 | 768px-1023px | 收缩 64px  | max 600px   |
| 移动端 | <768px       | 隐藏       | 100% - 24px |

---

## 四、组件详细设计

### 4.1 左侧导航栏 (Sidebar)

#### 4.1.1 两种状态

| 状态 | 宽度  | 显示内容    | 适用场景        |
| ---- | ----- | ----------- | --------------- |
| 展开 | 240px | 图标 + 文字 | 桌面端默认      |
| 收缩 | 64px  | 仅图标      | 平板端/用户选择 |

#### 4.1.2 结构布局

```
┌─────────────────────┐   ┌──────────┐
│  🦀  产品名称        │   │   🦀     │
│  ─────────────────  │   │  ──────  │
│  💬  聊天            │   │   💬     │
│  📊  概览            │   │   📊     │
│  📁  频道            │   │   📁     │
│  ⚡  实例            │   │   ⚡     │
│  💭  会话            │   │   💭     │
│                     │   │          │
│  ⚙️  设置            │   │   ⚙️     │
├─────────────────────┤   ├──────────┤
│  v1.0.0        ●    │   │    ●     │
└─────────────────────┘   └──────────┘
     展开状态                  收缩状态
```

#### 4.1.3 设计规范

| 属性       | 展开状态                | 收缩状态          |
| ---------- | ----------------------- | ----------------- |
| 宽度       | 240px                   | 64px              |
| 背景       | #FAFAFA                 | #FAFAFA           |
| 右边框     | 1px solid #E5E5E5       | 1px solid #E5E5E5 |
| 菜单项高度 | 40px                    | 40px              |
| 菜单项间距 | 4px                     | 4px               |
| 图标大小   | 18px                    | 18px              |
| 文字大小   | 14px                    | 隐藏              |
| 文字颜色   | #666666 / #333333(选中) | 隐藏              |

#### 4.1.4 选中状态样式

```css
.nav-item-active {
  font-weight: 600;
  color: #333333;
  background: #F0F0F0;
  border-left: 2px solid #22C55E;  /* 绿色指示线 */
  padding-left: 14px;  /* 补偿边框宽度 */
}
```

#### 4.1.5 Hover Tooltip（收缩状态）

```
收缩状态下，鼠标悬停图标时显示浮层：

    ┌──────────┐
    │   💬     │  ← 图标
    └──────────
       │
       ▼
    ┌─────────────┐
    │  聊天        │  ← Tooltip
    └─────────────┘

Tooltip 样式规范：
- 位置：图标右侧，间距 8px
- 背景：#333333（深色）
- 文字：#FFFFFF（白色）
- 圆角：6px
- 内边距：6px 10px
- 字体：13px
- 阴影：0 4px 12px rgba(0,0,0,0.15)
- 延迟显示：200ms（避免闪烁）
- 动画：fade in + slide right
- 小三角：指向图标，2px 旋转 45 度
```

#### 4.1.6 折叠/展开交互

| 交互     | 说明                                |
| -------- | ----------------------------------- |
| 切换按钮 | 右上角或底部，图标切换              |
| 过渡动画 | 300ms，cubic-bezier(0.4, 0, 0.2, 1) |
| 文字动画 | 淡出 + 左移 10px                    |
| 状态保存 | localStorage 记住用户偏好           |
| 响应式   | <1024px 自动收缩                    |

---

### 4.2 顶部栏 (Header)

#### 4.2.1 布局结构

```
[🦀 产品名称]  ›  聊天        [🔍 搜索 ⌘K]        [☀️] [🌙] [💻]
```

#### 4.2.2 设计规范

| 属性       | 值                |
| ---------- | ----------------- |
| 高度       | 48px              |
| 背景       | #FAFAFA           |
| 底部边框   | 1px solid #E5E5E5 |
| 面包屑文字 | 14px / #333333    |
| 分隔符     | › 符号 / #999999  |
| 搜索框宽度 | 200px             |

#### 4.2.3 搜索框样式

```css
.search-box {
  background: #FFFFFF;
  border: 1px solid #E5E5E5;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  color: #999999;
}

.search-box:hover {
  border-color: #22C55E;
}

.search-box:focus {
  border-color: #22C55E;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.1);
}
```

#### 4.2.4 主题切换按钮

- 无边框，仅图标
- 图标大小：18px
- 图标颜色：#666666
- 选中状态：背景 #E5E5E5 或图标变绿色 #22C55E
- 悬停反馈：背景 #F5F5F5

---

### 4.3 主聊天区域 (Chat Area)

#### 4.3.1 核心设计原则

> **"内容即界面"** —— LLM 返回内容无边框、无背景，直接融入页面背景

#### 4.3.2 消息类型对比

| 消息类型     | 背景    | 边框             | 对齐   | 说明                  |
| ------------ | ------- | ---------------- | ------ | --------------------- |
| **LLM 回复** | 透明    | 无               | 左对齐 | 无边框嵌入背景        |
| **用户消息** | #DCFCE7 | 无               | 右对齐 | 浅绿气泡区分          |
| **代码块**   | #F5F5F5 | 1px #E5E5E5      | 左对齐 | 唯一有容器的 LLM 内容 |
| **引用块**   | 透明    | 左侧 2px #E5E5E5 | 左对齐 | 最小化视觉干扰        |

#### 4.3.3 LLM 回复内容样式（无边框设计）

```css
/* 容器 - 无任何视觉边界 */
.llm-response {
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
  max-width: 100%;
}

/* 文字排版 */
.llm-response-content {
  color: #333333;
  font-size: 15px;
  line-height: 1.7;
  letter-spacing: -0.01em;
  font-weight: 400;
}

/* 段落 */
.llm-response-content p {
  margin-bottom: 16px;
}

/* 标题 */
.llm-response-content h1 {
  font-size: 24px;
  font-weight: 600;
  color: #1a1a1a;
  margin-top: 24px;
  margin-bottom: 12px;
}

.llm-response-content h2 {
  font-size: 20px;
  font-weight: 600;
  color: #1a1a1a;
  margin-top: 20px;
  margin-bottom: 10px;
}

.llm-response-content h3 {
  font-size: 17px;
  font-weight: 600;
  color: #1a1a1a;
  margin-top: 16px;
  margin-bottom: 8px;
}

/* 列表 */
.llm-response-content ul,
.llm-response-content ol {
  padding-left: 20px;
  margin-bottom: 16px;
}

.llm-response-content li {
  margin-bottom: 8px;
}

/* 引用块 - 仅左侧细线 */
.llm-response-content blockquote {
  border-left: 2px solid #E5E5E5;
  padding-left: 16px;
  margin: 16px 0;
  color: #666666;
  font-style: italic;
  background: transparent;
}

/* 代码块 - 唯一有背景的元素 */
.llm-response-content pre {
  background: #F5F5F5;
  border: 1px solid #E5E5E5;
  border-radius: 8px;
  padding: 16px;
  margin: 16px 0;
  overflow-x: auto;
}

.llm-response-content code {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: #333333;
}

/* 行内代码 */
.llm-response-content :not(pre) > code {
  background: #F0F0F0;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 14px;
  color: #333333;
}

/* 表格 */
.llm-response-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
}

.llm-response-content th,
.llm-response-content td {
  border: 1px solid #E5E5E5;
  padding: 10px 14px;
  text-align: left;
}

.llm-response-content th {
  background: #FAFAFA;
  font-weight: 600;
}
```

#### 4.3.4 用户消息气泡样式

```css
.user-message {
  align-self: flex-end;
  background: #DCFCE7;  /* 浅绿色背景 */
  border-radius: 16px 16px 4px 16px;
  padding: 12px 16px;
  max-width: 70%;
  color: #333333;
  font-size: 15px;
  line-height: 1.6;
}
```

#### 4.3.5 复制按钮交互（重点）

```
LLM 回复内容区域：

┌─────────────────────────────────────────────┐
│  这里是 AI 回复的内容...                     │
│  鼠标移入后右上角显示复制按钮                 │
│                                            │
│                          ┌────────┐         │
│                          │  📋   │  ← 悬浮显示 │
│                          └────────┘         │
└─────────────────────────────────────────────┘

复制按钮样式规范：
- 位置：内容区域右上角
- 默认状态：隐藏（opacity: 0）
- 悬停状态：显示（opacity: 1）
- 背景：#FFFFFF
- 边框：1px solid #E5E5E5
- 圆角：6px
- 图标大小：16px
- 图标颜色：#666666
- 悬停反馈：背景 #F5F5F5，边框 #22C55E
- 点击反馈：图标变绿色 ✓，2 秒后恢复
- 延迟隐藏：鼠标离开后 300ms 再隐藏
```

```css
/* 复制按钮容器 */
.copy-button-container {
  position: absolute;
  top: 8px;
  right: 8px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

/* 鼠标移入内容区域时显示 */
.llm-response:hover .copy-button-container {
  opacity: 1;
}

/* 复制按钮 */
.copy-button {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid #E5E5E5;
  background: #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.copy-button:hover {
  background: #F5F5F5;
  border-color: #22C55E;
}

.copy-button:active {
  transform: scale(0.95);
}

/* 复制成功状态 */
.copy-button.copied {
  border-color: #22C55E;
  color: #22C55E;
}
```

#### 4.3.6 消息间距规范

| 元素             | 间距值 |
| ---------------- | ------ |
| 消息之间垂直间距 | 16px   |
| 段落之间间距     | 16px   |
| 标题上间距       | 24px   |
| 标题下间距       | 12px   |
| 代码块上下间距   | 16px   |
| 列表项间距       | 8px    |

#### 4.3.7 空状态/加载状态

```
无对话时：
- 完全留白，或
- 居中显示欢迎语（#999999，16px）
- 可配快捷操作按钮

加载时：
- 骨架屏动画
- 背景：linear-gradient(90deg, #F0F0F0 25%, #E0E0E0 50%, #F0F0F0 75%)
- 动画：1.5s 无限循环
```

---

### 4.4 底部输入框 (Input Area)

#### 4.4.1 布局结构

```
┌─────────────────────────────────────────────────────────────┐
│  继续提问，或输入 @ 来引用内容                               │
│                                                             │
│  [@]  [📎]                              [⚙️ 最佳]  [↑]      │
└─────────────────────────────────────────────────────────────┘
                    内容由 AI 生成仅供参考
```

#### 4.4.2 容器样式规范

| 属性       | 值                         |
| ---------- | -------------------------- |
| 容器宽度   | max-width: 768px（居中）   |
| 最小高度   | 56px                       |
| 最大高度   | 200px（超出滚动）          |
| 背景       | #FFFFFF                    |
| 边框       | 1px solid #E5E5E5          |
| 圆角       | 20px                       |
| 内边距     | 14px 16px                  |
| 阴影       | 0 2px 8px rgba(0,0,0,0.04) |
| 距底部距离 | 24px                       |
| 距左右距离 | 响应式，最小 16px          |

#### 4.4.3 输入区域样式

```css
.input-textarea {
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  font-size: 14px;
  line-height: 1.6;
  color: #333333;
  background: transparent;
  max-height: 200px;
  overflow-y: auto;
}

.input-textarea::placeholder {
  color: #999999;
  font-weight: 400;
}

.input-textarea:focus {
  outline: none;
}
```

#### 4.4.4 焦点状态

```css
.input-container:focus-within {
  border-color: #22C55E;
  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.15);
}
```

#### 4.4.5 左侧工具按钮

| 按钮  | 图标 | 功能            | 样式               |
| ----- | ---- | --------------- | ------------------ |
| @提及 | @    | 引用内容/知识库 | 18px 图标，#999999 |
| 附件  | 📎    | 上传文件        | 18px 图标，#999999 |

```css
.tool-button {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #999999;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tool-button:hover {
  background: rgba(0,0,0,0.04);
  color: #333333;
}
```

#### 4.4.6 右侧工具按钮

| 按钮     | 图标   | 功能         | 样式                   |
| -------- | ------ | ------------ | ---------------------- |
| 模型选择 | ⚙️ 最佳 | 切换 AI 模型 | 文字 + 图标，#666666   |
| 发送     | ↑      | 发送消息     | 32px 圆形，激活#22C55E |

```css
/* 发送按钮 - 禁用状态 */
.send-button-disabled {
  background: #F5F5F5;
  color: #CCCCCC;
  cursor: not-allowed;
}

/* 发送按钮 - 激活状态 */
.send-button-active {
  background: #22C55E;
  color: #FFFFFF;
  cursor: pointer;
}

.send-button-active:hover {
  background: #16A34A;
  transform: scale(1.05);
}

.send-button-active:active {
  transform: scale(0.95);
}
```

#### 4.4.7 底部提示文字

```css
.input-hint {
  text-align: center;
  font-size: 12px;
  color: #CCCCCC;
  margin-top: 8px;
}
```

#### 4.4.8 交互逻辑

| 操作          | 行为                 |
| ------------- | -------------------- |
| Enter         | 发送消息             |
| Shift + Enter | 换行                 |
| 输入 @        | 弹出提及选择器       |
| 空内容        | 发送按钮禁用         |
| 有内容        | 发送按钮激活（绿色） |

---

## 五、交互细节规范

### 5.1 动画过渡

| 元素         | 动画类型             | 时长  | 缓动函数                     |
| ------------ | -------------------- | ----- | ---------------------------- |
| 侧边栏折叠   | width + opacity      | 300ms | cubic-bezier(0.4, 0, 0.2, 1) |
| 文字淡出     | opacity + translateX | 200ms | ease                         |
| Tooltip 显示 | opacity + translateX | 150ms | ease-out                     |
| 按钮悬停     | background + color   | 150ms | ease                         |
| 发送按钮激活 | background + scale   | 150ms | ease                         |
| 复制成功反馈 | color + icon         | 200ms | ease                         |

### 5.2 滚动条样式

```css
/* 自定义滚动条 - 极简 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #E5E5E5;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #CCCCCC;
}
```

### 5.3 骨架屏加载动画

```css
.skeleton {
  background: linear-gradient(
    90deg,
    #F0F0F0 25%,
    #E0E0E0 50%,
    #F0F0F0 75%
  );
  background-size: 200% 100%;
  animation: loading 1.5s infinite;
  border-radius: 4px;
}

@keyframes loading {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
```

### 5.4 按钮状态反馈

| 状态 | 视觉反馈                  |
| ---- | ------------------------- |
| 默认 | 正常样式                  |
| 悬停 | 背景变深 5%，边框变绿色   |
| 点击 | scale(0.95) 缩放          |
| 禁用 | 灰色，cursor: not-allowed |
| 加载 | 显示旋转 loading 图标     |

---

## 六、响应式设计

### 6.1 断点定义

```css
/* 桌面端 */
@media (min-width: 1024px) {
  .sidebar { width: 240px; }
  .input-container { max-width: 768px; }
}

/* 平板端 */
@media (min-width: 768px) and (max-width: 1023px) {
  .sidebar { width: 64px; }  /* 自动收缩 */
  .input-container { max-width: 600px; }
}

/* 移动端 */
@media (max-width: 767px) {
  .sidebar { display: none; }  /* 隐藏，用汉堡菜单 */
  .input-container { 
    max-width: 100%; 
    margin: 0 12px;
    border-radius: 16px;
  }
  .header { padding: 0 12px; }
  .chat-area { padding: 12px; }
}
```

### 6.2 移动端适配

| 元素     | 桌面端     | 移动端         |
| -------- | ---------- | -------------- |
| 导航栏   | 240px 展开 | 隐藏，汉堡菜单 |
| 输入框   | max 768px  | 100% - 24px    |
| 消息气泡 | max 70%    | max 85%        |
| 圆角     | 20px       | 16px           |
| 内边距   | 16px       | 12px           |

---

## 七、可访问性 (Accessibility)

### 7.1 键盘导航

| 按键   | 功能              |
| ------ | ----------------- |
| Tab    | 切换焦点元素      |
| Enter  | 发送消息/确认操作 |
| Escape | 关闭弹窗/取消操作 |
| ↑/↓    | 消息历史导航      |
| ⌘K     | 聚焦搜索框        |

### 7.2 ARIA 标签

```html
<!-- 导航栏 -->
<nav aria-label="主导航">

<!-- 发送按钮 -->
<button aria-label="发送消息">

<!-- 复制按钮 -->
<button aria-label="复制内容" aria-live="polite">

<!-- 加载状态 -->
<div role="status" aria-live="polite">正在加载...</div>
```

### 7.3 颜色对比度

| 元素     | 前景色  | 背景色  | 对比度   |
| -------- | ------- | ------- | -------- |
| 主文字   | #333333 | #FAFAFA | 14.5:1 ✅ |
| 次要文字 | #666666 | #FAFAFA | 8.2:1 ✅  |
| 提示文字 | #999999 | #FFFFFF | 4.6:1 ✅  |
| 按钮文字 | #FFFFFF | #22C55E | 4.5:1 ✅  |

---

## 八、设计检查清单

### 8.1 视觉规范

- [ ] 主背景色使用 #FAFAFA（非纯白）
- [ ] 所有圆角统一为 16-20px
- [ ] 文字颜色层次分明（主/次/提示）
- [ ] 主题色为绿色 #22C55E
- [ ] 边框使用 #E5E5E5（极浅灰）

### 8.2 LLM 内容区域

- [ ] LLM 回复无边框、无背景
- [ ] 用户消息有浅绿气泡背景 #DCFCE7
- [ ] 代码块有独立容器和背景
- [ ] 引用块仅左侧 2px 细线
- [ ] 鼠标悬停显示复制按钮

### 8.3 导航栏

- [ ] 支持展开/收缩两种状态
- [ ] 收缩后仅显示图标
- [ ] Hover 显示深色 Tooltip
- [ ] 选中状态有绿色指示线
- [ ] 折叠状态保存到 localStorage

### 8.4 输入框

- [ ] 悬浮卡片式，大圆角 20px
- [ ] 焦点时边框变绿色
- [ ] 发送按钮激活为绿色
- [ ] 底部有灰色提示文字
- [ ] Enter 发送，Shift+Enter 换行

### 8.5 交互反馈

- [ ] 所有按钮有 hover 状态
- [ ] 点击有 scale 反馈
- [ ] 复制成功有视觉提示
- [ ] 加载有骨架屏动画
- [ ] 过渡动画流畅（150-300ms）

### 8.6 响应式

- [ ] 桌面端导航展开 240px
- [ ] 平板端导航自动收缩 64px
- [ ] 移动端导航隐藏
- [ ] 输入框宽度自适应
- [ ] 消息气泡宽度适配

---

## 九、给 AI 开发者的核心提示词

> "创建一个极简风格的 AI 聊天客户端界面。使用浅灰白色调（#FAFAFA 主背景），绿色主题色（#22C55E）。左侧可折叠导航栏（240px/64px），收缩后 Hover 显示深色 Tooltip。顶部简洁工具栏。核心重点：LLM 返回内容无边框、无背景，直接融入页面背景，仅代码块有容器；用户消息使用浅绿色气泡（#DCFCE7）区分。鼠标移入 LLM 内容区域后，右上角悬浮显示复制按钮。底部悬浮式大圆角输入框（20px 圆角），支持@提及、附件上传、模型选择。整体追求'内容即界面'的沉浸式阅读体验。使用 React + Tailwind CSS 实现，确保响应式适配桌面/平板/移动端。"

