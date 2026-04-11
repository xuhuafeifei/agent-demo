/**
 * 微信消息处理层
 *
 * 该模块负责微信 Bot 的消息接收、处理和发送功能，是微信通道与 Agent 系统之间的桥梁。
 * 主要功能包括：
 * - 长轮询获取微信消息
 * - 消息过滤与聚合
 * - 会话管理与状态维护
 * - 与 Agent 系统的交互
 * - 错误处理与重试机制
 */

import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { readFgbgUserConfig } from "../../config/index.js";
import { DEFAULT_SESSION_KEY, runWithSingleFlight } from "../../agent/run.js";
import {
  loadWeixinAccounts,
  updateWeixinBotBuf,
  updateWeixinBotPeerUserId,
  updateWeixinBotContextToken,
  updateWeixinBotSessionPause,
  WX_DEFAULT_IDENTIFY,
  type WeixinBoundBot,
} from "./weixin-account.js";
import { ilinkGetUpdates, ilinkSendText } from "./weixin-ilink.js";

const log = getSubsystemConsoleLogger("weixin-layer");

// 长轮询超时时间（毫秒）
const POLL_MS = 35_000;
// 空闲等待时间（毫秒）- 配置未启用或无 Bot 时的轮询间隔
const IDLE_MS = 5000;
// 会话过期错误码
const SESSION_ERR = -14;

/**
 * 异步睡眠函数
 * @param ms 睡眠时长（毫秒）
 * @returns Promise<void>
 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 解析 Agent 会话标识符
 *
 * 为主 Bot 使用默认会话标识符，其他 Bot 使用微信特定的会话标识符
 * @param primary 主 Bot 的标识符
 * @param identify 当前 Bot 的标识符
 * @returns Agent 会话标识符
 */
function resolveAgentId(primary: string, identify: string): string {
  if (primary && primary === identify) return DEFAULT_SESSION_KEY;
  return `weixin:${identify}`;
}

/**
 * 提取消息中的纯文本内容
 *
 * 处理微信可能返回的复合消息（包含多种消息类型），只提取文本内容
 * @param msg 完整的消息对象
 * @returns 纯文本内容（空字符串表示无有效文本）
 */
function extractUserText(msg: Record<string, unknown>): string {
  const items = msg.item_list as Array<Record<string, unknown>> | undefined;
  if (!items?.length) return "";
  for (const it of items) {
    if (Number(it.type) === 1) {
      const ti = it.text_item as { text?: string } | undefined;
      const t = ti?.text;
      if (typeof t === "string" && t.trim()) return t.trim();
    }
  }
  return "";
}

/**
 * 向指定 identify 的微信用户发送单向消息
 *
 * 从 accounts.json 读取对应 Bot 的对手方 peerUserId 和 contextToken，用于维持会话连续性。
 * 支持通过主 Bot 或指定 Bot 发送消息。
 *
 * @param content 要发送的消息内容
 * @param identify 可选的 Bot 标识符（未指定时使用主 Bot）
 * @returns Promise<boolean> 发送成功返回 true，失败返回 false
 */
