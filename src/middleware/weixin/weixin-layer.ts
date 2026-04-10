import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { readFgbgUserConfig } from "../../config/index.js";
import { DEFAULT_SESSION_KEY, runWithSingleFlight } from "../../agent/run.js";
import {
  loadWeixinAccount,
  clearWeixinAccount,
  loadSyncBuf,
  saveSyncBuf,
} from "./weixin-account.js";
import { ilinkGetUpdates, ilinkSendText } from "./weixin-ilink.js";
import { loadLastIMTarget, saveLastIMTarget } from "../im/im-target.js";

const log = getSubsystemConsoleLogger("weixin-layer");

const POLL_MS = 35_000;
const IDLE_MS = 5000;
const SESSION_ERR = -14;

/** 对端 userId -> 最近一次 context_token（回复必带） */
const contextByPeer = new Map<string, string>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
  const toUserId = loadLastIMTarget("weixin");
  if (!toUserId) {
    log.error("sendWeixinDirectMessage failed: weixin target user missing");
    return false;
  }
  const acc = loadWeixinAccount();
  if (!acc) {
    log.error("sendWeixinDirectMessage failed: weixin account not bound");
    return false;
  }
  try {
    await ilinkSendText({
      baseUrl: acc.baseUrl,
      token: acc.token,
      toUserId,
      text: content,
      contextToken: contextByPeer.get(toUserId),
    });
    return true;
  } catch (e) {
    log.error(
      `sendWeixinDirectMessage failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

export async function runWeixinInboundLoop(signal: AbortSignal): Promise<void> {
  let buf = loadSyncBuf(); // 加载上次轮询的同步缓冲区，用于续传
  let pauseUntil = 0; // 暂停轮询的时间戳，用于会话过期等场景

  // 主轮询循环，直到收到终止信号
  while (!signal.aborted) {
    const cfg = readFgbgUserConfig();
    // 检查微信渠道是否已启用
    if (!cfg.channels.weixin?.enabled) {
      await sleep(IDLE_MS);
      continue;
    }

    // 检查微信账号是否已绑定（已扫码登录）
    const acc = loadWeixinAccount();
    if (!acc) {
      await sleep(IDLE_MS);
      continue;
    }

    // 检查是否需要暂停轮询（如会话过期）
    if (Date.now() < pauseUntil) {
      await sleep(Math.min(IDLE_MS, pauseUntil - Date.now()));
      continue;
    }

    try {
      // 调用微信 iLink API 轮询获取消息
      const resp = await ilinkGetUpdates({
        baseUrl: acc.baseUrl,
        token: acc.token,
        getUpdatesBuf: buf,
        timeoutMs: POLL_MS,
      });

      // 检查响应是否包含错误
      const bad =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);
      if (bad) {
        // 处理会话过期错误（错误码 -14）
        if (resp.errcode === SESSION_ERR || resp.ret === SESSION_ERR) {
          log.warn("微信会话过期，暂停 1 小时（需重新扫码绑定）");
          clearWeixinAccount(); // 清除已绑定的微信账号信息
          // todo: 有个问题，如果我后续接入多个用户，这种清除方式会否导致别的用户不可使用
          clearWeixinContextCache(); // 清除上下文缓存
          buf = "";
          pauseUntil = Date.now() + 60 * 60_000; // 暂停轮询 1 小时
        }
        await sleep(2000);
        continue;
      }

      log.debug(`weixin getupdates resp: ${JSON.stringify(resp)}`);

      // 更新同步缓冲区，用于下次轮询续传
      if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
        buf = resp.get_updates_buf;
        saveSyncBuf(buf);
      }

      // 处理收到的消息
      const msgs = (resp.msgs ?? []) as Record<string, unknown>[];
      for (const full of msgs) {
        if (signal.aborted) return; // 检查是否需要终止处理

        const mt = Number(full.message_type);
        if (mt !== 1) {
          // 处理非文本消息，发送暂不支持的提示
          const from = String(full.from_user_id ?? "").trim();
          if (from) {
            saveLastIMTarget("weixin", from);
            const ctx = String(full.context_token ?? "").trim();
            if (ctx) contextByPeer.set(from, ctx);
            const token = contextByPeer.get(from);
            try {
              await ilinkSendText({
                baseUrl: acc.baseUrl,
                token: acc.token,
                toUserId: from,
                text: "暂不支持处理非文本消息，请发送文字内容",
                contextToken: token,
              });
            } catch (e) {
              log.warn(
                `微信非文本消息提示发送失败: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }
          continue;
        } // 只处理类型为 1 的消息（文本消息）

        const from = String(full.from_user_id ?? "").trim();
        if (!from) continue; // 忽略无发送者 ID 的消息

        saveLastIMTarget("weixin", from); // 保存最后一次触达的用户 ID

        if (full.group_id != null && String(full.group_id).trim() !== "")
          continue; // 忽略群消息

        // 提取消息中的文本内容
        const text = extractUserText(full);
        if (!text) continue; // 忽略空消息

        // 保存上下文 token（用于回复消息时保持会话上下文）
        const ctx = String(full.context_token ?? "").trim();
        if (ctx) contextByPeer.set(from, ctx);

        const token = contextByPeer.get(from);

        // 使用单飞模式处理用户消息，避免并发处理同一用户的多条消息
        const result = await runWithSingleFlight({
          message: text,
          channel: "weixin",
          agentId: DEFAULT_SESSION_KEY,
          onEvent: () => {},
          onBusy: async () => {
            // 当用户消息正在处理时，发送忙碌提示
            await ilinkSendText({
              baseUrl: acc.baseUrl,
              token: acc.token,
              toUserId: from,
              text: "正在处理上一条消息，请稍候",
              contextToken: token,
            });
          },
          onAccepted: async () => {
            // 当消息被接受处理时，发送收到指令提示
            try {
              await ilinkSendText({
                baseUrl: acc.baseUrl,
                token: acc.token,
                toUserId: from,
                text: "收到指令",
                contextToken: contextByPeer.get(from) ?? token,
              });
            } catch (e) {
              log.warn(
                `微信「收到指令」回执发送失败: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          },
        });

        if (result.status !== "completed") continue; // 忽略未完成的处理结果

        // 发送处理结果给用户
        const out = (result.finalText ?? "").trim() || "好的";
        await ilinkSendText({
          baseUrl: acc.baseUrl,
          token: acc.token,
          toUserId: from,
          text: out,
          contextToken: contextByPeer.get(from) ?? token,
        });
      }
    } catch (e) {
      // 处理轮询过程中的异常
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
