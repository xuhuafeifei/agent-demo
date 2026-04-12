type ReconnectFn = (() => Promise<void>) | null;
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { getAccessToken } from "./qq-api.js";

type QQRuntimeStatus = {
  ready: boolean;
  accessToken: string;
  accessTokenExpiresAt: number;
  lastSeenUserOpenid: string;
  reconnectFn: ReconnectFn;
  connecting: boolean;
};

const qqStatusLogger = getSubsystemConsoleLogger("qq-status");
const TOKEN_REFRESH_SKEW_MS = 60_000;

const status: QQRuntimeStatus = {
  ready: false,
  accessToken: "",
  accessTokenExpiresAt: 0,
  lastSeenUserOpenid: "",
  reconnectFn: null,
  connecting: false,
};

export function isQQReadyStatus(): boolean {
  return status.ready;
}

export function setQQReadyStatus(ready: boolean): void {
  status.ready = ready;
}

export function isQQAccessTokenValidStatus(now: number = Date.now()): boolean {
  return Boolean(
    status.accessToken && now < status.accessTokenExpiresAt - TOKEN_REFRESH_SKEW_MS,
  );
}

async function refreshQQAccessTokenStatus(
  appId: string,
  secret: string,
): Promise<string> {
  const { accessToken, expiresIn } = await getAccessToken(appId, secret);
  status.accessToken = accessToken;
  status.accessTokenExpiresAt = Date.now() + expiresIn * 1000;
  return accessToken;
}

export async function getQQAccessToken(
  appId: string,
  secret: string,
): Promise<string> {
  if (isQQAccessTokenValidStatus()) {
    return status.accessToken;
  }
  qqStatusLogger.info("QQ access_token 缺失或即将过期，自动刷新");
  return refreshQQAccessTokenStatus(appId, secret);
}

export function invalidateQQAccessTokenStatus(reason?: string): void {
  status.accessToken = "";
  status.accessTokenExpiresAt = 0;
  if (reason) {
    qqStatusLogger.warn(`QQ access_token 已失效，原因: ${reason}`);
  } else {
    qqStatusLogger.warn("QQ access_token 已失效");
  }
}

export function clearQQAccessTokenStatus(): void {
  status.accessToken = "";
  status.accessTokenExpiresAt = 0;
}

export async function forceRefreshQQAccessToken(
  appId: string,
  secret: string,
): Promise<string> {
  return refreshQQAccessTokenStatus(appId, secret);
}

export function getLastSeenQQOpenidStatus(): string {
  return status.lastSeenUserOpenid;
}

export function setLastSeenQQOpenidStatus(openid: string): void {
  status.lastSeenUserOpenid = openid;
}

export function getQQReconnectStatus(): ReconnectFn {
  return status.reconnectFn;
}

export function setQQReconnectStatus(fn: ReconnectFn): void {
  status.reconnectFn = fn;
}

export function isQQConnectingStatus(): boolean {
  return status.connecting;
}

export function setQQConnectingStatus(connecting: boolean): void {
  status.connecting = connecting;
}

/** 主动关闭 QQ 连接后统一写回运行时状态（由 stopQQLayer 调用） */
export function applyQQLayerStoppedStatus(): void {
  status.ready = false;
  status.connecting = false;
  status.accessToken = "";
  status.accessTokenExpiresAt = 0;
  status.reconnectFn = null;
}
