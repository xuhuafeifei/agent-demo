import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { HeartbeatConfig } from "./config.js";
import type { TaskScheduleRow } from "./store.js";
import { cleanupOldDetails } from "./store.js";
import { resolveTenantWorkspaceDir } from "../utils/app-path.js";
import type {
  AgentTaskPayload,
  ReminderTaskPayload,
  ScriptTaskPayload,
  TaskPayload,
} from "./types.js";
import { watchDogLogger } from "./watch-dog.js";
import { shouldSkipTaskForBlacklistNow } from "./blacklist-check.js";
import { getEventBus, TOPPIC_HEART_BEAT } from "../event-bus/index.js";
import { sendQQDirectMessage } from "../middleware/qq/qq-layer.js";
import { QQ_DEFAULT_TENANT_ID } from "../middleware/qq/qq-account.js";
import { sendWeixinDirectMessage } from "../middleware/weixin/weixin-layer.js";
import { formatChinaIso, nowChinaIso } from "./time.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";
import { readFgbgUserConfig } from "../config/index.js";

const eventBus = getEventBus();
const handlerLogger = getSubsystemConsoleLogger("watch-dog:handler");

export type HandlerResult = {
  status: "success" | "failed" | "timeout" | "skipped";
  errorMessage?: string;
};

export type TaskHandler = (params: {
  task: TaskScheduleRow;
  payload: TaskPayload;
  config: HeartbeatConfig;
}) => Promise<HandlerResult>;

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

/** 带超时控制的命令执行：超时先发 SIGTERM，5 秒后 SIGKILL */
async function runWithTimeout(
  command: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<HandlerResult> {
  return new Promise<HandlerResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: "inherit",
      shell: false,
    });

    let timeoutHandle: NodeJS.Timeout | null = null;
    let resolved = false;

    const cleanResolve = (result: HandlerResult) => {
      if (resolved) return;
      resolved = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve(result);
    };

    child.on("exit", (code, signal) => {
      if (resolved) return;
      if (signal === "SIGTERM" || signal === "SIGKILL") {
        cleanResolve({ status: "timeout", errorMessage: `killed by ${signal}` });
      } else if (code === 0) {
        cleanResolve({ status: "success" });
      } else {
        cleanResolve({ status: "failed", errorMessage: `exit code ${code ?? "null"}` });
      }
    });

    timeoutHandle = setTimeout(() => {
      if (child.killed) return;
      child.kill("SIGTERM");
      setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 5_000);
      cleanResolve({ status: "timeout", errorMessage: "timeout exceeded" });
    }, opts.timeoutMs);
  });
}

/**
 * 执行脚本处理器：在 workspace/scripts 目录下执行指定脚本
 */
export const executeScriptHandler: TaskHandler = async ({ task, payload, config }) => {
  watchDogLogger.info("[execute_script] triggered");
  if (shouldSkipTaskForBlacklistNow({ payload, timezone: task.timezone })) {
    watchDogLogger.info("[execute_script] skipped (blacklist)");
    return { status: "skipped" };
  }

  const p = (payload ?? {}) as ScriptTaskPayload & { tenantId?: string };
  // 取任务 payload 中的 tenantId（默认 "default"），决定使用哪个租户的 workspace
  const tenantId = typeof p.tenantId === "string" && p.tenantId.trim()
    ? p.tenantId.trim()
    : readFgbgUserConfig().channels.web.tenantId;
  const workspaceDir = resolveTenantWorkspaceDir(tenantId);
  const scriptsDir = path.join(workspaceDir, "scripts");
  const scriptName = typeof p.script === "string" ? p.script : "";
  const args = isStringArray(p.args) ? p.args : [];
  const timeoutMsRaw = p.timeoutMs;
  const timeoutMs =
    typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw)
      ? Math.max(1000, Math.min(300_000, Math.floor(timeoutMsRaw)))
      : 10_000;

  if (!scriptName) {
    watchDogLogger.error("[execute_script] script is required");
    return { status: "failed", errorMessage: "script is required" };
  }

  if (config.allowedScripts.length > 0 && !config.allowedScripts.includes(scriptName)) {
    watchDogLogger.error("[execute_script] script not allowed: %s", scriptName);
    return { status: "failed", errorMessage: `script not allowed: ${scriptName}` };
  }

  const scriptPath = path.resolve(scriptsDir, scriptName);
  if (!scriptPath.startsWith(path.resolve(scriptsDir) + path.sep)) {
    watchDogLogger.error("[execute_script] script path outside scripts/ dir: %s", scriptName);
    return { status: "failed", errorMessage: "script path outside scripts/ dir" };
  }

  if (!fs.existsSync(scriptPath)) {
    watchDogLogger.error("[execute_script] script not found: %s", scriptName);
    return { status: "failed", errorMessage: `script not found: ${scriptName}` };
  }

  try {
    fs.accessSync(scriptPath, fs.constants.X_OK);
  } catch {
    watchDogLogger.error("[execute_script] script not executable: %s", scriptName);
    return { status: "failed", errorMessage: "script not executable" };
  }

  const result = await runWithTimeout(scriptPath, args, { cwd: scriptsDir, timeoutMs });
  watchDogLogger.info("[execute_script] completed: %s", scriptName);
  return result;
};