export async function sendWeixinDirectMessage(
  content: string,
  identify?: string,
): Promise<boolean> {
  const text = content.trim();
  if (!text) return false;

  const store = loadWeixinAccounts();
  // 确定使用的 Bot（优先使用指定标识符，无指定时使用主 Bot，最后使用第一个 Bot）
  const botIdentify =
    identify?.trim() ||
    store.primary ||
    store.bots[0]?.identify ||
    WX_DEFAULT_IDENTIFY;
  if (!botIdentify) {
    log.error("sendWeixinDirectMessage failed: weixin bot missing");
    return false;
  }

  const bot = store.bots.find((b) => b.identify === botIdentify);
  if (!bot) {
    log.error(`sendWeixinDirectMessage failed: bot ${botIdentify} not found`);
    return false;
  }

  const toUserId = bot.peerUserId?.trim();
  if (!toUserId) {
    log.error(
      `sendWeixinDirectMessage failed: peerUserId missing for bot ${botIdentify}`,
    );
    return false;
  }

  try {
    await ilinkSendText({
      baseUrl: bot.baseUrl,
      token: bot.token,
      toUserId,
      text,
      contextToken: bot.contextToken || undefined,
    });
    return true;
  } catch (e) {
    log.error(
      `sendWeixinDirectMessage failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

/**
 * 处理单个 bot 桶内的消息聚合与 agent 调用
 * 同一 bot 的多条消息合并后单次 runWithSingleFlight
 */
/**
 * 处理单个 Bot 桶内的消息聚合与 Agent 调用
 *
 * 将同一 Bot 的多条消息合并后调用 Agent 处理，避免频繁的 Agent 调用。
 * 支持并发控制（singleflight），防止同一 Bot 同时处理多条消息。
 *
 * @param bot 当前处理的 Bot 配置
 * @param primary 主 Bot 的标识符
 * @param messages 待处理的消息列表
 * @param signal 取消信号
 */
async function processBotBucket(
  bot: WeixinBoundBot,
  primary: string,
  messages: Array<{ from: string; text: string }>,
  signal: AbortSignal,
): Promise<void> {
  // 聚合多条消息为单个文本块，格式化为列表形式
  const aggregatedText = messages
    .map((m, i) => `${i + 1}. ${m.text}`)
    .join("\n");

  const from = messages[0]?.from ?? "";
  if (!from) return;

  // 持久化对手方用户 ID（用于后续主动发送消息）
  updateWeixinBotPeerUserId(bot.identify, from);

  // 调用 Agent 处理消息
  const result = await runWithSingleFlight({
    message: aggregatedText,
    channel: "weixin",
    identify: bot.identify,
    agentId: resolveAgentId(primary, bot.identify),
    onEvent: () => {},
    onBusy: async () => {
      // Agent 繁忙时发送提示
      await ilinkSendText({
        baseUrl: bot.baseUrl,
        token: bot.token,
        toUserId: from,
        text: "正在处理上一条消息，请稍候",
        contextToken: bot.contextToken || undefined,
      });
    },
    onAccepted: async () => {
      // 消息被接受时发送确认回执
      try {
        await ilinkSendText({
          baseUrl: bot.baseUrl,
          token: bot.token,
          toUserId: from,
          text: "收到指令",
          contextToken: bot.contextToken || undefined,
        });
      } catch (e) {
        log.warn(
          `微信「收到指令」回执发送失败 identify=${bot.identify}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
  });

  // 只有完成状态的消息才回复
  if (result.status !== "completed") return;
  const out = (result.finalText ?? "").trim() || "好的";
  await ilinkSendText({
    baseUrl: bot.baseUrl,
    token: bot.token,
    toUserId: from,
    text: out,
    contextToken: bot.contextToken || undefined,
  });
}

/**
 * 单个 Bot 完整入站周期：长轮询 → 过滤聚合 → 执行 Agent
 *
 * 负责单个 Bot 的完整消息处理流程：
 * 1. 检查会话状态（是否暂停）
 * 2. 长轮询获取消息
 * 3. 错误处理与会话过期管理
 * 4. 消息过滤与聚合
 * 5. 调用 Agent 处理消息
 *
 * @param bot 当前处理的 Bot 配置
 * @param primary 主 Bot 的标识符
 * @param signal 取消信号
 */
