import WebSocket, { type RawData } from "ws";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { DEFAULT_SESSION_KEY, runWithSingleFlight } from "../../agent/run.js";
import { resolveQQAccountFromConfig } from "./qq-config.js";
import { getEventBus, TOPIC_TOOL_BEFORE_BUILD } from "../../event-bus/index.js";
import { writeFgbgUserConfig } from "../../config/index.js";
import { createQQSendTool } from "../../agent/tool/func/qq-send.js";
import {
  getGatewayUrl,
  sendC2CMessage,
} from "./qq-api.js";
import {
  clearQQAccessTokenStatus,
  forceRefreshQQAccessToken,
  getLastSeenQQOpenidStatus,
  getQQAccessToken,
  getQQReconnectStatus,
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

// 获取 QQ 层专用的日志记录器
const qqLogger = getSubsystemConsoleLogger("qq-layer");
const eventBus = getEventBus();

/** 每次收到用户私聊事件时写入，覆盖原 `targetOpenid`（与旧「仅空时写入」不同） */
function persistTargetOpenid(openid: string): void {
  const value = openid.trim();
  if (!value) return;
  const cfg = readFgbgUserConfig();
  if (cfg.channels.qqbot.enabled === false) return;

  const current = cfg.channels.qqbot.targetOpenid?.trim();
  if (current === value) return;

  cfg.channels.qqbot.targetOpenid = value;
  writeFgbgUserConfig(cfg);
  qqLogger.info("已更新 channels.qqbot.targetOpenid, 覆盖为当前私聊用户");
}

eventBus.on<unknown[]>(TOPIC_TOOL_BEFORE_BUILD, (dynamicTools) => {
  if (!Array.isArray(dynamicTools) || !isQQReadyStatus()) return;
  qqLogger.info("qq dynamic tool created!");
  dynamicTools.push(
    createQQSendTool({
      sendQQDirectMessage,
    }),
  );
});

export function isQQReady(): boolean {
  return isQQReadyStatus();
}

export function getLastSeenQQOpenid(): string {
  return getLastSeenQQOpenidStatus();
}

async function ensureQQGatewayReady(
  timeoutMs: number = 7000,
): Promise<boolean> {
  const account = resolveQQAccountFromConfig();
  if (!account) return false;

  if (isQQReadyStatus() && (await getQQAccessToken(account.appId, account.clientSecret))) {
    return true;
  }

  const reconnectFn = getQQReconnectStatus();
  if (reconnectFn && !isQQConnectingStatus()) {
    void reconnectFn();
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isQQReadyStatus() && (await getQQAccessToken(account.appId, account.clientSecret))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return Boolean(
    isQQReadyStatus() &&
      (await getQQAccessToken(account.appId, account.clientSecret)),
  );
}

/**
 * qq-gateway 准备好后，向 fgbg.json 中 `channels.qqbot.targetOpenid` 对应用户发送单向消息。
 * openid 仅从用户配置文件读取，不由调用方传入。
 */
export async function sendQQDirectMessage(content: string): Promise<boolean> {
  const openid = readFgbgUserConfig().channels.qqbot.targetOpenid?.trim() || "";
  if (!openid) {
    qqLogger.error(
      "sendQQDirectMessage failed: channels.qqbot.targetOpenid missing in fgbg.json",
    );
    return false;
  }

  const ready = await ensureQQGatewayReady(7000);
  if (!ready) {
    qqLogger.error(
      "sendQQDirectMessage failed: QQ gateway unavailable within 7s",
    );
    return false;
  }
  try {
    const account = resolveQQAccountFromConfig();
    if (!account) {
      qqLogger.error("sendQQDirectMessage failed: QQ 账号配置缺失或未启用");
      return false;
    }
    // 发送前主动刷新 token（含缓存复用），避免使用过期的 activeAccessToken。
    const accessToken = await getQQAccessToken(account.appId, account.clientSecret);
    await sendC2CMessage({
      accessToken,
      openid,
      content,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // QQ 侧返回 11244：token not exist or expire，清缓存后重试一次。
    if (message.includes("11244") || message.includes("token not exist or expire")) {
      try {
        const account = resolveQQAccountFromConfig();
        if (!account) {
          qqLogger.error("sendQQDirectMessage retry failed: QQ 账号配置缺失或未启用");
          return false;
        }
        invalidateQQAccessTokenStatus("QQ API 返回 11244 / token expired");
        const retryToken = await forceRefreshQQAccessToken(
          account.appId,
          account.clientSecret,
        );
        await sendC2CMessage({
          accessToken: retryToken,
          openid,
          content,
        });
        qqLogger.warn("sendQQDirectMessage: token 失效，已刷新后重试成功");
        return true;
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : String(retryError);
        qqLogger.error(`sendQQDirectMessage retry failed: ${retryMessage}`);
        return false;
      }
    }
    qqLogger.error(`sendQQDirectMessage failed: ${message}`);
    return false;
  }
}

/**
 * 启动 QQ 层服务
 * @description 该函数会初始化 QQ 机器人连接，处理消息接收和发送
 */
export async function startQQLayer(): Promise<void> {
  // 显式开关：enabled=false 时绝不进入后续流程
  const enabled = readFgbgUserConfig().channels.qqbot.enabled;
  if (enabled === false) {
    qqLogger.info("fgbg.json.channels.qqbot.enabled=false，跳过 qq-layer 启动");
    return;
  }

  // 从配置中解析 QQ 账号信息
  const account = resolveQQAccountFromConfig();
  if (!account) {
    qqLogger.info(
      "未启用或未正确配置 fgbg.json.channels.qqbot，跳过 qq-layer 启动",
    );
    return;
  }

  const appId = account.appId;
  const secret = account.clientSecret;
  // qqLogger.info(
  //   `qq-layer 使用账号 ${account.accountId}（来源: ${account.source}）`,
  // );

  let heartbeatTimer: NodeJS.Timeout | null = null; // 心跳定时器
  let lastSeq: number | null = null; // 最后一条消息的序列号

  /**
   * 建立与 QQ 网关的连接
   * @description 包含连接建立、消息处理、心跳保持和重连逻辑
   */
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

      // 处理 WebSocket 消息
      ws.on("message", async (raw: RawData) => {
        const payload = JSON.parse(raw.toString()) as QQWSPayload;
        if (typeof payload.s === "number") lastSeq = payload.s;

        // 处理心跳和连接初始化
        if (payload.op === 10) {
          const heartbeatInterval = Number(
            (payload.d as { heartbeat_interval?: number })
              ?.heartbeat_interval ?? 30000,
          );

          // 发送身份验证
          ws.send(
            JSON.stringify({
              op: 2,
              d: {
                token: `QQBot ${accessToken}`,
                intents: (1 << 30) | (1 << 12) | (1 << 25), // 订阅的事件类型
                shard: [0, 1], // 分片信息
              },
            }),
          );

          // 设置心跳定时器
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 1, d: lastSeq }));
            }
          }, heartbeatInterval);
          return;
        }

        // 解析私聊事件
        const c2cEvent = parseC2CEvent(payload);
        if (!c2cEvent) return;

        const userOpenId = c2cEvent.author.user_openid;
        setLastSeenQQOpenidStatus(userOpenId);
        // 持久化目标 openid
        persistTargetOpenid(userOpenId);
        const inboundMessageId = c2cEvent.id;
        const inboundText = c2cEvent.content.trim();
        if (!inboundText) return;

        // 处理接收到的消息
        const currentToken = await getQQAccessToken(appId, secret);
        // 核心请求
        await runWithSingleFlight({
          message: inboundText,
          channel: "qq",
          onEvent: (event) => {
            // 监听 error 事件，向用户发送错误消息
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
            // 当系统繁忙时回复消息
            await sendC2CMessage({
              accessToken: currentToken,
              openid: userOpenId,
              content: "指令正在运行中，请稍后",
              replyToMessageId: inboundMessageId,
            });
          },
          onAccepted: async () => {
            // 当消息被接受时回复消息
            await sendC2CMessage({
              accessToken: currentToken,
              openid: userOpenId,
              content: "收到，正在处理指令",
              replyToMessageId: inboundMessageId,
            });
          },
          // agentId 与 sessionKey 一致，避免多个端（web/qq）并发读写session文件问题
          // 保证同一时间只有一个端在读写session文件
          agentId: DEFAULT_SESSION_KEY,
        }).then(async (result) => {
          // 处理指令执行结果
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

      // 处理连接关闭
      ws.on("close", () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        setQQReadyStatus(false);
        clearQQAccessTokenStatus();
        eventBus.emitSync("qq:offline", { accountId: account.accountId });
        const waitSecond = 1;
        qqLogger.warn(`QQ Gateway 连接断开，${waitSecond} 秒后重连`);
        setTimeout(() => {
          void connect();
        }, waitSecond * 1000);
      });

      // 处理连接错误
      ws.on("error", (error: Error) => {
        qqLogger.error(`QQ Gateway 错误: ${error.message}`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setQQReadyStatus(false);
      clearQQAccessTokenStatus();
      qqLogger.error(`qq-layer 启动失败: ${message}`);
      setTimeout(() => {
        void connect();
      }, 5000);
    } finally {
      setQQConnectingStatus(false);
    }
  };

  setQQReconnectStatus(connect);
  await connect();
}
