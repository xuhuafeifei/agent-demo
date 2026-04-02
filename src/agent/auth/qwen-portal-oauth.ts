#!/usr/bin/env node
/**
 * Standalone Qwen Portal device OAuth. No OpenClaw deps, no persistence.
 * Usage: pnpm run qwen-oauth  (or bun/node with with tsx)
 * Output: final token JSON to stdout; prompts to stderr.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { platform } from "node:os";
import {
  QwenPortalCredentials,
  saveQwenPortalCredentials,
  getQwenPortalCredentials,
  isQwenPortalCredentialsExpired,
} from "./oauth-path.js";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";

const QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai";
const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`;
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
const QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
const QWEN_OAUTH_SCOPE = "openid profile email model.completion";
const QWEN_OAUTH_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

const logger = getSubsystemConsoleLogger("auth");

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
  error?: string;
}

interface TokenResponse {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_in?: number | null;
  resource_url?: string;
}

export interface QwenOAuthToken {
  access: string;
  refresh: string;
  expires: number;
  resourceUrl?: string;
}

type PollResult =
  | { status: "success"; token: QwenOAuthToken }
  | { status: "pending"; slowDown?: boolean }
  | { status: "error"; message: string };

function toFormUrlEncoded(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function requestDeviceCode(
challenge: string,
): Promise<DeviceCodeResponse> {
  const res = await fetch(QWEN_OAUTH_DEVICE_CODE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "x-request-id": randomUUID(),
    },
    body: toFormUrlEncoded({
      client_id: QWEN_OAUTH_CLIENT_ID,
      scope: QWEN_OAUTH_SCOPE,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    logger.error("Device code failed: %s %s", res.status, errorText);
    throw new Error(`Device code failed: ${res.status}`);
  }
  const payload = (await res.json()) as DeviceCodeResponse;
  if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
    const errorMsg = payload.error ?? "Incomplete device code response";
    logger.error("Device code error: %s", errorMsg);
    throw new Error(errorMsg);
  }
  return payload;
}

async function pollDeviceToken(
  deviceCode: string,
  verifier: string,
): Promise<PollResult> {
  const res = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: toFormUrlEncoded({
      grant_type: QWEN_OAUTH_GRANT_TYPE,
      client_id: QWEN_OAUTH_CLIENT_ID,
      device_code: deviceCode,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    if (body.error === "authorization_pending") return { status: "pending" };
    if (body.error === "slow_down")
      return { status: "pending", slowDown: true };
    return {
      status: "error",
      message: body.error_description ?? body.error ?? res.statusText,
    };
  }
  const t = (await res.json()) as TokenResponse;
  if (!t.access_token || !t.refresh_token || t.expires_in == null) {
    return { status: "error", message: "Incomplete token response" };
  }
  return {
    status: "success",
    token: {
      access: t.access_token,
      refresh: t.refresh_token,
      expires: Date.now() + t.expires_in * 1000,
      resourceUrl: t.resource_url,
    },
  };
}

function openUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    const p = platform();
    const cmd =
      p === "darwin"
        ? `open "${url}"`
        : p === "win32"
          ? `start "" "${url}"`
          : `xdg-open "${url}"`;
    exec(cmd, () => resolve());
  });
}

/**
 * 启动 Qwen Portal 的设备授权流程（OAuth Device Authorization Grant）。
 *
 * 这是交互式命令行工具，用于首次获取 OAuth Token。
 * 使用方法：pnpm run qwen-oauth（或 node/bun 直接运行）
 *
 * 工作流程：
 * 1. 生成 PKCE 参数
 * 2. 请求设备码
 * 3. 输出授权 URL 和用户码，引导用户浏览器授权
 * 4. 轮询 Token 接口直到授权完成或超时
 * 5. 成功后保存凭证到 ~/.fgbg/auth-profile.json
 *
 * 注意：该方法会调用 process.exit()，不适合作为库函数在其他流程中使用。
 *
 * TODO: 未来计划 - 可以扩展为支持其他 provider 的通用 OAuth 设备授权工具，
 * 或将交互逻辑与核心授权逻辑分离，方便集成到 GUI 或其他交互界面。
 */
