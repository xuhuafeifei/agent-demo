/**
 * 微信消息处理层
 *
 * 负责微信 Bot 的消息接收、处理和发送功能，是微信通道与 Agent 系统之间的桥梁。
 * 以 tenantId 作为 Bot 唯一标识，每个 Bot 对应一个租户上下文。
 */

import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { readFgbgUserConfig } from "../../config/index.js";
import { dispatchAgentRequest } from "../../agent/dispatch/dispatch.js";
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
 * tenantId 查找策略（优先级递减）：
 *   1. 精确匹配 bot.tenantId === tenantId
 *   2. 回退到主 bot（store.primary）
 *   3. 取第一个可用 bot
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
    log.error(
      `sendWeixinDirectMessage failed: no bot for tenantId=${tenantId}`,
    );
    return false;
  }

  const toUserId = bot.peerUserId?.trim();
  if (!toUserId) {
    log.error(
      `sendWeixinDirectMessage failed: peerUserId missing for bot tenantId=${bot.tenantId}`,
    );
    return false;
  }

  try {
    const sendResp = await ilinkSendText({
      baseUrl: bot.baseUrl,
      token: bot.token,
      toUserId,
      text,
      contextToken: bot.contextToken || undefined,
    });
    log.info(
      "sendWeixinDirectMessage ok tenantId=%s ret=%s",
      bot.tenantId,
      sendResp,
    );
    return true;
  } catch (e) {
    log.error(
      `sendWeixinDirectMessage failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

/**
 * 处理单个 Bot 桶内的消息聚合与 Agent 调用。
 * 将同一 Bot 的多条消息合并后调用 Agent 处理（单飞）。
 *
 * tenantId 流向：
 *   bot.tenantId（来自 WeixinBoundBot）→ dispatchAgentRequest({ tenantId })
 *   该 tenantId 会被 Agent 系统用来隔离不同租户的会话上下文和记忆。
 */
async function processBotBucket(
  bot: WeixinBoundBot,
  messages: Array<{ from: string; text: string }>,
  signal: AbortSignal,
): Promise<void> {
  // 聚合多条用户消息为编号列表，便于 Agent 理解批量输入
  const aggregatedText = messages
    .map((m, i) => `${i + 1}. ${m.text}`)
    .join("\n");
  const from = messages[0]?.from ?? "";
  if (!from) return;

  // 持久化对手方用户 ID，供后续主动发消息使用
  updateWeixinBotPeerUserId(bot.tenantId, from);

  const result = await dispatchAgentRequest({
    message: aggregatedText,
    channel: "weixin",
    tenantId: bot.tenantId, // 关键：将微信 bot 的 tenantId 传入 Agent，实现租户级隔离
    module: "main",
    onAccepted: async () => {
      // 请求被 Agent 接收后发送确认回执，避免用户重复发送
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
          `微信「收到指令」回执发送失败 tenantId=${bot.tenantId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
  });

  if (result.status === "busy") {
    await ilinkSendText({
      baseUrl: bot.baseUrl,
      token: bot.token,
      toUserId: from,
      text: result.message,
      contextToken: bot.contextToken || undefined,
    });
    return;
  }
  if (result.status === "failed") {
    await ilinkSendText({
      baseUrl: bot.baseUrl,
      token: bot.token,
      toUserId: from,
      text: `处理指令时发生错误: ${result.message}（系统异常）`,
      contextToken: bot.contextToken || undefined,
    });
    return;
  }
  // 将 Agent 最终生成的文本回复给用户，若无内容则发送默认回复"好的"
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
 *
 * 执行流程：
 *   1. 检查会话是否暂停（sessionPausedUntil），若处于冷却期则跳过本轮
 *   2. 调用 ilinkGetUpdates 长轮询微信服务端，拉取新消息（超时 POLL_MS=35s）
 *   3. 检查响应错误码，若为 SESSION_ERR(-14) 则标记会话暂停 1 小时
 *   4. 更新 bot 的 updateBuf（游标），避免重复拉取
 *   5. 遍历 msgs 数组，过滤出符合条件的消息：
 *      - 必须有 from_user_id
 *      - 排除群消息（group_id 非空）
 *      - 仅处理文本类型消息（message_type === 1）
 *      - 提取有效文本内容
 *   6. 同步 context_token 到 bot 状态
 *   7. 若有有效消息，调用 processBotBucket 聚合后送入 Agent
 */
async function runBotCycle(
  bot: WeixinBoundBot,
  signal: AbortSignal,
): Promise<void> {
  // log.debug("run cycle...", bot.tenantId);

  // 会话冷却期检查：绑定失效或扫码过期后暂停轮询
  if (bot.sessionPausedUntil && Date.now() < bot.sessionPausedUntil) {
    const pauseUntilStr = new Date(bot.sessionPausedUntil).toLocaleString(
      "zh-CN",
      { timeZone: "Asia/Shanghai" },
    );
    // 这里需要抛出异常，让外层捕获 sleep 3s。不然外层会以为运行成功，快速进行下一轮循环，实际上空转 cpu
    throw new Error(
      `微信会话过期 tenantId=${bot.tenantId}，暂停至 ${pauseUntilStr}（需重新扫码绑定）`,
    );
  }

  // 长轮询拉取新消息，服务端会在有新消息或超时后返回
  // 长轮询本身就自然充当间隔机制。没有消息，服务端挂起 35s 后返回
  // 因此空消息也不需要 sleep
  const resp = await ilinkGetUpdates({
    baseUrl: bot.baseUrl,
    token: bot.token,
    getUpdatesBuf: bot.updateBuf ?? "",
    timeoutMs: POLL_MS,
  });

  log.debug(`resp ${JSON.stringify(resp)}`);

  // 检查接口返回是否异常（ret 或 errcode 非 0）
  const bad =
    (resp.ret !== undefined && resp.ret !== 0) ||
    (resp.errcode !== undefined && resp.errcode !== 0);
  if (bad) {
    // SESSION_ERR(-14) 表示微信会话过期（如二维码失效），暂停 1 小时避免频繁报错
    if (resp.errcode === SESSION_ERR || resp.ret === SESSION_ERR) {
      const pausedUntil = Date.now() + 60 * 60_000;
      log.warn(
        `微信会话过期 tenantId=${bot.tenantId}，暂停 1 小时（需重新扫码绑定）`,
      );
      updateWeixinBotSessionPause(bot.tenantId, pausedUntil);
    }
    return;
  }

  // 更新消息游标，下次轮询从该位置继续，避免重复消费
  if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
    updateWeixinBotBuf(bot.tenantId, resp.get_updates_buf);
  }

  // 过滤并聚合有效消息
  const messages: Array<{ from: string; text: string }> = [];
  for (const full of resp.msgs ?? []) {
    const from = String(full.from_user_id ?? "").trim();
    if (!from) continue;
    // 跳过群消息，仅处理私聊
    if (full.group_id != null && String(full.group_id).trim() !== "") continue;
    // 仅处理文本类型消息（type=1）
    if (Number(full.message_type) !== 1) continue;
    const text = extractUserText(full);
    if (!text) continue;
    // 同步 context_token，供后续发消息使用
    const ctx = String(full.context_token ?? "").trim();
    if (ctx) updateWeixinBotContextToken(bot.tenantId, ctx);
    messages.push({ from, text });
  }

  if (messages.length === 0) return;
  if (signal.aborted) return;

  // 消息送入 Agent 处理（聚合后单飞）
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
      log.error(
        `weixin 轮询异常: ${e instanceof Error ? e.message : String(e)}`,
      );
      await sleep(5000);
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
