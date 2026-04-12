import WebSocket, { type RawData } from "ws";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { runWithSingleFlight } from "../../agent/run.js";
import { resolveQQAccountFromConfig } from "./qq-config.js";
import { getEventBus } from "../../event-bus/index.js";
import { getGatewayUrl, sendC2CMessage } from "./qq-api.js";
import {
  clearQQAccessTokenStatus,
  forceRefreshQQAccessToken,
  getLastSeenQQOpenidStatus,
  getQQAccessToken,
  invalidateQQAccessTokenStatus,
  isQQConnectingStatus,
  isQQReadyStatus,
  setLastSeenQQOpenidStatus,
  setQQConnectingStatus,
  setQQReadyStatus,
  setQQReconnectStatus,
} from "./qq-status.js";
import { parseC2CEvent, type QQWSPayload } from "./qq-utils.js";
import { readFgbgUserConfig } from "../../config/index.js";
import {
  getPrimaryQQBot,
  getQQBotByTenantId,
  QQ_DEFAULT_TENANT_ID,
  setQQBotTargetOpenIdByAppId,
} from "./qq-account.js";

const qqLogger = getSubsystemConsoleLogger("qq-layer");
const eventBus = getEventBus();

/** 收到私聊时按当前机器人 appId 写入 ~/.fgbg/qq/accounts.json */
function persistTargetOpenid(openid: string): void {
  const value = openid.trim();
  if (!value) return;
  const account = resolveQQAccountFromConfig();
  if (!account) return;
  setQQBotTargetOpenIdByAppId(account.appId, value);
  qqLogger.info("已更新 QQ 私聊目标 (qq/accounts.json)");
}

export function isQQReady(): boolean {
  return isQQReadyStatus();
}

export function getLastSeenQQOpenid(): string {
  return getLastSeenQQOpenidStatus();
}

async function waitForQQAccessToken(
  appId: string,
  clientSecret: string,
  timeoutMs = 7000,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await getQQAccessToken(appId, clientSecret)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return Boolean(await getQQAccessToken(appId, clientSecret));
}

/**
 * 向指定 tenantId 的 QQ bot 发私聊消息。
 * 从 accounts.json 中按 tenantId 查找 bot 账号；找不到时尝试 primary bot。
 */
export async function sendQQDirectMessage(
  content: string,
  tenantId: string = QQ_DEFAULT_TENANT_ID,
): Promise<boolean> {
  if (!readFgbgUserConfig().channels.qqbot.enabled) {
    qqLogger.error("sendQQDirectMessage failed: qqbot channel disabled");
    return false;
  }
  const bot = getQQBotByTenantId(tenantId) ?? getPrimaryQQBot();
  if (!bot?.appId?.trim() || !bot.clientSecret?.trim()) {
    qqLogger.error(`sendQQDirectMessage failed: no bot for tenantId=${tenantId}`);
    return false;
  }
  const openid = bot.targetOpenId?.trim() ?? "";
  if (!openid) {
    qqLogger.error(`sendQQDirectMessage failed: targetOpenId empty for tenantId=${tenantId}`);
    return false;
  }
  const ready = await waitForQQAccessToken(bot.appId, bot.clientSecret, 7000);
  if (!ready) {
    qqLogger.error("sendQQDirectMessage failed: access token unavailable");
    return false;
  }
  try {
    const accessToken = await getQQAccessToken(bot.appId, bot.clientSecret);
    await sendC2CMessage({ accessToken, openid, content });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("11244") || message.includes("token not exist or expire")) {
      try {
        invalidateQQAccessTokenStatus("QQ API 11244 (tenantId send)");
        const retryToken = await forceRefreshQQAccessToken(bot.appId, bot.clientSecret);
        await sendC2CMessage({ accessToken: retryToken, openid, content });
        qqLogger.warn("sendQQDirectMessage: token refreshed after 11244");
        return true;
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
        qqLogger.error(`sendQQDirectMessage retry failed: ${retryMessage}`);
        return false;
      }
    }
    qqLogger.error(`sendQQDirectMessage failed: ${message}`);
    return false;
  }
}

/**
 * 启动 QQ 层服务：初始化 QQ 机器人连接，处理消息接收和发送
 */
