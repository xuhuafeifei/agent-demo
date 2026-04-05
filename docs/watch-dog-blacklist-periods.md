# watch-dog 黑名单时段

## 背景

定时（cron）任务在部分时段不应执行业务逻辑（例如周末、午休）。本功能在 **各业务 handler 入口** 做运行时判断：命中黑名单则 **跳过业务**，对 **cron 任务** 仍按现有逻辑 **推进 `next_run_time`**（不计算「下一个非黑名单时刻」，下一次 tick 再判断是否仍命中）。

## 数据模型

任务 payload 可选字段：

```json
{
  "blacklistPeriods": [
    { "type": "cron", "content": "..." }
  ]
}
```

- **`type`**：当前仅 **`"cron"`** 会参与判断；其它类型预留，忽略。
- **`content`**：
  - **自定义**：标准 **Unix 五段 cron**（`分 时 日 月 周`），与系统任务 schedule 的「六段带秒」可并存；黑名单解析路径统一为五段（内部对 `cron-parser` 补 `0` 作为秒）。
  - **预设**：与代码中常量 **`BLACKLIST_PRESET_CRONS`** 某条的 **`cron` 字段完全一致**（`trim` 后 `===`），即视为使用该预设语义（周末 / 午休 / 晚间等）。大模型填参时应 **复制字面量**，勿用自然语言别名。

## 预设表（与代码同步）

实现见 `src/watch-dog/blacklist-presets.ts` 中的 `BLACKLIST_PRESET_CRONS`（每项含 `key`、`description`、五段 `cron`）。工具侧通过 `formatBlacklistPresetLines()` 将描述注入 `createReminderTask` / `createAgentTask` 的字段说明。

## 职责边界

| 位置 | 职责 |
|------|------|
| `blacklist-check.ts` | `isBlacklistedNow` / `shouldSkipTaskForBlacklistNow`：预设全等 + 五段 cron 与「当前触发时刻」是否对齐（fire time） |
| 各业务 handler | 执行业务 **前** 调用跳过判断；命中则返回 **`skipped`**（与 `success` / `failed` / `timeout` 区分） |
| `runSingleTask` | **不** 做统一拦截；finalize / `computeNextRunFromCron` 与原先一致 |

**系统任务**（如 `cleanup_logs`、`one_minute_heartbeat`）无 payload 或无 `blacklistPeriods` 时行为不变。

## 跳过与 `next_run`

- 命中黑名单：**不执行业务**，handler 返回 **`skipped`**；`task_schedule_detail.status` 为 **`skipped`**，`error_message` 为 `skipped (blacklist period)`；主表 `last_error` 不写入（与成功相同）。
- **cron 任务**：与正常跑完相同，仍由 `finalizeTask` + `computeNextRunFromCron` 写入 **常规** 下一拍；**不** 寻找「下一个非黑名单时刻」。

## 未支持

- 节假日等 **非 cron** 文本规则 —— 未实现。
