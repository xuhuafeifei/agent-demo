#!/usr/bin/env node
/**
 * Standalone Qwen Portal device OAuth. No OpenClaw deps, no persistence.
 * Usage: pnpm run qwen-oauth  (or bun/node with tsx)
 * Output: final token JSON to stdout; prompts to stderr.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { platform } from "node:os";

const QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai";
const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`;
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
const QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
const QWEN_OAUTH_SCOPE = "openid profile email model.completion";
const QWEN_OAUTH_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

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
  if (!res.ok)
    throw new Error(`Device code failed: ${res.status} ${await res.text()}`);
  const payload = (await res.json()) as DeviceCodeResponse;
  if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
    throw new Error(payload.error ?? "Incomplete device code response");
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

function log(...args: unknown[]): void {
  console.error(...args);
}

export async function resolveQwenPortalOAuth(): Promise<void> {
  const { verifier, challenge } = generatePkce();
  const device = await requestDeviceCode(challenge);
  const verificationUrl =
    device.verification_uri_complete ?? device.verification_uri;

  log("Qwen OAuth — open this URL and enter the code if prompted:");
  log(verificationUrl);
  log("Code:", device.user_code);
  log("");

  try {
    await openUrl(verificationUrl);
  } catch {
    // ignore
  }

  const start = Date.now();
  let intervalMs = (device.interval ?? 2) * 1000;
  const timeoutMs = device.expires_in * 1000;

  while (Date.now() - start < timeoutMs) {
    log("Waiting for approval…");
    const result = await pollDeviceToken(device.device_code, verifier);

    if (result.status === "success") {
      log("Done.");
      console.log(JSON.stringify(result.token, null, 2));
      process.exit(0);
    }
    if (result.status === "error") {
      log("Error:", result.message);
      process.exit(1);
    }
    if (result.status === "pending" && result.slowDown) {
      intervalMs = Math.min(intervalMs * 1.5, 10000);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  log("Timed out.");
  process.exit(1);
}
