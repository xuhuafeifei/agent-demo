import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { readFgbgUserConfig } from "../../config/index.js";
import { DEFAULT_SESSION_KEY, runWithSingleFlight } from "../../agent/run.js";
import {
  loadWeixinAccounts,
  updateWeixinBotBuf,
  type WeixinBoundBot,
} from "./weixin-account.js";
import { ilinkGetUpdates, ilinkSendText } from "./weixin-ilink.js";
import { loadLastIMTarget, saveLastIMTarget } from "../im/im-target.js";

const log = getSubsystemConsoleLogger("weixin-layer");

const POLL_MS = 35_000;
const IDLE_MS = 5000;
const SESSION_ERR = -14;

/** key = identify:peer -> context_token */
const contextByPeer = new Map<string, string>();
const pauseUntilByIdentify = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function peerKey(identify: string, peer: string): string {
  return `${identify}:${peer}`;
}

function resolveAgentId(primary: string, identify: string): string {
  if (primary && primary === identify) return DEFAULT_SESSION_KEY;
  return `weixin:${identify}`;
}

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

export function clearWeixinContextCache(): void {
  contextByPeer.clear();
}

/**
 * 向最近一次触达的微信用户发送单向消息。
 * 用户 ID 从持久化文件读取，不由调用方传入。
 */
export async function sendWeixinDirectMessage(
  content: string,
): Promise<boolean> {
  const text = content.trim();
  if (!text) return false;
  const toUserId = loadLastIMTarget("weixin");
  if (!toUserId) {
    log.error("sendWeixinDirectMessage failed: weixin target user missing");
    return false;
  }
  const store = loadWeixinAccounts();
  const identify = store.primary || store.bots[0]?.identify || "";
  if (!identify) {
    log.error("sendWeixinDirectMessage failed: weixin bot missing");
    return false;
  }
  const bot = store.bots.find((b) => b.identify === identify);
  if (!bot) {
    log.error("sendWeixinDirectMessage failed: weixin primary bot missing");
    return false;
  }
  try {
    await ilinkSendText({
      baseUrl: bot.baseUrl,
      token: bot.token,
      toUserId,
      text,
      contextToken: contextByPeer.get(peerKey(bot.identify, toUserId)),
    });
    return true;
  } catch (e) {
    log.error(
      `sendWeixinDirectMessage failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

async function runOneBotInbound(
  bot: WeixinBoundBot,
  primary: string,
  signal: AbortSignal,
): Promise<void> {
  const pauseUntil = pauseUntilByIdentify.get(bot.identify) ?? 0;
  if (Date.now() < pauseUntil) return;

  const resp = await ilinkGetUpdates({
    baseUrl: bot.baseUrl,
    token: bot.token,
    getUpdatesBuf: bot.updateBuf ?? "",
    timeoutMs: POLL_MS,
  });

  log.debug(`weixin getupdates resp: ${JSON.stringify(resp)}`);

  const bad =
    (resp.ret !== undefined && resp.ret !== 0) ||
    (resp.errcode !== undefined && resp.errcode !== 0);
  if (bad) {
    if (resp.errcode === SESSION_ERR || resp.ret === SESSION_ERR) {
      log.warn(
        `微信会话过期 identify=${bot.identify}，暂停 1 小时（需重新扫码绑定）`,
      );
      pauseUntilByIdentify.set(bot.identify, Date.now() + 60 * 60_000);
    }
    return;
  }

  if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
    updateWeixinBotBuf(bot.identify, resp.get_updates_buf);
  }

  const msgs = (resp.msgs ?? []) as Record<string, unknown>[];
  for (const full of msgs) {
    if (signal.aborted) return;

    const from = String(full.from_user_id ?? "").trim();
    if (!from) continue;
    saveLastIMTarget("weixin", from);
    if (full.group_id != null && String(full.group_id).trim() !== "") continue;

    const key = peerKey(bot.identify, from);
    const ctx = String(full.context_token ?? "").trim();
    if (ctx) contextByPeer.set(key, ctx);
    const token = contextByPeer.get(key);

    const mt = Number(full.message_type);
    if (mt !== 1) {
      try {
        await ilinkSendText({
          baseUrl: bot.baseUrl,
          token: bot.token,
          toUserId: from,
          text: "暂不支持处理非文本消息，请发送文字内容",
          contextToken: token,
        });
      } catch (e) {
        log.warn(
          `微信非文本消息提示发送失败 identify=${bot.identify}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      continue;
    }

    const text = extractUserText(full);
    if (!text) continue;

    const result = await runWithSingleFlight({
      message: text,
      channel: "weixin",
      identify: bot.identify,
      agentId: resolveAgentId(primary, bot.identify),
      onEvent: () => {},
      onBusy: async () => {
        await ilinkSendText({
          baseUrl: bot.baseUrl,
          token: bot.token,
          toUserId: from,
          text: "正在处理上一条消息，请稍候",
          contextToken: token,
        });
      },
      onAccepted: async () => {
        try {
          await ilinkSendText({
            baseUrl: bot.baseUrl,
            token: bot.token,
            toUserId: from,
            text: "收到指令",
            contextToken: contextByPeer.get(key) ?? token,
          });
        } catch (e) {
          log.warn(
            `微信「收到指令」回执发送失败 identify=${bot.identify}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      },
    });

    if (result.status !== "completed") continue;
    const out = (result.finalText ?? "").trim() || "好的";
    await ilinkSendText({
      baseUrl: bot.baseUrl,
      token: bot.token,
      toUserId: from,
      text: out,
      contextToken: contextByPeer.get(key) ?? token,
    });
  }
}

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
      await Promise.all(
        store.bots.map((bot) => runOneBotInbound(bot, store.primary, signal)),
      );
    } catch (e) {
      log.error(
        `weixin 轮询异常: ${e instanceof Error ? e.message : String(e)}`,
      );
      await sleep(3000);
    }
  }
}

let abortCtl: AbortController | null = null;

export function startWeixinLayer(): void {
  if (abortCtl) return;
  abortCtl = new AbortController();
  void runWeixinInboundLoop(abortCtl.signal).catch((e) =>
    log.error(`weixin loop 退出: ${e}`),
  );
  log.info("weixin-layer 已启动（长轮询）");
}
