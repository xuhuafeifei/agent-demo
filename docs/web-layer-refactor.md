# Web Layer 重构方案

> 目的：让 web-layer 只做 HTTP 适配和路由装配，领域逻辑与工具下沉可复用，并为前端提供稳定、版本化的 API 面。

## 背景与问题
- 现状：`src/middleware/web/web-layer.ts` 曾集中装配聊天 SSE、配置 CRUD、模型列表等；现已按子路由拆分。
- 问题：职责混杂、重复校验代码多，版本演进难区分用户接口与管理接口。

## 目标架构
- 入口：`createWebLayer()` 仅做路由装配；建议挂载路径 `/api`
- 路由拆分（每个文件聚焦一个子域）：
  - `chat-router.ts`：`/chat`（SSE 对话）
  - `history-router.ts`：`/history`, `/clear`
  - `config/fgbg-router.ts`
  - `config/memory-search-router.ts`
  - `config/providers-router.ts`
  - `config/logging-router.ts`
  - `status-router.ts`：`/status`
- 公共工具：
  - `sse.ts`：`writeNamedSse`, `normalizeRuntimeEvent` 等
  - `http-validate.ts`：`validateBody(schema)`（基于 typebox/ajv），统一响应 `{ success, data?, error? }`
  - `config/service.ts`：读写配置、默认值、保护字段检查
- 前端消费：`web/src/api/client.ts` 作为轻量 SDK，封装 baseURL、错误处理、类型导出。

## 路径与接口示例（v1）
- 用户接口：
  - `POST /api/v1/chat`（SSE）
  - `GET /api/v1/history`
  - `POST /api/v1/clear`
- 管理接口（可加鉴权）：
  - `GET|PATCH /api/v1/config/fgbg`
  - `POST /api/v1/config/fgbg/reset`
  - `POST /api/v1/config/memory-search/test`
  - `POST /api/v1/config/memory-search/repair-local`
  - `GET /api/v1/config/providers`
  - `GET /api/v1/config/providers/:id`
  - `GET /api/v1/config/models/:providerId`
  - `GET /api/v1/config/default-provider`
  - `POST /api/v1/config/logging/evict-cache`
- 状态：
  - `GET /api/v1/status`

## 迭代计划
### 阶段 1：拆分入口，保持行为不变
- 抽出 `chat-router.ts`、`history-router.ts`、`sse.ts`。
- `web-layer.ts` 改为装配：`router.use("/chat", chatRouter); ...`
- `server.ts` 挂载 `/api/v1`，保留 `/api` 作为兼容别名。

### 阶段 2：配置域拆分 + 输入校验
- 在 `config/` 子目录新建路由文件，迁移对应逻辑。
- 引入 `validateBody(schema)`，使用 `@sinclair/typebox` 定义 DTO，统一 400 响应。
- 抽 `config/service.ts` 负责读写、默认值、保护字段逻辑。

### 阶段 3：前端 SDK
- 在 `web/src/api/client.ts` 提供封装：`chat(message)`, `getConfig()`, `patchConfig()`, `testMemorySearch()` 等。
- 输出 TypeScript 类型供前端复用，减少重复定义。

## 测试清单（最小集）
- `/chat` SSE：连接成功、增量事件正确、错误路径返回 error 事件。
- `/config/fgbg`：GET 默认值；PATCH 非法字段 400；reset 恢复默认。
- `/config/memory-search/test|repair-local`：成功/失败分支。
- `/config/providers*`：存在/不存在 provider 分支。
- `/status`：返回 runtimeState。