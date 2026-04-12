import WebSocket, { type RawData } from "ws";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { runWithSingleFlight } from "../../agent/run.js";
import { resolveQQAccountFromConfig } from "./qq-config.js";
import { getEventBus } from "../../event-bus/index.js";
import { getGatewayUrl, sendC2CMessage } from "./qq-api.js";
import {
  applyQQLayerStoppedStatus,
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

/** 用户关闭或未启用时置位；重连 setTimeout 回调里先看此标志再决定是否 connect */
let qqIntentionalStop = false;
/** 当前 Gateway 连接：stopQQLayer 在 connect 闭包外执行，须保留引用才能 ws.close() */
let qqGatewayWs: WebSocket | null = null;
let qqHeartbeatTimer: NodeJS.Timeout | null = null;

/**
 * 主动断开 QQ Gateway；关闭完成后由 applyQQLayerStoppedStatus 写回 qq-status。
 */
export function stopQQLayer(): void {
  qqIntentionalStop = true;
  if (qqHeartbeatTimer) {
    clearInterval(qqHeartbeatTimer);
    qqHeartbeatTimer = null;
  }
  if (qqGatewayWs) {
    try {
      qqGatewayWs.removeAllListeners();
      qqGatewayWs.close();
    } catch {
      /* ignore */
    }
    qqGatewayWs = null;
  }
  applyQQLayerStoppedStatus();
}

/**
 * 配置为启用且 qq-status 显示未在跑（非 ready、非 connecting）时再 startQQLayer。
 */
export async function maybeStartQQLayerIfEnabledAndIdle(): Promise<void> {
  if (!readFgbgUserConfig().channels.qqbot.enabled) return;
  if (isQQReadyStatus() || isQQConnectingStatus()) return;
  qqIntentionalStop = false;
  await startQQLayer();
}

/**
 * 收到私聊时按当前机器人 appId 写入 ~/.fgbg/qq/accounts.json
 *
 * 作用：当用户主动给机器人发私聊消息时，系统会记住该用户的 openid，
 * 后续机器人回复时就知道要发给谁。这个函数将 openid 持久化到本地配置文件中。
 */
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

/**
 * 等待 QQ access_token 可用。
 *
 * 轮询检查 access_token 是否已获取成功，最长等待 timeoutMs 毫秒。
 * 因为 token 可能需要异步刷新（比如首次启动或过期后），
 * 这里用短间隔轮询代替复杂的回调机制。
 */
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
 *
 * tenantId 查找逻辑：
 * 1. 从 accounts.json 中按 tenantId 查找对应的 bot 账号配置
 * 2. 如果找不到，则尝试使用 primary bot（主机器人）
 * 3. 从 bot 配置中获取 appId、clientSecret 和 targetOpenId（目标用户 openid）
 * 4. 确保 access_token 可用后调用 QQ API 发送 C2C 消息
 *
 * 错误处理：当 API 返回 11244（token 过期或无效）时，自动刷新 token 并重试一次。
 */
export async function sendQQDirectMessage(
  content: string,
  tenantId: string = QQ_DEFAULT_TENANT_ID,
): Promise<boolean> {
  // 检查 qqbot 频道是否启用
  if (!readFgbgUserConfig().channels.qqbot.enabled) {
    qqLogger.error("sendQQDirectMessage failed: qqbot channel disabled");
    return false;
  }
  // 按 tenantId 查找 bot 配置；tenantId 是多租户隔离的关键字段，
  // 不同租户可以配置不同的 QQ 机器人账号
  const bot = getQQBotByTenantId(tenantId) ?? getPrimaryQQBot();
  if (!bot?.appId?.trim() || !bot.clientSecret?.trim()) {
    qqLogger.error(`sendQQDirectMessage failed: no bot for tenantId=${tenantId}`);
    return false;
  }
  // targetOpenId 是机器人要发送消息的目标用户标识，
  // 由用户主动给机器人发私聊时通过 persistTargetOpenid 写入
  const openid = bot.targetOpenId?.trim() ?? "";
  if (!openid) {
    qqLogger.error(`sendQQDirectMessage failed: targetOpenId empty for tenantId=${tenantId}`);
    return false;
  }
  // 等待 token 就绪（可能需要异步刷新）
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
    // 错误码 11244 表示 token 过期或无效，需要刷新后重试
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
 * 启动 QQ 层服务：初始化 QQ 机器人 WebSocket 连接，处理消息接收和发送。
 *
 * 核心流程：
 * 1. 检查配置是否启用 qqbot，从 accounts.json 读取 bot 账号信息（appId、clientSecret）
 * 2. 获取 access_token，通过 QQ API 拿到 WebSocket 网关地址
 * 3. 建立 WebSocket 连接，接收 Gateway Hello（op=10）后发送 Identify（op=2）认证
 * 4. 启动心跳定时器，按 Gateway 返回的 heartbeat_interval 定期发送 Ping（op=1）
 * 5. 收到 C2C 私聊消息时，解析出用户 openid 和消息内容
 * 6. 使用 primary bot 的 tenantId 调用 runWithSingleFlight 处理 AI 对话
 * 7. 根据 runWithSingleFlight 的事件回调（onAccepted/onBusy/onError/completed）
 *    向用户发送对应的 QQ 消息回复
 *
 * 断线重连：ws.on("close") 和 catch 块中都会 setTimeout 重新调用 connect()，
 * 实现自动重连。heartbeatTimer 会在断线时清理，重连时重新创建。
 */
export async function startQQLayer(): Promise<void> {
  const enabled = readFgbgUserConfig().channels.qqbot.enabled;
  if (enabled === false) {
    qqLogger.info("fgbg.json.channels.qqbot.enabled=false，跳过 qq-layer 启动");
    return;
  }

  // 从本地配置文件 (~/.fgbg/qq/accounts.json 或 fgbg.json) 解析当前启用的 QQ 账号
  // 返回的 account 包含 appId、clientSecret、accountId 等关键信息
  const account = resolveQQAccountFromConfig();
  if (!account) {
    qqLogger.info("未启用或未正确配置 fgbg.json.channels.qqbot，跳过 qq-layer 启动");
    return;
  }

  const appId = account.appId;
  const secret = account.clientSecret;

  if (isQQReadyStatus() || isQQConnectingStatus()) return;

  qqIntentionalStop = false;

  // lastSeq: 记录最后一个事件序列号，心跳时传给 Gateway 用于事件确认
  let lastSeq: number | null = null;

  // connect 是实际建立 WebSocket 连接的函数，失败或断线时会重新调用
  const connect = async () => {
    if (qqIntentionalStop) return;
    // 防止重复连接：如果正在连接中则直接返回
    if (isQQConnectingStatus()) return;
    setQQConnectingStatus(true);
    try {
      // 第一步：获取 access_token，用于请求 Gateway URL 和后续 WebSocket 认证
      const accessToken = await getQQAccessToken(appId, secret);
      if (qqIntentionalStop) return;
      // 第二步：通过 REST API 获取 WebSocket 网关地址
      const gatewayUrl = await getGatewayUrl(accessToken);
      if (qqIntentionalStop) return;
      // 第三步：建立 WebSocket 长连接，此后所有事件通过 WS 收发
      const ws = new WebSocket(gatewayUrl);
      qqGatewayWs = ws;
      qqLogger.info("qq-layer 已连接 QQ Gateway");
      setQQReadyStatus(true);
      eventBus.emitSync("qq:ready", { accountId: account.accountId });

      // WebSocket 消息处理：所有来自 QQ Gateway 的事件都在这里处理
      ws.on("message", async (raw: RawData) => {
        const payload = JSON.parse(raw.toString()) as QQWSPayload;
        // 记录序列号，用于心跳时的事件确认
        if (typeof payload.s === "number") lastSeq = payload.s;

        // op=10 是 Gateway 下发的 Hello 帧，表示连接已建立，需要发送 Identify 进行认证
        if (payload.op === 10) {
          const heartbeatInterval = Number(
            (payload.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 30000,
          );
          // 发送 Identify 帧（op=2）进行身份认证
          // intents: 订阅的事件类型，(1<<30)|(1<<12)|(1<<25) 对应 C2C 消息等事件
          // shard: 分片信息，[0, 1] 表示只有 1 个分片
          ws.send(JSON.stringify({
            op: 2,
            d: {
              token: `QQBot ${accessToken}`,
              intents: (1 << 30) | (1 << 12) | (1 << 25),
              shard: [0, 1],
            },
          }));
          // 清理旧的心跳定时器，启动新的心跳机制
          if (qqHeartbeatTimer) clearInterval(qqHeartbeatTimer);
          // 心跳定时器：按 Gateway 指定的间隔定期发送 op=1 保活
          qqHeartbeatTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              // op=1 是 Heartbeat 帧，d 为 lastSeq 用于事件确认
              ws.send(JSON.stringify({ op: 1, d: lastSeq }));
            }
          }, heartbeatInterval);
          return;
        }

        // 解析 C2C（用户与机器人私聊）事件，如果不是 C2C 事件则忽略
        const c2cEvent = parseC2CEvent(payload);
        if (!c2cEvent) return;

        // 提取用户 openid 并持久化，后续机器人回复时知道发给谁
        const userOpenId = c2cEvent.author.user_openid;
        setLastSeenQQOpenidStatus(userOpenId);
        persistTargetOpenid(userOpenId);
        const inboundMessageId = c2cEvent.id;
        const inboundText = c2cEvent.content.trim();
        if (!inboundText) return;

        // 保存当前 token 的快照，用于后续回调中发送回复
        // 注意：token 可能在 AI 处理过程中过期，但回调中用的仍是这个快照
        const currentToken = await getQQAccessToken(appId, secret);
        // 使用 primary bot 的 tenantId 作为该次请求的租户上下文
        // tenantId 决定了 AI 对话使用哪个租户的配置（如 API key、模型等）
        const tenantId = getPrimaryQQBot()?.tenantId?.trim() || QQ_DEFAULT_TENANT_ID;

        // 调用 runWithSingleFlight 启动 AI 对话处理流程
        // singleFlight 保证同一时刻只有一个对话在运行，避免并发冲突
        await runWithSingleFlight({
          message: inboundText,
          channel: "qq",
          tenantId,
          module: "main",
          // onEvent: AI 处理过程中的事件回调
          // 当发生错误时，向用户发送错误提示信息
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
          // onBusy: 当 AI 正在处理其他请求时（单例飞行），通知用户稍后再试
          onBusy: async () => {
            await sendC2CMessage({
              accessToken: currentToken,
              openid: userOpenId,
              content: "指令正在运行中，请稍后",
              replyToMessageId: inboundMessageId,
            });
          },
          // onAccepted: AI 已接受该请求，通知用户已收到
          onAccepted: async () => {
            await sendC2CMessage({
              accessToken: currentToken,
              openid: userOpenId,
              content: "收到指令",
              replyToMessageId: inboundMessageId,
            });
          },
        }).then(async (result) => {
          // AI 处理完成，将最终结果发送给用户
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

      // 连接断开事件：清理心跳、更新状态、触发断线事件、1 秒后自动重连
      ws.on("close", () => {
        if (qqGatewayWs === ws) qqGatewayWs = null;
        if (qqHeartbeatTimer) clearInterval(qqHeartbeatTimer);
        qqHeartbeatTimer = null;
        setQQReadyStatus(false);
        clearQQAccessTokenStatus();
        eventBus.emitSync("qq:offline", { accountId: account.accountId });
        if (qqIntentionalStop) return;
        qqLogger.warn("QQ Gateway 连接断开，1 秒后重连");
        setTimeout(() => {
          if (qqIntentionalStop) return;
          void connect();
        }, 1000);
      });

      // 连接错误事件：仅记录日志，真正的重连由 close 事件触发
      ws.on("error", (error: Error) => {
        qqLogger.error(`QQ Gateway 错误: ${error.message}`);
      });
    } catch (error) {
      // 连接建立阶段发生异常（如 token 无效、网络异常等）
      // 清理状态后 5 秒后重试（比断线重连间隔更长，避免频繁重试）
      const message = error instanceof Error ? error.message : String(error);
      setQQReadyStatus(false);
      clearQQAccessTokenStatus();
      qqLogger.error(`qq-layer 启动失败: ${message}`);
      if (!qqIntentionalStop) {
        setTimeout(() => {
          if (qqIntentionalStop) return;
          void connect();
        }, 5000);
      }
    } finally {
      setQQConnectingStatus(false);
    }
  };

  // 将 connect 函数注册为可重连函数，供外部（如 qq-status）触发手动重连
  setQQReconnectStatus(connect);
  // 首次启动连接
  await connect();
}
