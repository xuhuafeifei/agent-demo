import WebSocket, { type RawData } from "ws";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { runWithSingleFlight } from "../../agent/run.js";
import { resolveQQAccountFromConfig } from "./qq-config.js";
import { getEventBus, TOPIC_TOOL_BEFORE_BUILD } from "../../event-bus/index.js";
import { getUserFgbgConfig, writeFgbgUserConfig } from "../../utils/app-path.js";
import { createQQSendTool } from "../../agent/tool/qq-send.js";
import { getAccessToken, getGatewayUrl, sendC2CMessage } from "./qq-api.js";
import { parseC2CEvent, type QQWSPayload } from "./qq-utils.js";

// 获取 QQ 层专用的日志记录器
const qqLogger = getSubsystemConsoleLogger("qq-layer");
const eventBus = getEventBus();

let qqReady = false;
let activeAccessToken = "";
let lastSeenUserOpenid = "";
let reconnectFn: (() => Promise<void>) | null = null;
let isConnecting = false;

function persistTargetOpenidIfMissing(openid: string): void {
  const value = openid.trim();
  if (!value) return;
  const cfg = getUserFgbgConfig();
  const current = cfg.channels?.qqbot?.targetOpenid?.trim();
  if (current) return;

  const qqbot = cfg.channels?.qqbot;
  if (!qqbot) return;
  if (qqbot.enabled === false) return;

  const nextCfg = {
    ...cfg,
    channels: {
      ...(cfg.channels ?? {}),
      qqbot: {
        ...qqbot,
        targetOpenid: value,
      },
    },
  };
  writeFgbgUserConfig(nextCfg);
  qqLogger.info("已自动写入 channels.qqbot.targetOpenid");
}

eventBus.on<unknown[]>(TOPIC_TOOL_BEFORE_BUILD, (dynamicTools) => {
  if (!Array.isArray(dynamicTools) || !qqReady) return;
  qqLogger.info("qq dynamic tool created!");
  dynamicTools.push(
    createQQSendTool({
      resolveLastSeenOpenid: () => getLastSeenQQOpenid(),
      sendQQDirectMessage,
    }),
  );
});

export function isQQReady(): boolean {
  return qqReady;
}

export function getLastSeenQQOpenid(): string {
  return lastSeenUserOpenid;
}

async function ensureQQGatewayReady(timeoutMs: number = 7000): Promise<boolean> {
  if (qqReady && activeAccessToken) return true;

  if (reconnectFn && !isConnecting) {
    void reconnectFn();
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (qqReady && activeAccessToken) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return qqReady && activeAccessToken ? true : false;
}

/**
 * qq-gateway准备好后，发送单向消息到目标用户
 * @param openid 目标 openid
 * @param content 消息内容
 * @returns 是否发送成功
 */
export async function sendQQDirectMessage(
  openid: string,
  content: string,
): Promise<boolean> {
  const ready = await ensureQQGatewayReady(7000);
  if (!ready) {
    qqLogger.error(
      "sendQQDirectMessage failed: QQ gateway unavailable within 7s",
    );
    return false;
  }
  try {
    await sendC2CMessage({
      accessToken: activeAccessToken,
      openid,
      content,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 启动 QQ 层服务
 * @description 该函数会初始化 QQ 机器人连接，处理消息接收和发送
 */
export async function startQQLayer(): Promise<void> {
  // 显式开关：enabled=false 时绝不进入后续流程
  const enabled = getUserFgbgConfig().channels?.qqbot?.enabled;
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
  qqLogger.info(
    `qq-layer 使用账号 ${account.accountId}（来源: ${account.source}）`,
  );

  let heartbeatTimer: NodeJS.Timeout | null = null; // 心跳定时器
  let lastSeq: number | null = null; // 最后一条消息的序列号

  /**
   * 建立与 QQ 网关的连接
   * @description 包含连接建立、消息处理、心跳保持和重连逻辑
   */
  const connect = async () => {
    if (isConnecting) return;
    isConnecting = true;
    try {
      const accessToken = await getAccessToken(appId, secret);
      activeAccessToken = accessToken;
      const gatewayUrl = await getGatewayUrl(accessToken);
      const ws = new WebSocket(gatewayUrl);
      qqLogger.info("qq-layer 已连接 QQ Gateway");
      qqReady = true;
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
        lastSeenUserOpenid = userOpenId;
        // 持久化目标 openid
        persistTargetOpenidIfMissing(userOpenId);
        const inboundMessageId = c2cEvent.id;
        const inboundText = c2cEvent.content.trim();
        if (!inboundText) return;

        // 处理接收到的消息
        const currentToken = await getAccessToken(appId, secret);
        // 核心请求
        await runWithSingleFlight({
          message: inboundText,
          channel: "qq",
          onEvent: () => {
            // qq-layer 当前使用最终回包模式，不转发中间流式事件
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
        qqReady = false;
        activeAccessToken = "";
        eventBus.emitSync("qq:offline", { accountId: account.accountId });
        qqLogger.warn("QQ Gateway 连接断开，5 秒后重连");
        setTimeout(() => {
          void connect();
        }, 5000);
      });

      // 处理连接错误
      ws.on("error", (error: Error) => {
        qqLogger.error(`QQ Gateway 错误: ${error.message}`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      qqReady = false;
      activeAccessToken = "";
      qqLogger.error(`qq-layer 启动失败: ${message}`);
      setTimeout(() => {
        void connect();
      }, 5000);
    } finally {
      isConnecting = false;
    }
  };

  reconnectFn = connect;
  await connect();
}
