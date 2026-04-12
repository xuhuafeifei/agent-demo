---
name: 租户隔离重构（Shared / Tenants / System）
overview: >
  当前 web/qq/weixin 三端共享同一套 workspace + memory + session。
  未来微信将接入外部用户，每个用户需要独立的 workspace、memory、session。
  重构为 shared（共享资源）+ tenants（租户数据）+ 系统配置 三段式目录结构。
  tenantId 是 fgbg.json 里的配置项，不是调用方传参。
isProject: true
---

# 租户隔离重构计划

无需考虑兼容问题，可以删除所有不符合现在逻辑的老代码

## 目标

- **默认租户（default）**：三端（web/qq/weixin）共享同一套 workspace + memory + session
- **外部租户（userA/userB...）**：每个租户独立的 workspace、memory、session
- **共享资源（shared）**：embedding 模型、skills 等全局共用，不复制
- **tenantId** 是 **fgbg.json 配置项**，由系统配置决定，不由调用方传入

## 目录结构（重构后）

```
~/.fgbg/
  fgbg.json              ← 系统级配置（不变）

  shared/                ← 共享资源（只读引用）
    embedding/           ← GGUF 模型文件（从 workspace 迁入）
    skills/              ← 技能定义（从 workspace 迁入）

  tenants/               ← 租户数据（唯一按 tenantId 隔离的层级）
    default/
      workspace/         ← SOUL.md, MEMORY.md, memory/, userinfo/, skills/, scripts/
      session/           ← session.json, *.jsonl
      memory/            ← memory.db
    userA/               ← 未来新增租户 (租户id满足字母数字下划线)
      workspace/
      session/
      memory/

  # 系统级配置/服务（留在根下，不变）
  qq/                    ← 凭证配置（accounts.json）
  weixin/
  watch-dog/             ← 任务调度（watch-dog.db）
```

## 核心概念映射

| 概念 | 命名规则 | 示例 |
|------|----------|------|
| tenantId | 配置项，由 fgbg.json 决定 | `"default"`, `"userA"` |
| agentId | `agent:main:{tenantId}` | `agent:main:default` |
| sessionKey | `session:main:{tenantId}` | `session:main:default` |
| agentId 用途 | 并发锁键 | `tryAcquireAgent(agentId)` |
| sessionKey 用途 | session 文件键 | `session.json[sessionKey]` |

> 同一 tenantId 下的不同 channel（qq/weixin/web）共享同一把并发锁和同一份 session，这是有意为之——相同 tenantId 意味着数据互通。

## fgbg.json 配置变更

```jsonc
{
  "channels": {
    "web": {
      "enabled": true,
      "tenantId": "default"        // 新增，固定 default. web段目前不打算接入多租户
    },
    "qqbot": {
      "enabled": true,
      // qq 多bot架构：每个bot可以配置不同的tenantId. 并且tenantId是在qqbot内部唯一，换句话说，qqbot的tenantId可以和weixin的tenantId重复。此外，废除以前的identify设计. 保留以前的qq/accounts.json
    },
    "weixin": {
      "enabled": true,
      // weixin 多 bot 架构：每个 bot 可以配置不同的 tenantId
      // bot 级别 tenantId 在 weixin/accounts.json 中维护
    }
  }
}
```

### QQ 账号变更（`~/.fgbg/qq/accounts.json`）

```jsonc
{
  "bots": [{
    "identify": "default",         // 直接废弃该字段, 直接删除相关代码, 用tenantId取代
    "appId": "...",
    "clientSecret": "...",
    "targetOpenId": "...",
    "tenantId": "default"          // 新增：标识该 bot 属于哪个租户
  }],
  "primary": "default"
}
```

### 微信账号变更（`~/.fgbg/weixin/accounts.json`）

