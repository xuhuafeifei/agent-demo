# Heavy/Light Lane 与 Memory 检索整改方案（定稿）

## 1. 背景

当前系统在同一 `tenantId + module` 下按 `lane`（`heavy` / `light`）拆分会话，目的是隔离上下文污染（生活对话与技术对话互相影响）。

这个方向正确，但现有实现存在两个问题：

- 用户侧历史有割裂感。
- Memory 若索引 raw session，容易引入工具过程和中间推理噪音。

---

## 2. 本次整改目标

1. 保留 lane 隔离（运行时防污染）。
2. 历史展示统一体验（不再暴露 lane 会话族概念）。
3. Memory 检索从 raw session 迁移到 lane 规范数据。
4. 通过 Hook 保证“用户输入先落地、模型输出后补齐”，降低异常丢数风险。

---

## 3. 核心决策（已拍板）

1. `pi-core session` 保留，继续服务系统内部运行，不作为应用层主记忆来源。
2. 新增应用层 `lane` 数据通道，独立于 session。
3. `memorySearch` 不再索引 `sessions(.jsonl)`，改为索引 lane 规范数据 + tenant 共享信息。
4. 主流程感知 lane：在 `runWithSingleFlight` 与 `agentId/sessionKey` 同层创建 lane 上下文并透传。
5. 历史接口返回统一消息流，并附带 `lane` 标签（`heavy | light`）。
6. 旧数据不迁移（测试环境直接丢弃可接受）。

---

## 4. 数据结构设计

## 4.1 lane 索引文件（`lane.json`）

作用：维护 laneKey 到当前 active lane 文件的映射（类似 `session.json`）。

- 文件位置：tenant 目录下（与 session 目录同层级风格）
- key 设计：`lane:{module}:{tenantId}`（不包含 heavy/light）
- value：当前 active lane 文件信息（含 `laneId`、`laneFile`、`updatedAt` 等）

> 说明：`heavy/light` 不放在 key 中，而是放在每条 lane event 中，便于统一时间线展示。

## 4.2 lane 明细文件（`<laneId>.jsonl`）

作用：保存按时间顺序追加的对话事件。

每行一个 event，建议最小字段：

- `id`
- `timestamp`
- `tenantId`
- `module`
- `laneKey`
- `laneMode`: `heavy | light`
- `role`: `user | assistant`
- `content`（清洗文本，禁止工具过程与推理链）
- `agentId`
- `sessionKey`
- `requestId`（可选，便于关联一轮）

---

## 5. 写入时机与 Hook 策略

## 5.1 agent start 节点

- 写入一条 `role=user` 的 lane event。
- 目的：即使后续 agent 异常，也保留用户输入。

## 5.2 agent end 节点

- 写入一条 `role=assistant` 的 lane event。
- 同时触发规范化记忆构建与索引更新。

---

## 6. API/函数职责（最小集合）

1. `ensureLaneDir(tenantId)`  
   确保 lane 目录存在（命名可按项目风格微调）。

2. `loadLaneIndex(tenantId)` / `saveLaneIndex(tenantId, index)`  
   读写 `lane.json`。

3. `appendLane(event)`  
   追加 event 到 active `<laneId>.jsonl`；包含轮转逻辑。

4. `loadLane(laneKey)`  
   读取 `lane.json` 找到 active 文件，再加载其内容。  
   当前策略只读 active，不保证历史全量回溯。

---

## 7. 轮转规则（硬约束）

- 单个 `<laneId>.jsonl` 最大 `256KB`。
- 超限后创建新 `<laneId>.jsonl`。
- 从旧文件末尾复制最近 `10` 条 event 到新文件。
- 每条复制内容最多保留前 `500` 字符。
- 新文件生效后同步更新 `lane.json` 对应映射。

> 粒度约定：`user/assistant` 各算 1 条。

---

## 8. Memory 检索策略（整改后）

- 不再索引 raw session。
- 索引源调整为：
  - lane 规范数据（应用层主记忆）
  - tenant 共享信息（已有 L2）
- 去重先用 hash（与现有 session 风格一致）。
- 若后续性能有压力，可演进为“dirty 标记 + 增量索引”。

---

## 9. 历史展示策略（Web）

- 返回统一时间线消息。
- 每条消息包含 `laneMode`。
- 不展示工具调用过程数据。
- 不向用户暴露 lane 会话族概念。

---

## 10. 边界与接受标准

## 10.1 已接受边界

- `loadLane` 只读 active 文件，可能出现“上一轮 lane 信息找不到”。
- 只要 heavy/light 主时序不丢失、不错乱，即可接受。

## 10.2 验收标准

1. heavy/light 切换后，用户感知为同一条连续历史流。
2. Memory 命中中显著减少工具过程噪音。
3. lane 写入在 agent 异常场景仍能保留用户输入。
4. 轮转后 lane 数据时序稳定、无错序。

---

## 11. 后续可选优化（非本期）

- 全量索引表 + dirty 增量同步。
- lane event 的结构化字段扩展（如 topic/tag）。
- 历史接口增加分页和时间窗口。