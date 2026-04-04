# TypeScript 重构迁移计划

> 生成时间：2026-04-04  
> 目标：将 `web/src/` 下的 JS/JSX 代码逐步迁移到 TypeScript/TSX

---

## 一、项目现状

### 1.1 代码规模

| 类别 | 文件数 | 代码行数 |
|------|--------|----------|
| JSX 组件 | 16 | ~3,900 |
| JS 工具/配置 | 8 | ~800 |
| TS 已有文件 | 1 | 262 |
| **总计** | **25** | **~5,360** |

### 1.2 当前 TypeScript 配置

现有 `tsconfig.json` 已配置 `strict: true`，但仅覆盖 `src/**/*`（后端代码），前端 `web/src/` 不在编译范围内。

### 1.3 已有的 TypeScript 资产

- ✅ `web/src/api/client.ts`（298 行，完整类型定义，**但未被使用**）
- ❌ 无 `.d.ts` 类型声明文件
- ❌ 未安装 `@types/react`、`@types/react-dom`、`@types/markdown-it`、`@types/dompurify`

### 1.4 缺失的类型定义包

```jsonc
// 需要安装
{
  "@types/react": "^19.2.0",
  "@types/react-dom": "^19.2.0",
  "@types/markdown-it": "^14.1.0",
  "@types/dompurify": "^3.0.0"
}
```

---

## 二、迁移原则

### 2.1 渐进式策略

```
不追求一步到位，按"层"推进，每层迁移完成后确保项目可构建、可运行
```

```
Phase 0: 基础设施搭建（类型系统就绪）
    ↓
Phase 1: 纯函数层（无 UI 依赖，风险最低）
    ↓
Phase 2: 状态管理层（Store + Hooks）
    ↓
Phase 3: 组件层（从简单到复杂）
    ↓
Phase 4: 收尾与严格模式
```

### 2.2 编译策略

```
初期：allowJs: true, strict: false  // 允许 JS/TS 混用，类型检查宽松
中期：strict: true                   // 开启严格模式
最终：noImplicitAny: true            // 消除隐式 any
```

### 2.3 命名规范

| 旧文件 | 新文件 | 说明 |
|--------|--------|------|
| `*.jsx` | `*.tsx` | 组件文件 |
| `*.js` | `*.ts` | 纯逻辑文件 |
| — | `types/*.ts` | 共享类型定义 |
| — | `*.d.ts` | 模块声明文件（按需） |

---

## 三、详细迁移计划

### Phase 0: 基础设施（预估 0.5 天）

**目标：让 TypeScript 类型系统在前端项目中生效**

#### 3.0.1 安装依赖

```bash
cd /Users/xuhuafei/github/agent-demo
pnpm add -D @types/react @types/react-dom @types/markdown-it @types/dompurify
```

#### 3.0.2 创建前端 tsconfig

新建 `web/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "allowJs": true,
    "strict": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "outDir": "../dist/web",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### 3.0.3 创建共享类型定义

新建 `web/src/types/index.ts`：

```typescript
// 核心消息类型
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'thinking';
  content: string;
  timestamp: number;
}

export interface ToolCall {
  id: string;
  toolCallId: string;
  kind: string;
  title: string;
  content: string;
  status: string;
  detail: string;
  timestamp: number;
}

export interface ContextEvent {
  id: string;
  kind: 'snapshot' | 'used';
  reason?: string;
  contextText?: string;
  contextWindow?: number;
  model?: string;
  timestamp: number;
}

// SSE 事件类型
export type SSEEventType =
  | 'streamStart'
  | 'agent_message_chunk'
  | 'agent_thought_chunk'
  | 'tool_call'
  | 'tool_call_update'
  | 'assistant_break'
  | 'context_snapshot'
  | 'context_used'
  | 'error'
  | 'streamEnd';

export interface SSEEvent {
  event: SSEEventType;
  data: Record<string, unknown>;
}

// 供应商与模型
export interface ProviderEntry {
  id: string;
  name: string;
  icon: string | React.ReactNode;
  enabled: boolean;
  featureCount: number | null;
  isBuiltin: boolean;
  hasApiKey: boolean;
}

export interface ModelOption {
  id: string;
  name: string;
}

// Toast 通知
export interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'warning' | 'info';
  content: string;
  duration?: number;
}
```

#### 3.0.4 更新 Vite 配置

在 `web/vite.config.mjs` 中确保：

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@/': new URL('./src/', import.meta.url).pathname,
    },
  },
});
```