export async function resolveQwenPortalOAuth(): Promise<void> {
  const { verifier, challenge } = generatePkce();
  const device = await requestDeviceCode(challenge);
  const verificationUrl =
    device.verification_uri_complete ?? device.verification_uri;

  // Must use console (not subsystem logger): allowModule / consoleLevel can
  // suppress auth logs, and this CLI must always show the URL and user code.
  console.error("");
  console.error(
    "Qwen OAuth — open this URL in your browser (or use the tab we tried to open):",
  );
  console.error(verificationUrl);
  console.error("User code:", device.user_code);
  console.error("");

  try {
    await openUrl(verificationUrl);
  } catch {
    // ignore
  }

  const start = Date.now();
  let intervalMs = (device.interval ?? 2) * 1000;
  const timeoutMs = device.expires_in * 1000;

  console.error("Waiting for you to complete authorization in the browser…");
  console.error("");

  while (Date.now() - start < timeoutMs) {
    const result = await pollDeviceToken(device.device_code, verifier);

    if (result.status === "success") {
      logger.info("Qwen portal OAuth success");

      // 保存到 auth-profile.json
      saveQwenPortalCredentials(result.token);
      logger.info("Qwen portal OAuth credentials saved");

      process.exit(0);
    }
    if (result.status === "error") {
      logger.error("Qwen portal OAuth failed: %s", result.message);
      process.exit(1);
    }
    if (result.status === "pending" && result.slowDown) {
      intervalMs = Math.min(intervalMs * 1.5, 10000);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  logger.error("Qwen portal OAuth timed out");
  process.exit(1);
}

interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * 刷新 qwen-portal 的 OAuth 凭证
 * 成功返回新的凭证，失败返回 null
 */
export async function refreshQwenPortalCredentials(
  credentials: QwenPortalCredentials,
): Promise<QwenPortalCredentials | null> {
  try {
    const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credentials.refresh,
        client_id: QWEN_OAUTH_CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Refresh token failed: %s %s", response.status, errorText);
      return null;
    }

    const data = (await response.json()) as RefreshTokenResponse;

    if (!data.access_token ||!data.refresh_token || !data.expires_in) {
      logger.error("Invalid refresh token response");
      return null;
    }

    const newCredentials: QwenPortalCredentials = {
      type: "oauth",
      provider: "qwen-portal",
      access: data.access_token,
      refresh: data.refresh_token,
      expires: Date.now() + data.expires_in * 1000,
    };

    // 保存到文件
    saveQwenPortalCredentials(newCredentials);
    logger.info("Qwen portal credentials refreshed and saved");

    return newCredentials;
  } catch (error) {
    logger.error("Error refreshing token: %s", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * 获取有效的 qwen-portal access token
 * - 如果凭证不存在，返回 null
 * - 如果凭证未过期，直接返回 access
 * - 如果凭证已过期，尝试刷新，成功返回新的 access，失败返回 null
 */
export async function getValidQwenPortalAccessToken(): Promise<string | null> {
  const credentials = getQwenPortalCredentials();
  if (!credentials) {
    logger.debug("No qwen-portal credentials found");
    return null;
  }

  if (!isQwenPortalCredentialsExpired(credentials)) {
    logger.debug("Using existing valid qwen-portal token");
    return credentials.access;
  }

  logger.info("Qwen-portal token expired, refreshing...");
  const newCredentials = await refreshQwenPortalCredentials(credentials);
  if (!newCredentials) {
    logger.error("Failed to refresh qwen-portal token");
    return null;
  }

  logger.info("Qwen-portal token refreshed successfully");
  return newCredentials.access;
}
