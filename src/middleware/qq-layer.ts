import WebSocket, { type RawData } from "ws";
import { getSubsystemConsoleLogger } from "../logger/logger.js";
import { runWithSingleFlight } from "../agent/run.js";
import { resolveQQAccountFromConfig } from "./qq-config.js";

const qqLogger = getSubsystemConsoleLogger("qq-layer");

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const API_BASE = "https://api.sgroup.qq.com";

type QQTokenResponse = { access_token?: string; expires_in?: number };
type QQGatewayResponse = { url: string };

type QQWSPayload = {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
};

type QQC2CEvent = {
  id: string;
  timestamp: string;
  content: string;
  author: {
    user_openid: string;
  };
};

let tokenCache: { token: string; expiresAt: number } | null = null;

function nextMsgSeq(): number {
  return Math.floor(Math.random() * 65535);
}

async function getAccessToken(appId: string, secret: string): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret: secret }),
  });
  const data = (await response.json()) as QQTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(`获取 QQ access_token 失败: ${JSON.stringify(data)}`);
  }

  const expiresIn = Number(data.expires_in ?? 7200);
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return data.access_token;
}

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
      msg_type: 0,
      msg_seq: nextMsgSeq(),
      ...(replyToMessageId ? { msg_id: replyToMessageId } : {}),
    }),
  });
}

function parseC2CEvent(payload: QQWSPayload): QQC2CEvent | null {
  if (payload.op !== 0 || payload.t !== "C2C_MESSAGE_CREATE") return null;
  const data = payload.d as QQC2CEvent | undefined;
  if (!data?.author?.user_openid || typeof data.content !== "string") return null;
  return data;
}

export async function startQQLayer(): Promise<void> {
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

  let heartbeatTimer: NodeJS.Timeout | null = null;
  let lastSeq: number | null = null;

  const connect = async () => {
    try {
      const accessToken = await getAccessToken(appId, secret);
      const gatewayUrl = await getGatewayUrl(accessToken);
      const ws = new WebSocket(gatewayUrl);
      qqLogger.info("qq-layer 已连接 QQ Gateway");

      ws.on("message", async (raw: RawData) => {
        const payload = JSON.parse(raw.toString()) as QQWSPayload;
        if (typeof payload.s === "number") lastSeq = payload.s;

        if (payload.op === 10) {
          const heartbeatInterval = Number(
            (payload.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 30000,
          );
          ws.send(
            JSON.stringify({
              op: 2,
              d: {
                token: `QQBot ${accessToken}`,
                intents: (1 << 30) | (1 << 12) | (1 << 25),
                shard: [0, 1],
              },
            }),
          );
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
        const inboundMessageId = c2cEvent.id;
        const inboundText = c2cEvent.content.trim();
        if (!inboundText) return;

        const currentToken = await getAccessToken(appId, secret);
        await runWithSingleFlight({
          message: inboundText,
          channel: "qq",
          onEvent: () => {
            // qq-layer 当前使用最终回包模式，不转发中间流式事件
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
              content: "收到，正在处理指令",
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
        qqLogger.warn("QQ Gateway 连接断开，5 秒后重连");
        setTimeout(() => {
          void connect();
        }, 5000);
      });

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
