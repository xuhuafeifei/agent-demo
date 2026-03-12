import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { listAllTasks, type TaskScheduleRow } from "../../watch-dog/store.js";
import { runTaskByNameNow } from "../../watch-dog/watch-dog.js";
import { errResult, okResult, type ToolDetails } from "./types.js";

const toolLogger = getSubsystemConsoleLogger("tool");

const listTasksParams = Type.Object({});
type ListTasksInput = Static<typeof listTasksParams>;

type ListTasksOutput = {
  tasks: Array<
    Pick<
      TaskScheduleRow,
      | "task_name"
      | "task_type"
      | "status"
      | "next_run_time"
      | "interval_seconds"
      | "attempts"
      | "last_error"
    >
  >;
};

const runTaskParams = Type.Object({
  task_name: Type.String({ minLength: 1 }),
});
type RunTaskInput = Static<typeof runTaskParams>;

export function createListTasksTool(): ToolDefinition<
  typeof listTasksParams,
  ToolDetails<ListTasksOutput>
> {
  return {
    name: "listTaskSchedules",
    label: "List Task Schedules",
    description: "List all task_schedule entries with status and next_run_time.",
    parameters: listTasksParams,
    execute: async (_id, _params: ListTasksInput) => {
      try {
        const rows = await listAllTasks();
        const tasks = rows.map((row) => ({
          task_name: row.task_name,
          task_type: row.task_type,
          status: row.status,
          next_run_time: row.next_run_time,
          interval_seconds: row.interval_seconds,
          attempts: row.attempts,
          last_error: row.last_error,
        }));
        const summary =
          tasks.length === 0
            ? "No tasks found."
            : tasks
                .map(
                  (t, idx) =>
                    `[${idx + 1}] ${t.task_name} (${t.task_type}) status=${t.status} next=${t.next_run_time} interval=${t.interval_seconds}s attempts=${t.attempts}${t.last_error ? ` last_error=${t.last_error}` : ""}`,
                )
                .join("\n");
        return okResult(summary, { tasks });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.error("listTaskSchedules error=%s", message);
        return errResult("listTaskSchedules 失败", {
          code: "INTERNAL_ERROR",
          message,
        });
      }
    },
  };
}

export function createRunTaskTool(): ToolDefinition<
  typeof runTaskParams,
  ToolDetails<{ ok: boolean }>
> {
  return {
    name: "runTaskByName",
    label: "Run Task By Name",
    description:
      "Manually execute a task by task_name immediately (does not shift its next_run_time for recurring tasks).",
    parameters: runTaskParams,
    execute: async (_id, params: RunTaskInput) => {
      const taskName = params.task_name.trim();
      if (!taskName) {
        return errResult("task_name 不能为空", {
          code: "INVALID_ARGUMENT",
          message: "task_name 不能为空",
        });
      }
      try {
        const ok = await runTaskByNameNow(taskName);
        if (!ok) {
          return errResult(`未找到任务或缺少 handler：${taskName}`, {
            code: "NOT_FOUND",
            message: "任务不存在或缺少处理器",
          });
        }
        return okResult(`任务 ${taskName} 已立即执行`, { ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.error("runTaskByName error=%s", message);
        return errResult("runTaskByName 失败", {
          code: "INTERNAL_ERROR",
          message,
        });
      }
    },
  };
}
