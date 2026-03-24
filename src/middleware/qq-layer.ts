import WebSocket, { type RawData } from "ws";
import { getSubsystemConsoleLogger } from "../logger/logger.js";
import { runWithSingleFlight } from "../agent/run.js";
import { resolveQQAccountFromConfig } from "./qq-config.js";

// 获取 QQ 层专用的日志记录器
const qqLogger = getSubsystemConsoleLogger("qq-layer");

// QQ 机器人 API 相关的常量
const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken"; // 获取访问令牌的接口地址
const API_BASE = "https://api.sgroup.qq.com"; // QQ 机器人 API 的基础地址

/**
 * QQ 访问令牌响应类型
 * @property access_token - 访问令牌
 * @property expires_in - 令牌过期时间（秒）
 */
type QQTokenResponse = { access_token?: string; expires_in?: number };

/**
 * QQ 网关响应类型
 * @property url - 网关连接地址
 */
type QQGatewayResponse = { url: string };

/**
 * QQ WebSocket 消息负载类型
 * @property op - 操作码，用于区分消息类型
 * @property d - 消息数据
 * @property s - 消息序列号
 * @property t - 事件类型
 */
type QQWSPayload = {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
};

/**
 * QQ 私聊事件类型
 * @property id - 消息 ID
 * @property timestamp - 消息时间戳
 * @property content - 消息内容
 * @property author - 消息发送者信息
 * @property author.user_openid - 发送者的 openid
 */
type QQC2CEvent = {
  id: string;
  timestamp: string;
  content: string;
  author: {
    user_openid: string;
  };
};

// 访问令牌缓存
let tokenCache: { token: string; expiresAt: number } | null = null;

/**
 * 生成随机消息序列号
 * @returns 0-65535 之间的随机整数
 */
function nextMsgSeq(): number {
  return Math.floor(Math.random() * 65535);
}

/**
 * 获取 QQ 机器人访问令牌
 * @param appId - 应用 ID
 * @param secret - 应用密钥
 * @returns 访问令牌字符串
 * @description 该函数会缓存令牌，避免频繁请求，在令牌过期前 60 秒会自动刷新
 */
async function getAccessToken(appId: string, secret: string): Promise<string> {
  // 检查缓存的令牌是否有效（过期前 60 秒内刷新）
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  // 发起请求获取新的访问令牌
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret: secret }),
  });
  const data = (await response.json()) as QQTokenResponse;

  // 检查响应是否成功
  if (!response.ok || !data.access_token) {
    throw new Error(`获取 QQ access_token 失败: ${JSON.stringify(data)}`);
  }

  // 计算令牌过期时间并更新缓存
  const expiresIn = Number(data.expires_in ?? 7200);
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return data.access_token;
}

/**
 * 获取 QQ 网关连接地址
 * @param accessToken - 访问令牌
 * @returns 网关连接地址
 */
async function getGatewayUrl(accessToken: string): Promise<string> {
  const response = await fetch(`${API_BASE}/gateway`, {
    headers: { Authorization: `QQBot ${accessToken}` },
  });
  const data = (await response.json()) as QQGatewayResponse;

  if (!response.ok || !data.url) {
    throw new Error(`获取 QQ gateway 失败: ${JSON.stringify(data)}`);
  }

  return data.url;
}

/**
 * 发送私聊消息
 * @param params - 发送消息的参数
 * @param params.accessToken - 访问令牌
 * @param params.openid - 接收方的 openid
 * @param params.content - 消息内容
 * @param params.replyToMessageId - 回复的消息 ID（可选）
 */
async function sendC2CMessage(params: {
  accessToken: string;
  openid: string;
  content: string;
  replyToMessageId?: string;
}): Promise<void> {
  const { accessToken, openid, content, replyToMessageId } = params;
  await fetch(`${API_BASE}/v2/users/${openid}/messages`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      msg_type: 0, // 0 表示文本消息
      msg_seq: nextMsgSeq(), // 消息序列号
      ...(replyToMessageId ? { msg_id: replyToMessageId } : {}), // 回复消息时添加引用 ID
    }),
  });
}

/**
 * 解析 QQ 私聊事件
 * @param payload - WebSocket 消息负载
 * @returns 解析后的私聊事件，失败返回 null
 */
function parseC2CEvent(payload: QQWSPayload): QQC2CEvent | null {
  // 检查是否是私聊消息事件
  if (payload.op !== 0 || payload.t !== "C2C_MESSAGE_CREATE") return null;

  const data = payload.d as QQC2CEvent | undefined;

  // 验证事件数据的完整性
  if (!data?.author?.user_openid || typeof data.content !== "string") return null;

  return data;
}

/**
 * 启动 QQ 层服务
 * @description 该函数会初始化 QQ 机器人连接，处理消息接收和发送
 */
export async function startQQLayer(): Promise<void> {
  // 从配置中解析 QQ 账号信息
  const account = resolveQQAccountFromConfig();
  if (!account) {
    qqLogger.info(
      "未配置 QQ 账号（fgbg.json channels.qqbot 或 QQBOT_APP_ID/QQBOT_SECRET），跳过 qq-layer 启动",
    );
    return;
  }

  const appId = account.appId;
  const secret = account.clientSecret;
  qqLogger.info(
    `qq-layer 使用账号 ${account.accountId}（来源: ${account.source === "fgbg-config" ? "fgbg.json" : "env"}）`,
  );

  let heartbeatTimer: NodeJS.Timeout | null = null; // 心跳定时器
  let lastSeq: number | null = null; // 最后一条消息的序列号

  /**
   * 建立与 QQ 网关的连接
   * @description 包含连接建立、消息处理、心跳保持和重连逻辑
   */
  const connect = async () => {
    try {
      const accessToken = await getAccessToken(appId, secret);
      const gatewayUrl = await getGatewayUrl(accessToken);
      const ws = new WebSocket(gatewayUrl);
      qqLogger.info("qq-layer 已连接 QQ Gateway");

      // 处理 WebSocket 消息
      ws.on("message", async (raw: RawData) => {
        const payload = JSON.parse(raw.toString()) as QQWSPayload;
        if (typeof payload.s === "number") lastSeq = payload.s;

        // 处理心跳和连接初始化
        if (payload.op === 10) {
          const heartbeatInterval = Number(
            (payload.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 30000,
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
        const inboundMessageId = c2cEvent.id;
        const inboundText = c2cEvent.content.trim();
        if (!inboundText) return;

        // 处理接收到的消息
        const currentToken = await getAccessToken(appId, secret);
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
      qqLogger.error(`qq-layer 启动失败: ${message}`);
      setTimeout(() => {
        void connect();
      }, 5000);
    }
  };

  await connect();
}
