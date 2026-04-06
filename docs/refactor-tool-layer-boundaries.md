# 工具层职责拆分方案（草案）

本文只描述**目标边界与文件划分**，便于评审；落地时可分阶段改 import，避免一次性大爆炸。

---

## 1. 现状问题（摘要）

- `**security/types.ts`**：名称为 types，实则包含 **interface + 默认常量 + `resolve*` 逻辑**，读者无法从文件名判断「有没有副作用、能不能只当声明读」。
- `**tool/types.ts`**：名称为 types，实为 **与 Pi 对齐的工具返回协议**（`okResult` / `errResult`），与「安全配置」无关，却和 `security/types` 都叫 types，语义撞车。
- `**tool-register.ts`**：同时承担 **静态目录（名字→工厂）**、**按配置装配 bundle**、**审批/预设查询**、**上下文过滤工具名**，单文件过载，名字像「注册表」却干了运行时门面的事。

---

## 2. 拆分原则

1. **名字诚实**：`types` / `model` 只放**形状**；带默认常量用 `defaults`；带合并/解析用 `resolve`。
2. **单一事实来源**：工具「合法 id」以 **目录（catalog）** 为权威；配置里的 `enabledTools` 在类型上尽量 **引用** 该集合（或生成联合类型），减少与 `DEFAULT_`* 双处手写列表。
3. **依赖方向**：`resolve` → 依赖 `defaults` + `model`；`catalog` **不**依赖 `readFgbgUserConfig`；**装配**（bundle）才读全局配置并调用 `resolve`。
4. **禁止命名**：不使用 `fgbg-tool-`* 这类前缀；配置来源仍是 `fgbg.json`，但模块名用 **领域词**（`tool-security`、`tool-result`）即可。

---

## 3. 目标模块一览

### 3.1 工具执行结果（原 `tool/types.ts`）


| 新文件                             | 职责                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/agent/tool/tool-result.ts` | `ToolError` / `ToolErrorCode`、`ToolDetails`、`okResult`、`errResult`；仅依赖 `@mariozechner/pi-agent-core` 的 `AgentToolResult`。 |


**说明**：与「安全策略」「工具清单」零耦合；所有 `read`/`write`/… 工具文件只 import 这里。

---

### 3.2 工具安全配置（原 `security/types.ts` 拆三份）


| 新文件                                                 | 职责                                                                                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agent/tool/security/tool-security.model.ts`    | 仅 **TypeScript 接口**：`ToolSecurityConfig`、`AccessConfig`、`ApprovalConfig`；可再导出与 preset 相关的类型字面量（或从 `constants` 引入 `ToolMode`）。**无**默认常量、**无** `resolve` 函数。 |
| `src/agent/tool/security/tool-security.defaults.ts` | `DEFAULT_GUARD_CONFIG`、`DEFAULT_SAFETY_CONFIG`、`DEFAULT_YOLO_CONFIG`、`DEFAULT_TOOL_SECURITY_CONFIG`；仅 **数据**，可依赖 `tool-security.model` 做 `satisfies` 校验。   |
| `src/agent/tool/security/tool-security.resolve.ts`  | `getConfigByPreset`、`resolveToolSecurityConfig`；依赖 **defaults + model**，输入 `Partial<ToolSecurityConfig>` / 原始片段，输出完整 `ToolSecurityConfig`。                 |


**删除**：`security/types.ts`（由上述三文件替代，旧路径可做 re-export 过渡期再删）。

**依赖图**：

```text
tool-security.model  ← 无内部依赖（仅 constants）
tool-security.defaults → tool-security.model
tool-security.resolve  → tool-security.defaults + tool-security.model
```

---

### 3.3 工具目录（从 `tool-register.ts` 拆出「静态表」）