#### 3.0.5 验收标准

- [ ] `pnpm exec tsc --project web/tsconfig.json --noEmit` 通过（允许 JS 文件无类型报错）
- [ ] `pnpm run web:dev` 正常启动
- [ ] IDE 能对 TS 文件提供类型提示

---

### Phase 1: 纯函数层（预估 1 天）

**目标：迁移无 UI 依赖的纯逻辑文件，风险最低**

#### 3.1.1 `config/fgbgSchema.js` → `config/fgbgSchema.ts`（113 行）

**复杂度：⭐**  
纯配置定义文件，无外部依赖。

**需要定义的类型：**
```typescript
export interface SchemaField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'array';
  default?: unknown;
  options?: Array<{ label: string; value: string }>;
  section: string;
}

export interface SettingsSection {
  id: string;
  label: string;
  icon: string;
  fields: SchemaField[];
}
```

#### 3.1.2 `components/settings/constants.js` → `components/settings/constants.ts`（48 行）

**复杂度：⭐**  
纯常量文件。

**需要定义的类型：**
```typescript
export interface TabItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

export interface ProviderModelConfig {
  providerId: string;
  models: Array<{ id: string; name: string }>;
}
```

#### 3.1.3 `utils/markdown.js` → `utils/markdown.ts`（52 行）

**复杂度：⭐⭐**  
依赖 `markdown-it`、`dompurify`、`highlight.js`，但函数签名简单。

**导出签名：**
```typescript
export function renderMarkdown(markdown: string): string;
export function copyText(text: string): Promise<boolean>;
```

#### 3.1.4 `components/settings/settingsUtils.js` → `components/settings/settingsUtils.ts`（84 行）

**复杂度：⭐⭐**  
纯工具函数（`deepGet`/`deepSet`/`deepDiff` 等）。

**导出签名：**
```typescript
export function deepGet(obj: Record<string, unknown>, path: string): unknown;
export function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void;
export function deepDiff(a: Record<string, unknown>, b: Record<string, unknown>): string[];
export function getProviderIcon(providerId: string): string | React.FC;
export function getProviderName(providerId: string): string;
```

#### 3.1.5 `components/settings/memorySearchPayload.js` → `components/settings/memorySearchPayload.ts`（82 行）

**复杂度：⭐⭐**  
需要定义表单数据构建的输入输出类型。

#### 3.1.6 `api/configApi.js` → 删除，改用 `api/client.ts`

**复杂度：⭐⭐⭐**  
这是本阶段最关键的一步。需要：

1. 审查 `client.ts` 与 `configApi.js` 的接口差异
2. 更新所有调用点（全局搜索 `from './api/configApi'`）
3. 确保 `/api/` vs `/api/v1/` 路径映射正确
4. 删除 `configApi.js`

**涉及文件的调用点（预估 15-20 处）：**
- `App.jsx`
- `SettingsPage.jsx` 及所有 settings 子页面
- `hooks/useSSEChat.js`

#### Phase 1 验收标准

- [ ] 所有 `.js` 工具文件已重命名为 `.ts`
- [ ] `pnpm exec tsc --project web/tsconfig.json --noEmit` 无错误
- [ ] API 层统一到 `client.ts`，`configApi.js` 已删除
- [ ] 前端正常运行，无运行时错误

---

### Phase 2: 状态管理层（预估 1 天）

**目标：迁移 Zustand Store 和自定义 Hooks，确保状态流类型安全**

#### 3.2.1 `store/chatStore.js` → `store/chatStore.ts`（302 行）

**复杂度：⭐⭐⭐**  
这是整个项目的状态核心，需要仔细处理。

**当前问题：** 使用闭包变量 `streamingMessageIndex`/`thinkingMessageIndex`/`lastEventType`，在 React StrictMode 下可能双挂载导致状态不一致。

**重构要点：**
```typescript
interface ChatStore {
  messages: Message[];
  toolCalls: ToolCall[];
  contextEvents: ContextEvent[];
  isStreaming: boolean;
  isThinking: boolean;
  // 将闭包索引改为 state
  streamingMessageIndex: number;
  thinkingMessageIndex: number;
  lastEventType: SSEEventType | null;
  
  // Actions
  startStreaming: () => void;
  appendStreamChunk: (content: string) => void;
  appendThinkingChunk: (content: string) => void;
  addToolCall: (toolCall: ToolCall) => void;
  // ... 更多 actions
}

export const useChatStore = create<ChatStore>((set, get) => ({
  // 实现...
}));
```

