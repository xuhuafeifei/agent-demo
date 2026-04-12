import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { HeartbeatConfig } from "./config.js";
import type { TaskScheduleRow } from "./store.js";
import { cleanupOldDetails } from "./store.js";
// resolveTenantWorkspaceDir：根据 tenantId 解析对应租户的 workspace 路径，实现租户隔离
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

/** 任务执行结果：status 表示执行状态，errorMessage 记录失败原因 */
export type HandlerResult = {
  status: "success" | "failed" | "timeout" | "skipped";
  errorMessage?: string;
};

/** 任务处理器函数签名：接收任务、解析后的 payload 和全局配置，返回执行结果 */
export type TaskHandler = (params: {
  task: TaskScheduleRow;
  payload: TaskPayload;
  config: HeartbeatConfig;
}) => Promise<HandlerResult>;

/** 类型守卫：校验是否为非空字符串数组（用于脚本参数校验） */
function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

/**
 * 带超时控制的命令执行：超时先发 SIGTERM，5 秒后 SIGKILL
 * 用于安全地终止子进程，避免僵尸进程
 */
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

    // 确保只 resolve 一次，防止竞态条件
    const cleanResolve = (result: HandlerResult) => {
      if (resolved) return;
      resolved = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve(result);
    };

    // 子进程正常退出：根据退出信号/状态码判断 success/failed
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

    // 超时处理：优雅终止（SIGTERM）-> 强制杀死（SIGKILL）
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
 *
 * tenantId 隔离机制：
 * 1. 从任务 payload 中读取 tenantId（identify 字段现在映射到 tenantId）
 * 2. 若未指定，则回退到全局配置的 web 渠道 tenantId
 * 3. 根据 tenantId 解析对应租户的 workspace 目录，实现多租户环境隔离
 * 4. 脚本必须在 workspace/scripts/ 目录下执行，且受 allowedScripts 白名单限制
 */
export const executeScriptHandler: TaskHandler = async ({ task, payload, config }) => {
  watchDogLogger.info("[execute_script] triggered");
  // 黑名单校验：若当前时间在黑名单时间段内，跳过执行
  if (shouldSkipTaskForBlacklistNow({ payload, timezone: task.timezone })) {
    watchDogLogger.info("[execute_script] skipped (blacklist)");
    return { status: "skipped" };
  }

  const p = (payload ?? {}) as ScriptTaskPayload & { tenantId?: string };
  // 取任务 payload 中的 tenantId（默认 "default"），决定使用哪个租户的 workspace
  // identify 字段已统一映射到 tenantId，实现租户隔离
  const tenantId = typeof p.tenantId === "string" && p.tenantId.trim()
    ? p.tenantId.trim()
    : readFgbgUserConfig().channels.web.tenantId;
  // resolveTenantWorkspaceDir 根据 tenantId 定位租户专属的 workspace 目录
  const workspaceDir = resolveTenantWorkspaceDir(tenantId);
  const scriptsDir = path.join(workspaceDir, "scripts");
  const scriptName = typeof p.script === "string" ? p.script : "";
  const args = isStringArray(p.args) ? p.args : [];
  // 超时时间校验：限制在 1s ~ 300s 之间，防止任务无限挂起
  const timeoutMsRaw = p.timeoutMs;
  const timeoutMs =
    typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw)
      ? Math.max(1000, Math.min(300_000, Math.floor(timeoutMsRaw)))
      : 10_000;

  // 校验脚本名不能为空
  if (!scriptName) {
    watchDogLogger.error("[execute_script] script is required");
    return { status: "failed", errorMessage: "script is required" };
  }

  // 安全校验：脚本必须在 allowedScripts 白名单中（防止执行恶意脚本）
  if (config.allowedScripts.length > 0 && !config.allowedScripts.includes(scriptName)) {
    watchDogLogger.error("[execute_script] script not allowed: %s", scriptName);
    return { status: "failed", errorMessage: `script not allowed: ${scriptName}` };
  }

  // 路径穿越防护：确保解析后的脚本路径仍在 scripts 目录下
  const scriptPath = path.resolve(scriptsDir, scriptName);
  if (!scriptPath.startsWith(path.resolve(scriptsDir) + path.sep)) {
    watchDogLogger.error("[execute_script] script path outside scripts/ dir: %s", scriptName);
    return { status: "failed", errorMessage: "script path outside scripts/ dir" };
  }

  // 文件存在性校验
  if (!fs.existsSync(scriptPath)) {
    watchDogLogger.error("[execute_script] script not found: %s", scriptName);
    return { status: "failed", errorMessage: `script not found: ${scriptName}` };
  }

  // 可执行权限校验
  try {
    fs.accessSync(scriptPath, fs.constants.X_OK);
  } catch {
    watchDogLogger.error("[execute_script] script not executable: %s", scriptName);
    return { status: "failed", errorMessage: "script not executable" };
  }

  // 执行脚本（带超时控制）
  const result = await runWithTimeout(scriptPath, args, { cwd: scriptsDir, timeoutMs });
  watchDogLogger.info("[execute_script] completed: %s", scriptName);
  return result;
};

