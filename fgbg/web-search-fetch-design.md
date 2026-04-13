# Web Search & Web Fetch 设计文档

## 1. 概述

为 Agent 增加联网搜索和网页抓取能力，提供两个工具：


| 工具            | 职责                   | 输入           | 输出             |
| ------------- | -------------------- | ------------ | -------------- |
| **webSearch** | 按关键词搜索互联网，返回一组候选 URL | query, limit | 标题 + URL + 摘要  |
| **webFetch**  | 抓取指定 URL 的内容并提取文本    | url, prompt  | Markdown/纯文本内容 |


典型工作流：Agent 先 `webSearch("xxx")` 得到 URL 列表，再对感兴趣的 URL 调用 `webFetch(url, "提取要点")`。

---

## 2. 架构设计

### 2.1 核心原则

- **服务层与 Agent 解耦**：`web-search/` 和 `web-fetch/` 是纯业务模块，不依赖 `@mariozechner/pi-coding-agent` 或任何 Tool 类型。
- **接口抽象 + 适配器模式**：每个服务定义 Provider/Fetcher 接口，切换底层供应商只需换实现，不影响 Tool 层。
- **Tool 层只做胶水**：`src/agent/tool/func/web-search.ts` 和 `web-fetch.ts` 只负责参数校验 → 调服务 → 封装 `okResult/errResult`。

### 2.2 目录结构

```
src/
├── web-search/
│   ├── types.ts                   ← 统一类型（SearchResult, SearchRequest, SearchResponse, SearchProviderType）
│   ├── provider.ts                ← SearchProvider 接口
│   ├── duckduckgo-provider.ts     ← createDuckDuckGoProvider() 工厂函数
│   ├── volcengine-provider.ts     ← createVolcengineProvider() 工厂函数
│   ├── google-provider.ts         ← createGoogleProvider() 工厂函数（未来加）
│   └── factory.ts                 ← createSearchProvider() 读配置选 provider
│
├── web-fetch/
│   ├── types.ts                   ← 统一类型（FetchResult）
│   └── http-fetcher.ts            ← fetchUrl() 纯函数，HTTP 抓取 + HTML→Markdown
│
└── agent/tool/func/
    ├── web-search.ts              ← createWebSearchTool() 胶水层
    └── web-fetch.ts               ← createWebFetchTool() 胶水层
```

### 2.3 数据流

```
Agent ──调──→ createWebSearchTool()
                └──调──→ createSearchProvider()
                            └──调──→ createDuckDuckGoProvider().search()
                                       │
                                       ↓ 读配置
                                  fgbg.json → webSearch.provider / apiKey

Agent ──调──→ createWebFetchTool()
                └──调──→ fetchUrl()
                            └──→ HTTP GET → HTML→Markdown → 返回
```

---

## 3. 搜索服务（web-search）

### 3.1 统一类型

```typescript
interface SearchResult {
  title: string; // 结果标题
  url: string; // 真实 URL（已解码）
  snippet: string; // 摘要/片段
}

interface SearchRequest {
  query: string; // 搜索关键词
  limit?: number; // 返回数量，默认 10，最大 50
}

interface SearchResponse {
  query: string;
  results: SearchResult[];
}
```

### 3.2 Provider 适配器

**每个 provider 是纯函数模块，入参固定，返回值固定。** 不用 class，用工厂函数。

```typescript
export interface SearchProvider {
  search(request: SearchRequest): Promise<SearchResponse>;
}
```

每个 provider 导出一个工厂函数，入参 `(apiKey: string)`，返回 `SearchProvider` 对象。provider 可以不用 `apiKey`，但**入参必须传**：

```typescript
// duckduckgo-provider.ts
export function createDuckDuckGoProvider(_apiKey?: string): SearchProvider {
  return {
    async search({
      query,
      limit = 10,
    }: SearchRequest): Promise<SearchResponse> {
      // HTTP POST → 解析 HTML → 返回 SearchResult[]
    },
  };
}

// volcengine-provider.ts
export function createVolcengineProvider(apiKey: string): SearchProvider {
  return {
    async search({ query, limit }: SearchRequest): Promise<SearchResponse> {
      // POST 火山引擎 API → 解析返回 → 返回 SearchResult[]
    },
  };
}
```

**支持的 provider 枚举**：

```typescript
export type SearchProviderType = "duckduckgo" | "volcengine" | "google";
```

前端暂不做 provider 选择，由后端默认配置决定。

### 3.3 Factory