/** 清理日志处理器：删除 7 天前的任务执行明细 */
export const cleanupLogsHandler: TaskHandler = async () => {
  watchDogLogger.info("[cleanup_logs] triggered");
  const cutoff = formatChinaIso(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  await cleanupOldDetails(cutoff);
  watchDogLogger.info("[cleanup_logs] completed");
  return { status: "success" };
};

function toChannelList(value: unknown): Array<"qq" | "weixin" | "web"> {
  if (!Array.isArray(value)) return ["qq"];
  const list = value.filter(
    (v): v is "qq" | "weixin" | "web" => v === "qq" || v === "weixin" || v === "web",
  );
  return list.length > 0 ? list : ["qq"];
}

/**
 * 按渠道列表投递通知消息。
 * tenantId 用于路由到对应的 bot 账号（qq/weixin accounts.json 中 bot.tenantId）。
 */
async function deliverReminderByChannels(params: {
  channels: Array<"qq" | "weixin" | "web">;
  text: string;
  tenantId: string;
}): Promise<HandlerResult> {
  const { channels, text, tenantId } = params;
  let successCount = 0;
  const errors: string[] = [];

  for (const ch of channels) {
    if (ch === "qq") {
      const ok = await sendQQDirectMessage(text, tenantId);
      if (ok) successCount++;
      else errors.push("qq send failed");
    } else if (ch === "weixin") {
      const ok = await sendWeixinDirectMessage(text, tenantId);
      if (ok) successCount++;
      else errors.push("weixin send failed");
    } else if (ch === "web") {
      throw new Error("web channel notification is not implemented yet");
    }
  }

  if (successCount > 0) return { status: "success" };
  return { status: "failed", errorMessage: errors.join("; ") || "no channel delivered" };
}

/** 提醒任务处理器：向指定渠道发送固定内容提醒 */
export const executeReminderHandler: TaskHandler = async ({ task, payload }) => {
  handlerLogger.info("execute_reminder trigger! task_name=%s", task.task_name);
  if (shouldSkipTaskForBlacklistNow({ payload, timezone: task.timezone })) {
    handlerLogger.info("execute_reminder skipped (blacklist) task_name=%s", task.task_name);
    return { status: "skipped" };
  }
  const p = (payload ?? {}) as ReminderTaskPayload;
  const content = typeof p.content === "string" ? p.content.trim() : "";
  if (!content) {
    handlerLogger.error("execute_reminder failed task_name=%s content is required", task.task_name);
    return { status: "failed", errorMessage: "content is required" };
  }
  const channels = toChannelList(p.channels);
  // tenantId 决定路由到哪个 bot 账号
  const tenantId = typeof p.tenantId === "string" && p.tenantId.trim()
    ? p.tenantId.trim()
    : QQ_DEFAULT_TENANT_ID;

  const result = await deliverReminderByChannels({ channels, text: content, tenantId });
  handlerLogger.info(
    "execute_reminder completed task_name=%s status=%s",
    task.task_name,
    result.status,
  );
  return result;
};

/** 智能定时任务处理器：调用 Agent 执行目标，可选通知结果 */
export const executeAgentHandler: TaskHandler = async ({ task, payload }) => {
  handlerLogger.info("execute_agent trigger! task_name=%s", task.task_name);
  if (shouldSkipTaskForBlacklistNow({ payload, timezone: task.timezone })) {
    handlerLogger.info("execute_agent skipped (blacklist) task_name=%s", task.task_name);
    return { status: "skipped" };
  }
  const p = (payload ?? {}) as AgentTaskPayload;
  const goal = typeof p.goal === "string" ? p.goal.trim() : "";
  if (!goal) {
    handlerLogger.error("execute_agent failed task_name=%s goal is required", task.task_name);
    return { status: "failed", errorMessage: "goal is required" };
  }

  // 取 payload 中的 tenantId，决定执行该任务时使用哪个租户的 workspace/memory/session
  const tenantId = typeof p.tenantId === "string" && p.tenantId.trim()
    ? p.tenantId.trim()
    : readFgbgUserConfig().channels.web.tenantId;

  try {
    const { runWithSingleFlight } = await import("../agent/run.js");
    const now = nowChinaIso();
    const prompt = [
      `你在执行定时任务。`,
      `任务名: ${task.task_name}`,
      `当前时间: ${now}`,
      `任务目标: ${goal}`,
      `请输出简洁的最终执行结果文本。`,
    ].join("\n");

    // watch-dog 使用独立 module，与 main 并发互不阻塞；每个任务独立 sessionKey
    const result = await runWithSingleFlight({
      message: prompt,
      channel: "web",
      tenantId,
      module: "watch-dog",
      sessionKey: `watchdog:task:${task.id}`,
      onEvent: () => {
        // watch-dog 不透传流式事件
      },
    });
    const finalText = result.finalText?.trim() || "任务已执行完成。";

    if (p.notify !== true) {
      handlerLogger.info(
        "execute_agent completed task_name=%s status=success notify=false",
        task.task_name,
      );
      return { status: "success" };
    }

    const channels = toChannelList(p.channels);
    const deliverResult = await deliverReminderByChannels({ channels, text: finalText, tenantId });
    handlerLogger.info(
      "execute_agent completed task_name=%s status=%s notify=true",
      task.task_name,
      deliverResult.status,
    );
    return deliverResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    handlerLogger.error("execute_agent failed task_name=%s error=%s", task.task_name, message);
    return { status: "failed", errorMessage: message };
  }
};

export const oneMinuteHeartbeatHandler: TaskHandler = async () => {
  watchDogLogger.info("[one_minute_heartbeat] triggered");
  eventBus.emit(TOPPIC_HEART_BEAT, {});
  return { status: "success" };
};

/** 任务处理器注册表：任务类型 → 处理器函数 */
export const HANDLERS: Record<string, TaskHandler> = {
  execute_script: executeScriptHandler,
  execute_reminder: executeReminderHandler,
  execute_agent: executeAgentHandler,
  cleanup_logs: cleanupLogsHandler,
  one_minute_heartbeat: oneMinuteHeartbeatHandler,
};