| 新文件                              | 职责                                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agent/tool/tool-catalog.ts` | **唯一**维护 `Record<工具名, { factory, description }>`（含 `read` / `readFile` 等别名指向同一 entry）；**不**读 `fgbg.json`、**不**解析 `ToolSecurityConfig`。可选：`export type ToolCatalogName = keyof typeof TOOL_CATALOG`。 |


**说明**：这是「有哪些工具、怎么 new」的 **目录**；配置里启用谁，不在这里决定。

---

### 3.4 装配与策略查询（瘦身后替代臃肿的 `ToolRegister`）


| 新文件                                         | 职责                                                                                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agent/tool/tool-bundle.ts`             | `createToolBundle(cwd)`：读 `readFgbgUserConfig()` → `resolveToolSecurityConfig` → 按 `enabledTools` **过滤** `tool-catalog` → 生成 `tools[]` / `toolings[]`；处理 `TOPIC_TOOL_BEFORE_BUILD` 动态注入。导出 `ToolBundle` 类型。 |
| `src/agent/tool/tool-approval.ts`           | 纯函数或极小模块：`requiresApproval(toolName, approvalConfig)`、`getApprovalConfigFromResolved(resolved)`；**不**持有单例，便于单测。若希望更少文件，可暂时合并进 `tool-bundle.ts` 底部，但逻辑上仍是「审批策略」而非「目录」。                                       |
| `src/agent/tool/tool-context-filter.ts`（可选） | `getFilterContextToolNames(): readonly string[]` 或常量 `FILTER_FROM_CONTEXT_TOOL_NAMES`；与「是否启用」无关，属于 **会话/上下文裁剪策略**，单独列出可避免和 `enabledTools` 混淆。                                                               |


**关于 `ToolRegister` 单例**：

- **方案 A**：删除 class，改为 `createToolBundle` + 若干纯函数；调用方（如 `read.ts`）通过 **参数注入**或 **读配置** 获取审批策略（利于测）。

---

## 4. 三类职责对照表（你最关心的三个点）


| 关注点                                       | 落地位置                                           | 一句话                               |
| ----------------------------------------- | ---------------------------------------------- | --------------------------------- |
| **Pi 返回长什么样**                             | `tool-result.ts`                               | 协议层，与安全、清单无关。                     |
| **fgbg 里 toolSecurity 长什么样、默认啥、怎么 merge** | `tool-security.model` + `defaults` + `resolve` | 配置域；不叫 `types` 一统。                |
| **系统里「有哪些工具、叫什么、怎么实例化」**                  | `tool-catalog.ts`                              | 静态目录，不读配置。                        |
| **当前会话实际启用哪些、怎么拼进 Agent**                 | `tool-bundle.ts`                               | 装配；读配置 + 用 catalog。               |
| **某工具要不要点审批**                             | `tool-approval.ts`（或 bundle 子模块）               | 只依赖 **已 resolve** 的 `approval` 段。 |


---

## 5. 迁移顺序建议（降低风险）

1. 新增 `tool-result.ts`，从旧 `tool/types.ts` 迁出并 **re-export**，全仓改 import 指向新文件后删旧文件。
2. 拆分 `security/types.ts` → `model` / `defaults` / `resolve`，旧路径 `security/types.ts` 只做 `export * from './tool-security.xxx'` 兼容一层。
3. 抽出 `tool-catalog.ts`，`tool-register` 仅引用 catalog，逻辑不变。
4. 抽出 `createToolBundle` 与审批辅助，最后收缩或删除 `ToolRegister`。
5. （可选）`enabledTools` 与 `TOOL_CATALOG` key 做类型关联，消灭双处维护。

---

## 6. 验收标准

- 打开任意文件，从 **文件名** 能判断：是否含「合并逻辑」、是否含「默认常量」、是否含「Pi 结果形状」、是否含「静态工具表」。
- `tool-catalog` 在单元测试中可 **不挂载**全局配置即可测「名字是否存在」。
- `tool-security.resolve` 可单测 **preset 覆盖与局部 override**，不依赖 Express / 会话。

---

## 7. 刻意不做的事（避免 scope 膨胀）

- 不把 `path-checker` / `file-type-checker` 并进 `tool-security.resolve`（仍是 **运行时路径策略**，保持独立文件）。
- 不把 `readFgbgUserConfig` 的实现挪进工具层（配置加载仍在 `src/config`）。

---