async function runBotCycle(
  bot: WeixinBoundBot,
  primary: string,
  signal: AbortSignal,
): Promise<void> {
  log.debug("run ciycle...", bot.identify);
  // 会话过期暂停检查（持久化在 accounts.json）
  if (bot.sessionPausedUntil && Date.now() < bot.sessionPausedUntil) return;

  // 长轮询获取消息
  const resp = await ilinkGetUpdates({
    baseUrl: bot.baseUrl,
    token: bot.token,
    getUpdatesBuf: bot.updateBuf ?? "",
    timeoutMs: POLL_MS,
  });

  log.debug(`resp ${JSON.stringify(resp, null, 2)}`);

  // 检查响应错误
  const bad =
    (resp.ret !== undefined && resp.ret !== 0) ||
    (resp.errcode !== undefined && resp.errcode !== 0);
  if (bad) {
    // 会话过期处理（暂停 1 小时，防止频繁重连）
    if (resp.errcode === SESSION_ERR || resp.ret === SESSION_ERR) {
      const pausedUntil = Date.now() + 60 * 60_000;
      log.warn(
        `微信会话过期 identify=${bot.identify}，暂停 1 小时（需重新扫码绑定）`,
      );
      updateWeixinBotSessionPause(bot.identify, pausedUntil);
    }
    return;
  }

  // 更新长轮询缓冲区位置
  if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
    updateWeixinBotBuf(bot.identify, resp.get_updates_buf);
  }

  // 过滤 + 聚合：仅保留命中当前 bot 的文本消息
  const messages: Array<{ from: string; text: string }> = [];
  for (const full of resp.msgs ?? []) {
    // 提取消息发送者的用户ID，确保不为空
    const from = String(full.from_user_id ?? "").trim();
    if (!from) continue;

    // 过滤群聊消息（group_id不为空表示群聊）
    if (full.group_id != null && String(full.group_id).trim() !== "") continue;

    // 过滤非文本类型的消息（message_type === 1 表示文本消息）
    if (Number(full.message_type) !== 1) continue;

    // 提取消息中的纯文本内容（处理可能包含多种消息类型的复合消息）
    const text = extractUserText(full);
    if (!text) continue;

    // 更新上下文token，用于维持会话连续性
    const ctx = String(full.context_token ?? "").trim();
    if (ctx) updateWeixinBotContextToken(bot.identify, ctx);

    // 将有效消息添加到待处理列表
    messages.push({ from, text });
  }

  if (messages.length === 0) return;
  if (signal.aborted) return;

  // 处理消息桶
  await processBotBucket(bot, primary, messages, signal);
}

/**
 * 微信入站消息处理主循环
 *
 * 负责管理所有微信 Bot 的长轮询过程，包括：
 * 1. 检查微信通道是否启用
 * 2. 检查是否有配置的 Bot
 * 3. 并行处理多个 Bot 的消息循环
 * 4. 错误处理和回退机制
 *
 * @param signal 用于取消循环的信号
 */
export async function runWeixinInboundLoop(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const cfg = readFgbgUserConfig();
    log.debug("run weixin loop...");
    if (!cfg.channels.weixin?.enabled) {
      await sleep(IDLE_MS);
      continue;
    }
    const store = loadWeixinAccounts();
    if (store.bots.length === 0) {
      await sleep(IDLE_MS);
      continue;
    }
    try {
      // 各 bot 独立 poll，Promise.all 等全部完成后才下一轮
      await Promise.all(
        store.bots.map((bot) => runBotCycle(bot, store.primary, signal)),
      );
    } catch (e) {
      log.error(
        `weixin 轮询异常: ${e instanceof Error ? e.message : String(e)}`,
      );
      // 出错后退避 3 秒，避免疯狂循环浪费资源，同时给外部系统恢复时间
      await sleep(3000);
    }
  }
}

let abortCtl: AbortController | null = null;

/**
 * 启动微信消息处理层
 *
 * 负责启动微信入站消息处理循环，包括：
 * 1. 创建 AbortController 用于取消循环
 * 2. 启动 runWeixinInboundLoop 函数
 * 3. 错误处理
 * 4. 防止重复启动
 */
export function startWeixinLayer(): void {
  if (abortCtl) return;
  abortCtl = new AbortController();
  void runWeixinInboundLoop(abortCtl.signal).catch((e) =>
    log.error(`weixin loop 退出: ${e}`),
  );
  log.info("weixin-layer 已启动（长轮询）");
}
