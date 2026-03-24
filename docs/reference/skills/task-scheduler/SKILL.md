# task-scheduler

Use this skill when the user asks for scheduled behavior, such as reminders, recurring pushes, delayed execution, or periodic autonomous tasks.

## Trigger Cues

- Chinese cues: "提醒我", "定时", "每天", "每周", "几点", "cron", "周期执行", "自动推送"
- English cues: "remind me", "schedule", "every day", "at 10:00", "recurring", "periodic", "cron"

## Goal

Translate natural-language scheduling intent into safe task-creation tool calls with validated parameters.

## Tool Selection

1. Use `createReminderTask` for deterministic notifications without model reasoning at execution time.
2. Use `createAgentTask` for intelligent scheduled work (analysis, summarization, autonomous evolution, optional notification).

## Parameter Policy

- Never ask the model to provide transport identity fields such as `qqOpenid`.
- Channel target identifiers are injected by backend runtime.
- Normalize time to `HH:mm` when using daily schedule.
- Default timezone: `Asia/Shanghai` when user does not specify one.
- For `execute_agent`, default `notify=false` unless user explicitly asks to push/notify.
- Do not default to broadcasting all channels.

## Clarification Rules

Ask a follow-up before creating task if any required field is missing:

- Missing schedule (daily/once)
- Missing execution time for daily schedule
- Ambiguous time expression ("later", "tomorrow morning")
- Unclear notification intent for agent task

## Safety Checks Before Tool Call

1. Confirm schedule type and required time fields are complete.
2. Validate time string format if daily schedule is used.
3. Ensure content/goal is non-empty and actionable.
4. Keep task title concise and stable for dedupe/readability.

## Response Pattern After Creation

After successful task creation, summarize:

- task type (`execute_reminder` or `execute_agent`)
- schedule (time/timezone/recurrence)
- notify behavior (`notify=true/false`)
- user-facing intent in one sentence

## Examples

- "每天 10 点提醒我喝水" -> `createReminderTask(content="喝水", scheduleType="daily_at", time="10:00", timezone="Asia/Shanghai")`
- "每天 9 点总结 AI 新闻发给我" -> `createAgentTask(goal="总结 AI 新闻", scheduleType="daily_at", time="09:00", notify=true, channels=["qq"])`
- "每天凌晨整理最近聊天形成记忆，不用通知" -> `createAgentTask(goal="整理最近聊天并沉淀记忆", scheduleType="daily_at", time="00:30", notify=false)`