#### 3.2.2 `hooks/useSSEChat.js` → `hooks/useSSEChat.ts`（166 行）

**复杂度：⭐⭐⭐**  
SSE 流式解析 Hook，依赖 `chatStore`。

**导出签名：**
```typescript
interface UseSSEChatOptions {
  providerId: string;
  model: string;
  enabled: boolean;
}

export function useSSEChat(options: UseSSEChatOptions): {
  sendMessage: (content: string) => void;
  stopStreaming: () => void;
  isStreaming: boolean;
};
```

#### Phase 2 验收标准

- [ ] `chatStore.ts` 编译通过，无 `any` 类型
- [ ] `useSSEChat.ts` 编译通过
- [ ] 闭包变量已安全迁移到 store state
- [ ] SSE 流式对话功能正常

---

### Phase 3: 组件层（预估 3-4 天）

**目标：将所有 JSX 组件迁移到 TSX，定义 props 类型**

#### 3.3.1 简单组件（每个 0.25 天）

| 文件 | 行数 | 复杂度 | 说明 |
|------|------|--------|------|
| `main.jsx` | 10 | ⭐ | 入口文件，仅 `ReactDOM.createRoot` |
| `components/Header.jsx` | 53 | ⭐ | 顶部栏，props 简单 |
| `components/Sidebar.jsx` | 124 | ⭐⭐ | 侧边栏，含折叠状态管理 |

**示例 — Header props：**
```typescript
interface HeaderProps {
  activeNav: string;
  setActiveNav: (nav: string) => void;
  isMobile: boolean;
  onMobileMenuToggle: () => void;
}
```

#### 3.3.2 中等复杂度组件（每个 0.5 天）

| 文件 | 行数 | 复杂度 | 说明 |
|------|------|--------|------|
| `components/Message.jsx` | 153 | ⭐⭐ | Toast 管理 + 消息容器 |
| `components/InputArea.jsx` | 260 | ⭐⭐⭐ | 输入框 + 模型选择器 |
| `components/ContextSnapshotDock.jsx` | 229 | ⭐⭐⭐ | 含 LCS diff 算法 |

#### 3.3.3 复杂组件（每个 1 天）

| 文件 | 行数 | 复杂度 | 说明 |
|------|------|--------|------|
| `components/MessageList.jsx` | 249 | ⭐⭐⭐ | 消息列表，含多种消息类型渲染 |
| `App.jsx` | 238 | ⭐⭐⭐ | 根组件，含路由/布局逻辑 |

#### 3.3.4 Settings 设置模块（建议拆分 + 迁移同步进行）

| 文件 | 行数 | 复杂度 | 建议 |
|------|------|--------|------|
| `components/settings/SettingsPrimitives.jsx` | 180 | ⭐⭐ | 先迁移，为其他设置页提供类型 |
| `components/settings/ProviderSelectorModal.jsx` | 98 | ⭐⭐ | 独立迁移 |
| `components/settings/SetChannelsPage.jsx` | 197 | ⭐⭐ | 独立迁移 |
| `components/settings/SetModelPage.jsx` | 403 | ⭐⭐⭐ | 独立迁移 |
| `components/settings/SetMemoryAndHeartPage.jsx` | 418 | ⭐⭐⭐ | 独立迁移 |
| `components/settings/SetLoggingPage.jsx` | 670 | ⭐⭐⭐⭐ | 考虑拆分为配置区 + 日志查看器 |
| `components/SettingsPage.jsx` | 1326 | ⭐⭐⭐⭐⭐ | **最后迁移**，建议先拆分为 4 个 tab 容器 |

**SettingsPage 拆分建议：**
```
SettingsPage.tsx                    (容器，tab 导航)
├── tabs/ModelsTab.tsx             (从 SetModelPage 重构)
├── tabs/MemoryHeartbeatTab.tsx    (从 SetMemoryAndHeartPage 重构)
├── tabs/LoggingTab.tsx            (从 SetLoggingPage 重构)
└── tabs/ChannelsTab.tsx           (从 SetChannelsPage 重构)
```

#### Phase 3 验收标准

- [ ] 所有 `.jsx` 文件已重命名为 `.tsx`
- [ ] 每个组件的 props 有明确接口定义
- [ ] 无 `any` 类型（允许 `unknown` + 类型守卫）
- [ ] 所有页面功能正常

