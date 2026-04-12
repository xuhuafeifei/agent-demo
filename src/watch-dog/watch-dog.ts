import { getHeartbeatConfig } from "./config.js";
import {
  finalizeTask,
  getTaskByName,
  insertTaskDetail,
  listDueTasks,
  markTaskRunning,
  upsertTaskSchedule,
  type TaskDetailStatus,
  type TaskScheduleRow,
  type TaskStatus,
} from "./store.js";
import { HANDLERS, type HandlerResult, type TaskHandler } from "./handlers.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";
import type { TaskPayload } from "./types.js";
import { nowChinaIso } from "./time.js";
import { computeNextRunFromCron } from "./cron.js";

const logger = getSubsystemConsoleLogger("watch-dog");
export const watchDogLogger = logger;

let ticking = false;
let timer: NodeJS.Timeout | null = null;
let loopRunning = false;

function shouldAdvanceNextRun(
  triggerBy?: "heartbeat" | "functionTool",
): boolean {
  return triggerBy !== "functionTool";
}

/**
 * 解析任务负载文本为 JSON 对象
 * @param payloadText - 任务负载的 JSON 字符串
 * @returns 解析后的对象，解析失败则返回空对象
 */
function parsePayload(payloadText: string | null): TaskPayload {
  if (!payloadText) return {};
  try {
    return JSON.parse(payloadText);
  } catch {
    return {};
  }
}

/**
 * 将处理器结果状态转换为明细表状态
 * @param result - 处理器执行结果
 * @returns 明细表状态
 */
function toDetailStatus(result: HandlerResult): TaskDetailStatus {
  if (result.status === "success") return "success";
  if (result.status === "skipped") return "skipped";
  if (result.status === "timeout") return "timeout";
  return "failed";
}

/**
 * 执行单个任务
 * 完整的任务执行流程：标记运行中 -> 执行处理器 -> 更新任务状态 -> 插入执行明细
 * @param task - 任务信息
 * @param handler - 任务处理器
 * @param nowMs - 当前时间戳（毫秒）
 */
async function runSingleTask(
  task: TaskScheduleRow,
  handler: TaskHandler,
  opts?: { triggerBy?: "heartbeat" | "functionTool" },
): Promise<void> {
  const payload = parsePayload(task.payload_text);
  const config = getHeartbeatConfig();
  const startedAt = nowChinaIso();
  // 注：状态切到 running 和 attempts 累计已由 listDueTasks 的 UPDATE ... RETURNING 完成

  let result: HandlerResult;
  try {
    result = await handler({ task, payload, config });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("task(%s) exception: %s", task.task_name, message);
    result = { status: "failed", errorMessage: message };
  }

  const finishedAt = nowChinaIso();
  const isCron = task.schedule_kind === "cron";

  let nextRun: string | undefined;
  let finalStatus: TaskStatus;

  if (isCron) {
    // heartbeat 触发才推进节拍；functionTool 不改 next_run_time
    if (shouldAdvanceNextRun(opts?.triggerBy)) {
      nextRun = computeNextRunFromCron({
        cron: task.schedule_expr,
        timezone: task.timezone,
      });
    } else {
      nextRun = task.next_run_time;
    }
    finalStatus = "pending";
  } else {
    if (result.status === "success" || result.status === "skipped") {
      finalStatus = "done";
    } else if (result.status === "timeout") {
      finalStatus = "timeout";
    } else {
      finalStatus = "failed";
    }
  }

  const lastErrorForSchedule =
    result.status === "failed" || result.status === "timeout"
      ? (result.errorMessage ?? null)
      : null;

  await finalizeTask({
    taskId: task.id,
    status: finalStatus,
    finishedAtIso: finishedAt,
    nextRunTimeIso: nextRun,
    lastError: lastErrorForSchedule,
  });

  const detailMessage =
    result.status === "skipped"
      ? "skipped (blacklist period)"
      : (result.errorMessage ?? null);

  await insertTaskDetail({
    taskId: task.id,
    startTimeIso: startedAt,
    endTimeIso: finishedAt,
    status: toDetailStatus(result),
    errorMessage: detailMessage,
    executor: task.task_type,
  });
}

/**
 * 并发处理多个任务
 * 使用递归方式实现并发控制，最多同时运行指定数量的任务
 * @param tasks - 待处理任务列表
 * @param concurrency - 最大并发数
 */
