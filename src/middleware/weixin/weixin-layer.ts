/**
 * 微信消息处理层
 *
 * 负责微信 Bot 的消息接收、处理和发送功能，是微信通道与 Agent 系统之间的桥梁。
 * 以 tenantId 作为 Bot 唯一标识，每个 Bot 对应一个租户上下文。
 */

import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { readFgbgUserConfig } from "../../config/index.js";
import { runWithSingleFlight } from "../../agent/run.js";
import {
  loadWeixinAccounts,
  updateWeixinBotBuf,
  updateWeixinBotPeerUserId,
  updateWeixinBotContextToken,
  updateWeixinBotSessionPause,
  type WeixinBoundBot,
} from "./weixin-account.js";
import { ilinkGetUpdates, ilinkSendText } from "./weixin-ilink.js";

const log = getSubsystemConsoleLogger("weixin-layer");

const POLL_MS = 35_000;
const IDLE_MS = 5000;
const SESSION_ERR = -14;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 提取消息中的纯文本内容（处理微信复合消息格式）
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
 * 向指定 tenantId 对应的微信 Bot 发送单向消息。
 * 从 accounts.json 读取对应 Bot 的 peerUserId 和 contextToken。
 *
 * @param content 消息内容
 * @param tenantId 目标租户 ID，对应 accounts.json 中 bot.tenantId
 */
export async function sendWeixinDirectMessage(
  content: string,
  tenantId: string,
): Promise<boolean> {
  const text = content.trim();
  if (!text) return false;

  const store = loadWeixinAccounts();
  const bot =
    store.bots.find((b) => b.tenantId === tenantId) ??
    store.bots.find((b) => b.tenantId === store.primary) ??
    store.bots[0];

  if (!bot) {
    log.error(`sendWeixinDirectMessage failed: no bot for tenantId=${tenantId}`);
    return false;
  }

  const toUserId = bot.peerUserId?.trim();
  if (!toUserId) {
    log.error(`sendWeixinDirectMessage failed: peerUserId missing for bot tenantId=${bot.tenantId}`);
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
    log.error(`sendWeixinDirectMessage failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * 处理单个 Bot 桶内的消息聚合与 Agent 调用。
 * 将同一 Bot 的多条消息合并后调用 Agent 处理（单飞）。
 */
async function processBotBucket(
  bot: WeixinBoundBot,
  messages: Array<{ from: string; text: string }>,
  signal: AbortSignal,
): Promise<void> {
  const aggregatedText = messages.map((m, i) => `${i + 1}. ${m.text}`).join("\n");
  const from = messages[0]?.from ?? "";
  if (!from) return;

  // 持久化对手方用户 ID，供后续主动发消息使用
  updateWeixinBotPeerUserId(bot.tenantId, from);

  // 以 bot.tenantId 作为租户标识调用 Agent
  const result = await runWithSingleFlight({
    message: aggregatedText,
    channel: "weixin",
    tenantId: bot.tenantId,
    module: "main",
    sessionKey: `session:main:${bot.tenantId}`,
    onEvent: () => {},
    onBusy: async () => {
      await ilinkSendText({
        baseUrl: bot.baseUrl,
        token: bot.token,
        toUserId: from,
        text: "正在处理上一条消息，请稍候",
        contextToken: bot.contextToken || undefined,
      });
    },
    onAccepted: async () => {
      try {
        await ilinkSendText({
          baseUrl: bot.baseUrl,
          token: bot.token,
          toUserId: from,
          text: "收到指令",
          contextToken: bot.contextToken || undefined,
        });
      } catch (e) {
        log.warn(`微信「收到指令」回执发送失败 tenantId=${bot.tenantId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  });

  if (result.status !== "completed") return;
  const out = (result.finalText ?? "").trim() || "好的";
  await ilinkSendText({
    baseUrl: bot.baseUrl,
    token: bot.token,
    toUserId: from,
    text: out,
    contextToken: bot.contextToken || undefined,
  });

  // 抑制未使用参数警告
  void signal;
}

/**
 * 单个 Bot 完整入站周期：长轮询 → 过滤聚合 → 执行 Agent
 */
async function runBotCycle(bot: WeixinBoundBot, signal: AbortSignal): Promise<void> {
  log.debug("run cycle...", bot.tenantId);

  if (bot.sessionPausedUntil && Date.now() < bot.sessionPausedUntil) return;

  const resp = await ilinkGetUpdates({
    baseUrl: bot.baseUrl,
    token: bot.token,
    getUpdatesBuf: bot.updateBuf ?? "",
    timeoutMs: POLL_MS,
  });

  log.debug(`resp ${JSON.stringify(resp, null, 2)}`);

  const bad =
    (resp.ret !== undefined && resp.ret !== 0) ||
    (resp.errcode !== undefined && resp.errcode !== 0);
  if (bad) {
    if (resp.errcode === SESSION_ERR || resp.ret === SESSION_ERR) {
      const pausedUntil = Date.now() + 60 * 60_000;
      log.warn(`微信会话过期 tenantId=${bot.tenantId}，暂停 1 小时（需重新扫码绑定）`);
      updateWeixinBotSessionPause(bot.tenantId, pausedUntil);
    }
    return;
  }

  if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
    updateWeixinBotBuf(bot.tenantId, resp.get_updates_buf);
  }

  const messages: Array<{ from: string; text: string }> = [];
  for (const full of resp.msgs ?? []) {
    const from = String(full.from_user_id ?? "").trim();
    if (!from) continue;
    if (full.group_id != null && String(full.group_id).trim() !== "") continue;
    if (Number(full.message_type) !== 1) continue;
    const text = extractUserText(full);
    if (!text) continue;
    const ctx = String(full.context_token ?? "").trim();
    if (ctx) updateWeixinBotContextToken(bot.tenantId, ctx);
    messages.push({ from, text });
  }

  if (messages.length === 0) return;
  if (signal.aborted) return;

  await processBotBucket(bot, messages, signal);
}

/**
 * 微信入站消息处理主循环：并行处理所有 Bot 的消息，持续运行直到 signal 被取消
 */
export async function runWeixinInboundLoop(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const cfg = readFgbgUserConfig();
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
      await Promise.all(store.bots.map((bot) => runBotCycle(bot, signal)));
    } catch (e) {
      log.error(`weixin 轮询异常: ${e instanceof Error ? e.message : String(e)}`);
      await sleep(3000);
    }
  }
}

let abortCtl: AbortController | null = null;

/** 启动微信消息处理层，防止重复启动 */
export function startWeixinLayer(): void {
  if (abortCtl) return;
  abortCtl = new AbortController();
  void runWeixinInboundLoop(abortCtl.signal).catch((e) =>
    log.error(`weixin loop 退出: ${e}`),
  );
  log.info("weixin-layer 已启动（长轮询）");
}
