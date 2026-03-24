// 任务 payload 基础类型，允许按 task_type 定制扩展
export type TaskPayload = Record<string, unknown>;

// execute_script 专用负载
export type ScriptTaskPayload = {
  script: string;
  args?: string[];
  timeoutMs?: number;
};

export type ReminderTaskPayload = {
  content: string;
  channels: Array<"qq" | "web">;
  timezone?: string;
  target?: {
    qqOpenid?: string;
  };
};

export type AgentTaskPayload = {
  goal: string;
  notify?: boolean;
  channels?: Array<"qq" | "web">;
  timezone?: string;
  mode?: "evolve" | "analyze_then_notify";
  target?: {
    qqOpenid?: string;
  };
};