async function processTasks(
  tasks: TaskScheduleRow[],
  concurrency: number,
): Promise<void> {
  if (tasks.length === 0) return;
  const runQueue: Promise<void>[] = [];
  let index = 0;

  const next = async (): Promise<void> => {
    const current = index++;
    if (current >= tasks.length) return;
    const task = tasks[current];
    const handler = HANDLERS[task.task_type];
    if (!handler) {
      logger.error("no handler for task_type=%s", task.task_type);
      return;
    }
    await runSingleTask(task, handler, { triggerBy: "heartbeat" });
    await next();
  };

  const workerCount = Math.min(concurrency, tasks.length);
  for (let i = 0; i < workerCount; i += 1) {
    runQueue.push(next());
  }
  await Promise.all(runQueue);
}

/**
 * 立即执行指定 task_name，并进行租户权限校验。
 * default 租户可触发任意任务，其他租户只能触发自己的任务。
 * 内部使用 "default" 身份查询任务，以区分 not_found 和 forbidden。
 * @returns "ok" 已触发 | "not_found" 任务不存在 | "forbidden" 无权限
 */
export async function runTaskByNameNowForTenant(
  taskName: string,
  tenantId: string,
): Promise<"ok" | "not_found" | "forbidden"> {
  // 用 "default" 身份查询，确保任务存在时能区分 "forbidden" 与 "not_found"
  const task = await getTaskByName(taskName, "default");
  if (!task) return "not_found";
  // 非 default 租户只能触发自己的任务
  if (tenantId !== "default" && task.tenant_id !== tenantId) return "forbidden";
  const handler = HANDLERS[task.task_type];
  if (!handler) {
    logger.error("no handler for task_type=%s", task.task_type);
    return "not_found";
  }
  await runSingleTask(task, handler, { triggerBy: "functionTool" });
  return "ok";
}

/**
 * 执行一次心跳检查
 * 查询到期任务并执行，使用防抖机制避免重复执行
 */
async function tickOnce(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const cfg = getHeartbeatConfig();
    if (!cfg.enabled) {
      logger.debug("heartbeat disabled via config");
      return;
    }
    const nowIso = nowChinaIso();
    const limit = Math.max(1, cfg.concurrency);
    const tasks = await listDueTasks(limit, nowIso);
    if (tasks.length === 0) return;
    await processTasks(tasks, limit);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("tick error: %s", message);
  } finally {
    ticking = false;
  }
}

/**
 * 确保系统任务存在
 * 创建 cleanup_logs 系统任务，用于定期清理旧日志
 */
async function ensureSystemTasks(): Promise<void> {
  await upsertTaskSchedule({
    task_name: "cleanup_logs",
    task_type: "cleanup_logs",
    payload_text: null,
    schedule_kind: "cron",
    // daily at 10:00
    schedule_expr: "0 0 10 * * *",
    timezone: "Asia/Shanghai",
    next_run_time: computeNextRunFromCron({
      cron: "0 0 10 * * *",
      timezone: "Asia/Shanghai",
    }),
    status: "pending",
  });
  await upsertTaskSchedule({
    task_name: "one_minute_heartbeat",
    task_type: "one_minute_heartbeat",
    payload_text: null,
    schedule_kind: "cron",
    // every minute at second 0
    schedule_expr: "0 */1 * * * *",
    timezone: "Asia/Shanghai",
    next_run_time: computeNextRunFromCron({
      cron: "0 */1 * * * *",
      timezone: "Asia/Shanghai",
    }),
    status: "pending",
  });
}

/**
 * 启动看门狗服务
 * 初始化系统任务，执行一次心跳检查，然后开始周期调度
 */
export async function startWatchDog(): Promise<void> {
  if (loopRunning) return;
  loopRunning = true;
  await ensureSystemTasks();
  tickLoop().finally(() => {
    loopRunning = false;
  });
  logger.info("started");
}

/**
 * 核心 tick 循环. 用于触发调度事件. 方法异步操作. 不会阻塞主线程
 */
async function tickLoop(): Promise<void> {
  while (loopRunning) {
    try {
      await tickOnce();
    } catch (err) {
      logger.error("tick exception: %s", err);
    }
    const cfg = getHeartbeatConfig();
    await new Promise<void>((resolve) => {
      timer = setTimeout(resolve, cfg.intervalMs);
    });
  }
}

/**
 * 停止看门狗服务
 * 取消定时器，停止周期调度
 */
export function stopWatchDog(): void {
  loopRunning = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  logger.info("stopped");
}