```jsonc
{
  "bots": [{
    "identify": "default",  // 直接删除该字段，废弃相关代码，用tenantId取代
    "token": "...",
    "baseUrl": "...",
    "botId": "...",
    "linkedUserId": "...",
    "updateBuf": "...",
    "peerUserId": "...",
    "contextToken": "...",
    "sessionPausedUntil": 0,
    "tenantId": "default"          // 新增：标识该 bot 属于哪个租户
  }],
  "primary": "default"
}
```

## 改造清单

### Phase 1: 路径层（基础设施）

**1.1 `src/utils/app-path.ts`**
- `resolveWorkspaceDir(tenantId: string)` → `~/.fgbg/tenants/{tenantId}/workspace`（删除无参版本，调用方必须传入 tenantId）
- 新增 `resolveSharedDir()` → `~/.fgbg/shared`
- 新增 `resolveEmbeddingModelDir()` → `~/.fgbg/shared/embedding`
- 新增 `resolveWorkspaceSkillsDir()` → `~/.fgbg/shared/skills`
- 新增 `resolveTenantDir(tenantId: string)` → `~/.fgbg/tenants/{tenantId}`
- 新增 `resolveTenantSessionDir(tenantId: string)` → `~/.fgbg/tenants/{tenantId}/session`
- 新增 `resolveTenantMemoryDir(tenantId: string)` → `~/.fgbg/tenants/{tenantId}/memory`
- 新增 `resolveTenantWorkspaceDir(tenantId: string)` → `~/.fgbg/tenants/{tenantId}/workspace`

**1.2 `src/agent/session/session-path.ts`**
- `resolveSessionDir(tenantId: string)` → 返回租户 session 目录（删除无参版本）
- `resolveSessionIndexPath(tenantId: string)` → 必须传入 tenantId

**1.3 `src/memory/utils/path.ts`**
- `resolveMemoryRootDir()` → 新增 tenantId 参数
- `resolveMemoryDbPath()` → 新增 tenantId 参数，返回 `~/.fgbg/tenants/{tenantId}/memory/memory.db`
- `resolveWorkspaceMemoryPath()` → 新增 tenantId 参数
- `resolveWorkspaceMemoryDir()` → 新增 tenantId 参数
- `resolveWorkspaceUserinfoDir()` → 新增 tenantId 参数
- `resolveEmbeddingModelDir()` → 改为从 `shared/embedding/` 读取

### Phase 2: 配置层

**2.1 `src/types.ts`**
- `WebChannelConfig` 新增 `tenantId?: string`
- `QqbotChannelConfig` 新增 `tenantId?: string`
- `WeixinChannelConfig` 不变（多 bot 架构，tenantId 在 accounts.json 中）

**2.2 `src/config/index.ts`**
- `resolveFgbgUserConfig()` 合并默认 tenantId = `"default"`
- `readFgbgUserConfig()` 缓存不变

**2.3 QQ accounts.json 迁移**
- `upsert` / `load` 时自动补 `tenantId: "default"`

**2.4 微信 accounts.json 迁移**
- `WeixinBoundBot` 类型新增 `tenantId: string`
- `loadWeixinAccounts()` 兼容旧数据（无 tenantId 时默认 `"default"`）

### Phase 3: 运行时层

**3.1 `src/agent/agent-state.ts`**
- `tryAcquireAgent(agentId)` 不变（agentId 已包含 tenantId）
- `runningAgentId` 存储 `agent:main:{tenantId}`

**3.2 `src/agent/run.ts`**
- `runWithSingleFlight` 入参：`identify` 废弃，改用 `tenantId: string`（必填，由上层 channel 传入，不再有默认值兜底）
- 内部：`agentId = agent:main:${tenantId}`, `sessionKey = session:main:${tenantId}`

**3.3 `src/agent/pre-run.ts`**
- `prepareBeforeGetReply(sessionKey, channel, tenantId?)` → 使用 tenantId 解析路径
- `ensureAgentWorkspace()` → 传入 tenantId，在 `~/.fgbg/tenants/{tenantId}/workspace` 下创建

