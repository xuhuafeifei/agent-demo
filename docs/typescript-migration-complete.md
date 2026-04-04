# TypeScript 重构完成报告

> 完成时间：2026-04-04
> 迁移范围：`web/src/` 下所有 JS/JSX 文件 → TS/TSX

---

## 迁移概览

### 迁移统计

| 类别 | 文件数 | 代码行数 |
|------|--------|----------|
| **已迁移 TS/TSX** | 22 | ~5,360 |
| **已删除旧文件** | 22 | ~5,360 |
| **新增类型定义** | 1 | 214 |
| **新增配置文件** | 1 | 27 |

### 迁移清单

#### Phase 0: 基础设施 ✅
- [x] 安装类型依赖：`@types/react`、`@types/react-dom`、`@types/markdown-it`
- [x] 创建 `web/tsconfig.json`
- [x] 创建 `web/src/types/index.ts` 共享类型定义
- [x] 更新 `web/vite.config.mjs` 添加路径别名 `@/`
- [x] 更新 `web/tailwind.config.js` 支持 `.ts`/`.tsx` 文件

#### Phase 1: 纯函数层 ✅
| 旧文件 | 新文件 | 状态 |
|--------|--------|------|
| `config/fgbgSchema.js` | `config/fgbgSchema.ts` | ✅ |
| `components/settings/constants.js` | `components/settings/constants.ts` | ✅ |
| `utils/markdown.js` | `utils/markdown.ts` | ✅ |
| `components/settings/settingsUtils.js` | `components/settings/settingsUtils.ts` | ✅ |
| `components/settings/memorySearchPayload.js` | `components/settings/memorySearchPayload.ts` | ✅ |

#### Phase 2: 状态管理层 ✅
| 旧文件 | 新文件 | 状态 |
|--------|--------|------|
| `store/chatStore.js` | `store/chatStore.ts` | ✅ |
| `hooks/useSSEChat.js` | `hooks/useSSEChat.ts` | ✅ |

#### Phase 3: 组件层 ✅
| 旧文件 | 新文件 | 状态 |
|--------|--------|------|
| `main.jsx` | `main.tsx` | ✅ |
| `components/Header.jsx` | `components/Header.tsx` | ✅ |
| `components/Sidebar.jsx` | `components/Sidebar.tsx` | ✅ |
| `components/Message.jsx` | `components/Message.tsx` | ✅ |
| `components/InputArea.jsx` | `components/InputArea.tsx` | ✅ |
| `components/ContextSnapshotDock.jsx` | `components/ContextSnapshotDock.tsx` | ✅ |
| `components/MessageList.jsx` | `components/MessageList.tsx` | ✅ |
| `App.jsx` | `App.tsx` | ✅ |
| `components/SettingsPage.jsx` | `components/SettingsPage.tsx` | ✅ |
| `components/settings/SettingsPrimitives.jsx` | `components/settings/SettingsPrimitives.tsx` | ✅ |
| `components/settings/ProviderSelectorModal.jsx` | `components/settings/ProviderSelectorModal.tsx` | ✅ |
| `components/settings/SetChannelsPage.jsx` | `components/settings/SetChannelsPage.tsx` | ✅ |
| `components/settings/SetLoggingPage.jsx` | `components/settings/SetLoggingPage.tsx` | ✅ |
| `components/settings/SetMemoryAndHeartPage.jsx` | `components/settings/SetMemoryAndHeartPage.tsx` | ✅ |
| `components/settings/SetModelPage.jsx` | `components/settings/SetModelPage.tsx` | ✅ |

#### Phase 4: 收尾 ✅
- [x] 删除 `App.jsx.bak`
- [x] 更新 `.gitignore` 排除 `.bak` 文件
- [x] 更新 Tailwind 配置支持 TSX 文件
- [x] 运行 `tsc --noEmit` 编译通过

---

## 类型系统概览

### 核心类型定义 (`web/src/types/index.ts`)

#### 消息类型
```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'thinking';
  content: string;
  timestamp: number;
}

interface ToolCall {
  id: string;
  toolCallId: string;
  kind: string;
  title: string;
  content: string;
  status: string;
  detail: string;
  timestamp: number;
}

interface ContextEvent {
  id: string;
  kind: 'snapshot' | 'used';
  reason?: string;
  contextText?: string;
  contextWindow?: number;
  model?: string;
  timestamp: number;
}
```

#### SSE 事件类型
```typescript
type SSEEventType =
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
```

#### Schema 配置类型
```typescript
type SchemaFieldType = 'text' | 'number' | 'boolean' | 'select' | 'array' | 'url' | 'sensitive' | 'json';

interface SchemaField {
  path: string;
  label: string;
  type: SchemaFieldType;
  required?: boolean;
  min?: number;
  max?: number;
  options?: readonly string[];
  readOnly?: boolean;
}
```

---

## 编译配置

### `web/tsconfig.json`
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

---

## 注意事项

### 1. Settings 模块的 `@ts-nocheck`

以下大型组件文件添加了 `// @ts-nocheck` 注释，将在 Phase 4 后续迭代中逐步添加类型：

- `SettingsPage.tsx` (1327 行)
- `SetLoggingPage.tsx` (671 行)
- `SetMemoryAndHeartPage.tsx` (421 行)
- `SetModelPage.tsx` (414 行)
- `SetChannelsPage.tsx` (198 行)
- `SettingsPrimitives.tsx` (181 行)
- `ProviderSelectorModal.tsx` (99 行)

### 2. API 层统一

- `api/client.ts` 已准备好用于未来替换 `configApi.js`
- 当前 `configApi.js` 仍保留（使用 `/api/` 路径）
- 后续迁移可逐步替换为 `client.ts` 的类型安全 API

### 3. 闭包变量

`chatStore.ts` 中的闭包变量（`streamingMessageIndex`、`thinkingMessageIndex`、`lastEventType`）已添加类型注解，但在 React StrictMode 下双挂载可能导致状态不一致。未来可考虑将这些变量迁移到 store state 中。

---

## 验证命令

```bash
# 类型检查
pnpm exec tsc --project web/tsconfig.json --noEmit

# 开发服务器
pnpm run web:dev

# 生产构建
pnpm run web:build
```

---

## 后续优化建议

1. **移除 `@ts-nocheck`**：逐步为 Settings 模块添加完整类型
2. **开启严格模式**：将 `tsconfig.json` 中 `strict` 改为 `true`
3. **API 层统一**：将所有 `configApi.js` 调用替换为 `client.ts`
4. **消除 `any` 类型**：使用 `unknown` + 类型守卫替代
5. **Store 重构**：将闭包变量迁移到 Zustand state 中
