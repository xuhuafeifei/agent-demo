# `fgbg.json` Web 配置界面设计

## 1. 目标

- 提供专门的 HTML/JS 视图，用于检查和修改 `fgbg.json` 配置，而不暴露原始文件或绕过现有的后端验证和默认值。
- 重用当前的静态 bundle（`src/public/index.html` + `app.js`），通过添加额外的视图，可以在现有的聊天体验旁边进行路由切换。
- 将敏感输入（例如由 `scripts/qwen-oauth-login.ts` 填充的 qwen 代码 API 密钥）保留在浏览器之外，同时仍然显示足够的元数据，让用户知道自动提供了什么。

## 2. 后端契约

### 数据传输

- 后端继续只暴露 `FgbgUserConfig` 负载（即 `resolveFgbgUserConfig` 运行后解析/净化后的配置）。没有原始文本或内部专用字段泄漏到 UI。
- 每个响应包括：
  - `meta`：时间戳，以便 UI 可以显示“最后修改时间”。
  - `sourceHints`：元数据，描述哪些部分是默认值（`isDefault: true`）以及哪些可以编辑（`canEdit: true`）。敏感字段可能会添加 `protected: true`。
  - `values`：实际的配置树，每个分支可选包含 `notes`，以便 UI 可以显示验证提示或所需范围。

### API 端点

| 路由 | 方法 | 目的 | 负载 | 说明 |
| --- | --- | --- | --- | --- |
| `/api/config/fgbg` | `GET` | 获取最新的合并配置 + 元数据 | 查询 `?refresh=true` 以绕过缓存 | 返回完整的 `FgbgUserConfig` + 上述元数据 |
| `/api/config/fgbg` | `PATCH` | 仅更新更改的子树 | `DeepPartial<FgbgUserConfig>` | 后端合并、验证、通过 `writeFgbgUserConfig` 写入，然后清除缓存并返回新的快照 |
| `/api/config/fgbg/reset` | `POST` | 恢复默认值 | `{ reason?: string }` | 将 `{}` 写入磁盘，以便 `resolveFgbgUserConfig` 重新计算默认值 |

## 3. UI 结构

### 入口外壳

- 在标题旁边添加全局导航栏，包含两个胶囊按钮：`聊天` 和 `配置`。跟踪哈希值（`#chat`、`#config`）确定挂载哪个视图。
- 两个视图共享现有布局（应用程序外壳、全局样式、资源加载）。同一时间只有一个 `<main>` 可见。

### 配置视图布局

1. **Hero 区域**
   - 标题：`配置中心` + 副标题 `控制 fgbg.json`
   - 元数据芯片：来自 `meta.lastTouchedAt` 的 `最后更新时间`，`缓存状态`（活跃/已过期）。
   - 操作按钮：
     - `刷新`（`GET ?refresh=true`）
     - `恢复默认`（`POST /api/config/fgbg/reset`，显示确认模态框）

2. **默认指示条**
   - 内联徽章或标签，解释“系统默认”的含义，并显示返回的默认值部分的数量（`isDefault: true`）。
   - 每个徽章都有工具提示文本：“此内容由后端默认值补齐，即便清空也会被自动恢复。”

3. **配置卡片**
   - 按顶级模块（`Models`、`Agents`、`Logging`、`Heartbeat`、`Channels`）分割。
   - 每张卡片显示：
     - 可折叠标题，包含模块名称 + 快速摘要（例如，内存搜索模式）。
     - 键/值行：标签、输入（文本/数字/切换）、默认提示、`来源` 标签（默认/覆盖）。
     - 输入字段尊重 `sourceHints`：如果 `canEdit` 为 false 或 `protected` 为 true，则渲染为只读或替换为 `复制` 按钮 + 提示。
     - 验证规则与后端镜像（例如，`logging.cacheTimeSecond` 在 60-300 之间）。内联错误提示（红色文本）在提交前显示。
     - 是默认值但用户可以覆盖的字段包括“设为自定义”链接，该链接将字段添加到 PATCH 有效负载并使用新值。

4. **敏感部分**
   - 为 `models.providers["qwen-portal"]` 提供特殊卡片。
   - 不要为 `apiKey` 渲染可编辑输入。
   - 而是显示只读摘要：
     ```
     qwen-portal/coder-model
     apiKey: 通过 `scripts/qwen-oauth-login.ts` 生成，前端不可见。
     ```
   - 提供帮助链接，指向脚本位置和说明（例如，“在终端执行 `npm run qwen-oauth`”）。
   - 可选显示状态胶囊：“凭证存在 / 未设置（运行脚本）”。

5. **保存工具栏**
   - “保存变更”按钮在检测到差异之前保持禁用状态。点击时，仅收集脏字段 + 发送到 `PATCH`。
   - “重置变更”将本地表单状态清除为与上次获取的快照匹配。
   - 内联 Toast 区域用于显示后端返回的成功/失败消息。

## 4. 路由行为

- 使用轻量级哈希路由器，因为项目目前只提供单个 `index.html`。
  - `window.location.hash === "#config"` 显示 `<section id="config-view">`。
  - `#chat`（或空哈希）显示现有的聊天模块。
  - 点击标题导航按钮会更新哈希并调用 `renderRoute`。
- `app.js` 已经连接了 DOM 元素；在首次导航到 `#config` 时，用 `initConfigView()` 扩展它。
  - 避免不必要的重新获取配置（`延迟初始化 + 刷新按钮`）。
  - 保持 `chat-view` 助手不变；路由器只需切换 CSS 类（`hidden`）并重置焦点。

## 5. 数据流与 UX 说明

- 加载时，`initConfigView`：
  1. 获取配置快照。
  2. 将元数据归一化为字段级描述符（`sourceHints`）。
  3. 渲染 UI（卡片、工具提示）。
  4. 钩子输入以更新 `dirty` 树，跟踪修改。

- 保存时，仅发送已更改的字段，以最小化写入争用；后端仍会合并部分补丁。
- 成功补丁后，刷新内存中的快照并清除脏标记。
- 如果后端返回 `protected` 或验证错误，则在输入下方显示它们，并保持 `Save` 按钮禁用，直到更正为止。
- 对于默认值，在控件旁边显示 `默认值` 芯片；点击字段上的“恢复默认”将其设置回 `undefined`，并依赖后端在下次获取时重新应用回退。

## 6. 下一步

1. 在 `src/public/app.js` 中实现路由器外壳切换，并将 `config` 部分标记添加到 `index.html`。
2. 构建 `ConfigView` 模块（纯 JS），处理获取、比较、表单生成和提交。
3. 在 `src/middleware`（或等效）中添加新 API 路由的后端处理程序。
4. 在 README 中为新用户记录 qwen API 密钥脚本。