/** 清理日志处理器：删除 7 天前的任务执行明细，防止存储无限增长 */
export const cleanupLogsHandler: TaskHandler = async () => {
  watchDogLogger.info("[cleanup_logs] triggered");
  // 计算 7 天前的时间戳（中国时区），作为清理截止点
  const cutoff = formatChinaIso(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  await cleanupOldDetails(cutoff);
  watchDogLogger.info("[cleanup_logs] completed");
  return { status: "success" };
};

/**
 * 渠道列表规范化：将输入值转换为 ["qq" | "weixin" | "web"] 数组
 * - 非数组或空数组默认回退到 ["qq"]
 * - 过滤掉非法渠道值（只保留 qq/weixin/web）
 */
function toChannelList(value: unknown): Array<"qq" | "weixin" | "web"> {
  if (!Array.isArray(value)) return ["qq"];
  const list = value.filter(
    (v): v is "qq" | "weixin" | "web" => v === "qq" || v === "weixin" || v === "web",
  );
  return list.length > 0 ? list : ["qq"];
}

/**
 * 按渠道列表投递通知消息。
 *
 * 路由机制：
 * - tenantId 用于路由到对应的 bot 账号（qq/weixin accounts.json 中的 bot.tenantId）
 * - 每个渠道调用各自的 sendDirectMessage 函数，传入 tenantId 确保使用正确的租户 bot
 * - web 渠道暂未实现，会抛出错误
 *
 * 错误处理：
 * - 逐个渠道尝试发送，记录成功/失败数量
 * - 至少一个渠道发送成功即返回 success
 * - 全部失败时返回 aggregated error message
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
      // QQ 渠道：sendQQDirectMessage 内部根据 tenantId 查找对应的 bot 账号
      const ok = await sendQQDirectMessage(text, tenantId);
      if (ok) successCount++;
      else errors.push("qq send failed");
    } else if (ch === "weixin") {
      // 微信渠道：同理，根据 tenantId 路由到对应的微信 bot
      const ok = await sendWeixinDirectMessage(text, tenantId);
      if (ok) successCount++;
      else errors.push("weixin send failed");
    } else if (ch === "web") {
      // web 渠道暂未实现（web 是 watch-dog 内部的回调通道，不需要外部消息投递）
      throw new Error("web channel notification is not implemented yet");
    }
  }

  // 至少一个渠道成功即视为整体成功，否则聚合所有错误信息
  if (successCount > 0) return { status: "success" };
  return { status: "failed", errorMessage: errors.join("; ") || "no channel delivered" };
}

/**
 * 提醒任务处理器：向指定渠道发送固定内容提醒
 *
 * 工作流程：
 * 1. 黑名单校验：检查当前时间是否在任务的黑名单时间段内
 * 2. 提取 payload 中的 content 字段，校验非空
 * 3. 解析渠道列表（默认 qq），解析 tenantId（默认 QQ_DEFAULT_TENANT_ID）
 * 4. 调用 deliverReminderByChannels 按渠道投递通知
 *
 * tenantId 隔离：
 * - payload.tenantId 决定路由到哪个 bot 账号
 * - identify 字段已统一映射到 tenantId
 * - 若未指定 tenantId，回退到 QQ_DEFAULT_TENANT_ID（即默认 QQ bot 账号）
 */
export const executeReminderHandler: TaskHandler = async ({ task, payload }) => {
  handlerLogger.info("execute_reminder trigger! task_name=%s", task.task_name);
  // 黑名单校验：若当前时间在黑名单时间段内，跳过执行
  if (shouldSkipTaskForBlacklistNow({ payload, timezone: task.timezone })) {
    handlerLogger.info("execute_reminder skipped (blacklist) task_name=%s", task.task_name);
    return { status: "skipped" };
  }
  const p = (payload ?? {}) as ReminderTaskPayload;
  // 校验 content 字段必须存在且非空（提醒内容的核心字段）
  const content = typeof p.content === "string" ? p.content.trim() : "";
  if (!content) {
    handlerLogger.error("execute_reminder failed task_name=%s content is required", task.task_name);
    return { status: "failed", errorMessage: "content is required" };
  }
  // 渠道列表规范化（默认 qq）
  const channels = toChannelList(p.channels);
  // tenantId 决定路由到哪个 bot 账号，未指定时使用默认值
  const tenantId = typeof p.tenantId === "string" && p.tenantId.trim()
    ? p.tenantId.trim()
    : QQ_DEFAULT_TENANT_ID;

  // 按渠道投递通知消息
  const result = await deliverReminderByChannels({ channels, text: content, tenantId });
  handlerLogger.info(
    "execute_reminder completed task_name=%s status=%s",
    task.task_name,
    result.status,
  );
  return result;
};

/**
 * 智能定时任务处理器：调用 Agent 执行目标，可选通知结果
 *
 * 核心机制：
 * 1. tenantId 隔离：决定执行该任务时使用哪个租户的 workspace/memory/session
 *    - payload.tenantId 优先，未指定则回退到全局 web 渠道的 tenantId
 *    - 不同租户的 Agent 上下文完全隔离（记忆、会话、工作空间独立）
 * 2. 使用 runWithSingleFlight 调用 Agent：
 *    - module: "watch-dog" 确保与 main 模块并发互不阻塞
 *    - watchDogTaskId: 绑定任务 ID，便于追踪和日志关联
 *    - channel: "web" 表示这是 watch-dog 内部触发的任务（非外部用户消息）
 * 3. 通知可选：p.notify === true 时，将 Agent 执行结果投递到指定渠道
 *
 * 错误处理：
 * - try-catch 包裹整个 Agent 执行过程
 * - Agent 内部异常会被捕获并返回 failed 状态，不会导致 watch-dog 崩溃
 */
export const executeAgentHandler: TaskHandler = async ({ task, payload }) => {
  handlerLogger.info("execute_agent trigger! task_name=%s", task.task_name);
  // 黑名单校验：若当前时间在黑名单时间段内，跳过执行
  if (shouldSkipTaskForBlacklistNow({ payload, timezone: task.timezone })) {
    handlerLogger.info("execute_agent skipped (blacklist) task_name=%s", task.task_name);
    return { status: "skipped" };
  }
  const p = (payload ?? {}) as AgentTaskPayload;
  // 校验 goal 字段必须存在且非空（Agent 执行目标的核心字段）
  const goal = typeof p.goal === "string" ? p.goal.trim() : "";
  if (!goal) {
    handlerLogger.error("execute_agent failed task_name=%s goal is required", task.task_name);
    return { status: "failed", errorMessage: "goal is required" };
  }

  // tenantId 隔离：决定执行该任务时使用哪个租户的 workspace/memory/session
  // identify 字段已统一映射到 tenantId，实现多租户环境隔离
  // 若未指定 tenantId，回退到全局配置的 web 渠道 tenantId
  const tenantId = typeof p.tenantId === "string" && p.tenantId.trim()
    ? p.tenantId.trim()
    : readFgbgUserConfig().channels.web.tenantId;

  try {
    // 动态导入 Agent 运行模块（避免循环依赖，且按需加载）
    const { runWithSingleFlight } = await import("../agent/run.js");
    const now = nowChinaIso();
    // 构建 Agent 执行的 prompt：包含任务名、当前时间、任务目标
    const prompt = [
      `你在执行定时任务。`,
      `任务名: ${task.task_name}`,
      `当前时间: ${now}`,
      `任务目标: ${goal}`,
      `请输出简洁的最终执行结果文本。`,
    ].join("\n");

    // watch-dog 使用独立 module，与 main 并发互不阻塞
    // 每个任务使用独立的 sessionKey（通过 watchDogTaskId 区分）
    const result = await runWithSingleFlight({
      message: prompt,
      channel: "web",                    // web 渠道表示内部触发（非外部用户消息）
      tenantId,                          // 租户隔离：使用对应租户的 workspace/memory/session
      module: "watch-dog",               // 独立模块标识，与 main 并发隔离
      watchDogTaskId: String(task.id),   // 任务 ID 绑定，便于日志追踪
      onEvent: () => {
        // watch-dog 不透传流式事件（静默执行，只在结束时获取最终结果）
      },
    });
    const finalText = result.finalText?.trim() || "任务已执行完成。";

    // 若不需要通知，直接返回成功（Agent 已执行完毕，但不推送结果）
    if (p.notify !== true) {
      handlerLogger.info(
        "execute_agent completed task_name=%s status=success notify=false",
        task.task_name,
      );
      return { status: "success" };
    }

    // 需要通知：将 Agent 执行结果投递到指定渠道
    const channels = toChannelList(p.channels);
    const deliverResult = await deliverReminderByChannels({ channels, text: finalText, tenantId });
    handlerLogger.info(
      "execute_agent completed task_name=%s status=%s notify=true",
      task.task_name,
      deliverResult.status,
    );
    return deliverResult;
  } catch (error) {
    // 捕获 Agent 执行异常（防止异常冒泡导致 watch-dog 崩溃）
    const message = error instanceof Error ? error.message : String(error);
    handlerLogger.error("execute_agent failed task_name=%s error=%s", task.task_name, message);
    return { status: "failed", errorMessage: message };
  }
};

/** 一分钟心跳处理器：向事件总线发送心跳事件，用于维持系统活跃状态 */
export const oneMinuteHeartbeatHandler: TaskHandler = async () => {
  watchDogLogger.info("[one_minute_heartbeat] triggered");
  eventBus.emit(TOPPIC_HEART_BEAT, {});
  return { status: "success" };
};

/**
 * 任务处理器注册表：任务类型 -> 处理器函数
 * - execute_script: 执行 workspace/scripts 目录下的脚本（租户隔离）
 * - execute_reminder: 向指定渠道发送固定内容提醒（租户路由）
 * - execute_agent: 调用 Agent 执行目标，可选通知结果（租户隔离 + 并发隔离）
 * - cleanup_logs: 清理 7 天前的任务执行明细
 * - one_minute_heartbeat: 发送心跳事件，维持系统活跃
 */
export const HANDLERS: Record<string, TaskHandler> = {
  execute_script: executeScriptHandler,
  execute_reminder: executeReminderHandler,
  execute_agent: executeAgentHandler,
  cleanup_logs: cleanupLogsHandler,
  one_minute_heartbeat: oneMinuteHeartbeatHandler,
};