---

### Phase 4: 收尾与严格模式（预估 0.5 天）

**目标：清理遗留文件，开启严格类型检查**

#### 3.4.1 清理工作

- [ ] 删除 `App.jsx.bak`
- [ ] 检查 `dist/` 目录无遗留的 JS 源文件
- [ ] 更新 `.gitignore` 排除 `.bak` 文件

#### 3.4.2 开启严格模式

修改 `web/tsconfig.json`：

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

#### 3.4.3 CI/CD 集成（如有）

在构建流程中添加类型检查步骤：

```bash
pnpm exec tsc --project web/tsconfig.json --noEmit
```

#### 3.4.4 移除 Tailwind 未使用指令

检查 `web/src/styles.css` 中的 `@tailwind` 指令是否实际使用，如未使用则移除。

#### Phase 4 验收标准

- [ ] `strict: true` 下编译通过
- [ ] 无 `any` 类型
- [ ] 无未使用的变量/参数
- [ ] 构建产物正常部署/运行

---

## 四、风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| `client.ts` 与 `configApi.js` 接口不兼容 | API 调用失败 | Phase 1 中逐一核对每个函数签名，写适配层 |
| Zustand store 闭包变量迁移后行为异常 | 流式输出异常 | 保留原逻辑，逐步替换为 state，充分测试 |
| SettingsPage 拆分引入 regressions | 设置页功能异常 | 拆分前写集成测试/手工测试 checklist |
| 第三方库类型定义缺失 | 编译报错 | 使用 `declare module` 临时声明，后续补充 |
| 迁移过程中 Git 冲突 | 代码合并困难 | 每完成一个 Phase 就提交一个独立 commit |

---

## 五、里程碑汇总

| Phase | 文件数 | 代码行数 | 预估工时 | 风险等级 |
|-------|--------|----------|----------|----------|
| 0. 基础设施 | 3 新增 | ~150 | 0.5 天 | 低 |
| 1. 纯函数层 | 6 迁移 + 1 删除 | ~800 | 1 天 | 中 |
| 2. 状态管理层 | 2 迁移 | ~470 | 1 天 | 中 |
| 3. 组件层 | 16 迁移 | ~3,900 | 3-4 天 | 高 |
| 4. 收尾 | 清理 | — | 0.5 天 | 低 |
| **总计** | **28** | **~5,360** | **6-7 天** | — |

---

## 六、迁移检查清单（每个文件通用）

对每个 `.js`/`.jsx` → `.ts`/`.tsx` 文件：

- [ ] 重命名文件扩展名
- [ ] 为函数参数添加类型
- [ ] 为返回值添加类型
- [ ] 为变量添加类型（或确保类型推断正确）
- [ ] 替换 `PropTypes` 为 TypeScript 接口（如有）
- [ ] 处理 `any` 类型（替换为 `unknown` 或具体类型）
- [ ] 运行 `tsc --noEmit` 确认无编译错误
- [ ] 运行项目确认功能正常
- [ ] 提交 commit，注明迁移的文件

---

## 附录 A：类型定义速查表

### 表单状态类型

```typescript
interface DetailFormState {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: string | number;
  tokenRatio: string | number;
}

interface LoggingFormState {
  cacheTimeSecond: number;
  level: string;
  logDir: string;
  consoleLevel: string;
  consoleStyle: string;
  allowModule: string[];
}

interface ChannelsFormState {
  qqbotEnabled: boolean;
  qqbotAppId: string;
  qqbotClientSecret: string;
  qqbotTargetOpenid: string;
  qqbotAccounts: string;
}

interface MemoryHeartbeatFormState {
  mode: 'local' | 'remote';
  model: string;
  endpoint: string;
  apiKey: string;
  chunkMaxChars: number;
  embeddingDimensions: number;
  downloadEnabled: boolean;
  downloadUrl: string;
  downloadTimeout: number;
  heartbeatEnabled: boolean;
  intervalMs: number;
  concurrency: number;
  allowedScripts: string;
}
```

### UI 组件类型

```typescript
interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

interface ModelComboboxProps {
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}

interface ProviderListItemProps {
  provider: ProviderEntry;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}
```

### Diff 相关类型（ContextSnapshotDock）

```typescript
interface DiffLine {
  type: 'add' | 'del' | 'same';
  line: string;
}

function buildLineDiff(oldText: string, newText: string): DiffLine[];
```