export async function startQQLayer(): Promise<void> {
  const enabled = readFgbgUserConfig().channels.qqbot.enabled;
  if (enabled === false) {
    qqLogger.info("fgbg.json.channels.qqbot.enabled=false，跳过 qq-layer 启动");
    return;
  }

  const account = resolveQQAccountFromConfig();
  if (!account) {
    qqLogger.info("未启用或未正确配置 fgbg.json.channels.qqbot，跳过 qq-layer 启动");
    return;
  }

  const appId = account.appId;
  const secret = account.clientSecret;

  let heartbeatTimer: NodeJS.Timeout | null = null;
  let lastSeq: number | null = null;

  const connect = async () => {
    if (isQQConnectingStatus()) return;
    setQQConnectingStatus(true);
    try {
      const accessToken = await getQQAccessToken(appId, secret);
      const gatewayUrl = await getGatewayUrl(accessToken);
      const ws = new WebSocket(gatewayUrl);
      qqLogger.info("qq-layer 已连接 QQ Gateway");
      setQQReadyStatus(true);
      eventBus.emitSync("qq:ready", { accountId: account.accountId });

      ws.on("message", async (raw: RawData) => {
        const payload = JSON.parse(raw.toString()) as QQWSPayload;
        if (typeof payload.s === "number") lastSeq = payload.s;

        if (payload.op === 10) {
          const heartbeatInterval = Number(
            (payload.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 30000,
          );
          ws.send(JSON.stringify({
            op: 2,
            d: {
              token: `QQBot ${accessToken}`,
              intents: (1 << 30) | (1 << 12) | (1 << 25),
              shard: [0, 1],
            },
          }));
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 1, d: lastSeq }));
            }
          }, heartbeatInterval);
          return;
        }

        const c2cEvent = parseC2CEvent(payload);
        if (!c2cEvent) return;

        const userOpenId = c2cEvent.author.user_openid;
        setLastSeenQQOpenidStatus(userOpenId);
        persistTargetOpenid(userOpenId);
        const inboundMessageId = c2cEvent.id;
        const inboundText = c2cEvent.content.trim();
        if (!inboundText) return;

        const currentToken = await getQQAccessToken(appId, secret);
        // 使用 primary bot 的 tenantId 作为该次请求的租户上下文
        const tenantId = getPrimaryQQBot()?.tenantId?.trim() || QQ_DEFAULT_TENANT_ID;

        await runWithSingleFlight({
          message: inboundText,
          channel: "qq",
          tenantId,
          module: "main",
          sessionKey: `session:main:${tenantId}`,
          onEvent: (event) => {
            if (event.type === "error" && event.error) {
              qqLogger.error(`QQ 消息处理错误: ${event.error}`);
              void sendC2CMessage({
                accessToken: currentToken,
                openid: userOpenId,
                content: `处理指令时发生错误: ${event.error}`,
                replyToMessageId: inboundMessageId,
              });
            }
          },
          onBusy: async () => {
            await sendC2CMessage({
              accessToken: currentToken,
              openid: userOpenId,
              content: "指令正在运行中，请稍后",
              replyToMessageId: inboundMessageId,
            });
          },
          onAccepted: async () => {
            await sendC2CMessage({
              accessToken: currentToken,
              openid: userOpenId,
              content: "收到指令",
              replyToMessageId: inboundMessageId,
            });
          },
        }).then(async (result) => {
          if (result.status !== "completed") return;
          const finalText = result.finalText?.trim() || "已处理完成";
          await sendC2CMessage({
            accessToken: currentToken,
            openid: userOpenId,
            content: finalText,
            replyToMessageId: inboundMessageId,
          });
        });
      });

      ws.on("close", () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        setQQReadyStatus(false);
        clearQQAccessTokenStatus();
        eventBus.emitSync("qq:offline", { accountId: account.accountId });
        qqLogger.warn("QQ Gateway 连接断开，1 秒后重连");
        setTimeout(() => { void connect(); }, 1000);
      });

      ws.on("error", (error: Error) => {
        qqLogger.error(`QQ Gateway 错误: ${error.message}`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setQQReadyStatus(false);
      clearQQAccessTokenStatus();
      qqLogger.error(`qq-layer 启动失败: ${message}`);
      setTimeout(() => { void connect(); }, 5000);
    } finally {
      setQQConnectingStatus(false);
    }
  };

  setQQReconnectStatus(connect);
  await connect();
}