```typescript
import type { SearchProvider } from "./provider.js";
import { SearchProviderType } from "./types.js";
import { createDuckDuckGoProvider } from "./duckduckgo-provider.js";
import { createVolcengineProvider } from "./volcengine-provider.js";
import { readFgbgUserConfig } from "../config/index.js";

export function createSearchProvider(): SearchProvider {
  const config = readFgbgUserConfig();
  const providerType = config.webSearch?.provider ?? "duckduckgo";
  const apiKey = config.webSearch?.apiKey ?? "";

  switch (providerType) {
    case "duckduckgo":
      return createDuckDuckGoProvider(apiKey);
    case "volcengine":
      return createVolcengineProvider(apiKey);
    case "google":
      // 未来实现
      return createDuckDuckGoProvider(apiKey);
    default:
      return createDuckDuckGoProvider(apiKey);
  }
}
```

### 3.6 不做搜索缓存

理由：

- 搜索本身很快（<2s）
- 用户 query 变化大，缓存命中率低
- 引入语义相似度匹配需要 embedding 服务，增加复杂度
- 等实际遇到性能瓶颈再加

---

## 4. 配置集成

### 4.1 配置结构

在 `fgbg.json` 中增加 `webSearch` 字段：

```json
{
  "webSearch": {
    "provider": "duckduckgo",
    "apiKey": ""
  }
}
```


| 字段         | 类型     | 说明                                         |
| ---------- | ------ | ------------------------------------------ |
| `provider` | string | 搜索供应商类型，取值为 `SearchProviderType` 枚举        |
| `apiKey`   | string | API 密钥，duckduckgo 可留空，volcengine/google 必填 |


### 4.2 类型定义

在 `src/types.ts` 中增加：

```typescript
export type SearchProviderType = "duckduckgo" | "volcengine" | "google";

export interface WebSearchConfig {
  provider: string;
  apiKey: string;
}
```

`FgbgUserConfig` 增加 `webSearch?: WebSearchConfig` 字段，`resolveFgbgUserConfig` 中解析。

### 4.3 前端暂不参与

前端暂不做 provider 选择界面，provider 由后端默认配置决定。

---

## 5. 抓取服务（web-fetch）

### 5.1 统一类型

```typescript
interface FetchResult {
  url: string; // 实际抓取的 URL
  content: string; // Markdown 或纯文本
  statusCode: number; // HTTP 状态码
  contentType: string; // Content-Type 响应头
}
```

### 5.2 核心函数

导出一个纯函数：

```typescript
// http-fetcher.ts
export async function fetchUrl(url: string): Promise<FetchResult> {
  // HTTP GET → 检查 Content-Type
  // text/html → html-to-text 转 Markdown → 截断
  // text/markdown|plain → 直接使用 → 截断
  // 其他 → 报错
}
```

### 5.3 安全限制


| 限制项      | 值          | 说明                   |
| -------- | ---------- | -------------------- |
| 请求超时     | 10 秒       | AbortSignal.timeout  |
| 最大内容长度   | 50,000 字符  | 超出截断                 |
| 私有 IP    | 允许         | Agent 可能需要抓内网服务      |
| Redirect | 跟随         | 限制最大 5 次跳转           |
| 协议       | http/https | http 自动升级为 https（可选） |


### 5.4 不做 LLM 内容提取（第一版）

Claude Code 和 Qwen Code 的 web-fetch 会在抓取后调用一个小模型（Haiku/Gemini）做内容提取。第一版不做这个：

- 直接返回 Markdown 给 Agent，让 Agent 的主模型自己去阅读理解
- 不需要额外配置模型 API key
- 如果后续遇到 context window 压力，再加这一层

---

## 6. Tool 胶水层

### 6.1 web-search Tool

```
参数：
  - query (string, 必填): 搜索关键词
  - limit (number, 可选): 返回数量，默认 10，最大 50

返回（okResult）：
  - query: 原始搜索词
  - results: [{ title, url, snippet }]
  - count: 实际返回数量

错误（errResult）：
  - code: "SEARCH_ERROR"
  - message: 错误信息
```

### 6.2 web-fetch Tool

```
参数：
  - url (string, 必填): 要抓取的 URL
  - prompt (string, 必填): 描述你想从页面提取什么（留给 Agent 理解用）

返回（okResult）：
  - url: 实际抓取的 URL
  - content: Markdown/文本内容

错误（errResult）：
  - code: "FETCH_ERROR"
  - message: 错误信息
```

**注意**：`prompt` 参数第一版仅作为 Tool description 的一部分传给 Agent，实际抓取不经过 LLM 处理。Agent 可以自行决定如何利用 prompt 理解抓取意图。

---

## 7. 未来可扩展方向

1. **搜索缓存**：当搜索频率高时，可引入 query → URL 的缓存（基于语义相似度）
2. **LLM 内容提取**：web-fetch 内部调用小模型，将长页面压缩为摘要
3. **更多搜索源**：Google Custom Search、Bing、SearXNG
4. **JavaScript 渲染**：对 SPA 页面使用 headless browser 抓取
5. **权限控制**：按域名白名单/黑名单限制 web-fetch 的访问范围