**3.4 `src/agent/workspace.ts`**
- `ensureAgentWorkspace()` → 新增 tenantId 参数
- 租户 workspace 下创建：SOUL.md / MEMORY.md / userinfo / skills（agent 自积累的可复用经验）
- 旧 workspace 根下的 SKILL.md 直接删除，不再维护
- embedding 模型从 `shared/embedding/` 读取；系统预置 skill 定义从 `shared/skills/` 读取

### Phase 4: Memory 层

**4.1 `MemoryIndexManager` (`src/memory/memory.ts`)**
- 改为多实例或 tenant-aware 单例
- 启动时按 tenantId 创建/加载对应 memory.db
- `syncAllMemorySources(sessionDir)` → 传入对应租户的 session 目录
- watcher 监听对应租户的 memory/userinfo 目录

**4.2 `src/memory/indexer.ts`**
- `syncAllMemorySources(sessionDir?)` → 增加 tenantId 参数，只扫描对应租户的 session 文件
- workspace MEMORY.md / memory / userinfo 路径从租户 workspace 读取
- embedding 模型路径从 `shared/embedding/` 读取

### Phase 5: 通道层

**5.1 Web (`src/middleware/web/router/chat-router.ts`)**
- 从 config 读取 `channels.web.tenantId`（默认 `"default"`）
- 调用 `runWithSingleFlight` 时传入 tenantId

**5.2 QQ (`src/middleware/qq/qq-layer.ts`)**
- 从 config 读取 `channels.qqbot.tenantId`
- `sendQQDirectMessage` 使用对应租户的 memory.db

**5.3 微信 (`src/middleware/weixin/weixin-layer.ts`)**
- 从 `WeixinBoundBot.tenantId` 读取租户 ID
- `runBotCycle` 传入 bot.tenantId
- `processBotBucket` 使用对应租户的 workspace + memory
- `sendWeixinDirectMessage` 使用 bot.tenantId 路由

### Phase 6: Watch-Dog 适配

**6.1 `src/watch-dog/handlers.ts`**
- `executeReminderHandler` / `executeAgentHandler`：payload 中 `identify` 字段改名/扩展为 `tenantId`
- 执行 agent 任务时，使用 tenantId 路由到对应租户的 workspace
- 发送通知时，根据 tenantId 选择对应 channel 的账号

**6.2 watch-dog 本身不改** — DB、调度器全局单实例，只改执行时的租户路由

### ~~Phase 7: 数据迁移~~

无需迁移。不符合新设计的旧代码和旧数据直接删除重写，不提供任何迁移脚本。


### Phase 8: 清理

**8.1 废弃旧路径**
- 无参的 `resolveWorkspaceDir()`, 无参的函数废弃，调用方必须传入tenantId
- 环境变量 `FGBG_WORKSPACE_DIR`、`FGBG_MEMORY_DIR` 废弃删除

## 改动顺序（推荐执行顺序）

1. **Phase 1** → 路径层（无副作用，纯函数改造）
2. **Phase 2** → 配置层（加 tenantId 字段）
3. **Phase 3** → 运行时层（agentId/sessionKey 格式更新）
4. **Phase 4** → Memory 层（多 tenant DB 支持）
5. **Phase 5** → 通道层（web/qq/weixin 路由）
6. **Phase 6** → Watch-Dog 适配
7. **Phase 8** → 清理（删除所有无参旧函数、废弃环境变量）

## 风险点

1. **MemoryIndexManager 多实例** — 当前是单例，需要改为 tenant-aware 或按需创建
2. **session.json 迁移** — 旧 key 需要能映射到新路径
3. **watch-dog 历史任务** — 旧 payload 里可能是 `identify`，需要兼容解析
4. **embedding 模型迁移** — 大文件移动可能耗时较长

## 测试策略

- 默认租户（default）：web + qq + weixin 三端共享同一套数据
- 新租户（userA）：独立 workspace/memory/session，不泄漏 default 数据
- 迁移脚本：旧数据完整迁移到新结构，无丢失
- 向后兼容：环境变量、旧路径短期可用
