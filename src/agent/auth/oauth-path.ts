import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../utils/app-path.js";

export interface QwenPortalCredentials {
  type: "oauth";
  provider: "qwen-portal";
  access: string;
  refresh: string;
  expires: number;
  resourceUrl?: string;
}

interface AuthProfile {
  profiles: Record<string, QwenPortalCredentials>;
}

/**
 * 获取 auth-profile.json 文件路径
 * 默认：~/.fgbg/auth-profile.json
 */
export function getAuthProfilePath(): string {
  return path.join(resolveStateDir(), "auth-profile.json");
}

/**
 * 读取 auth-profile.json 文件
 * 文件不存在或格式错误时返回空 profiles
 */
export function readAuthProfile(): AuthProfile {
  const filePath = getAuthProfilePath();
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as AuthProfile;
    if (raw && typeof raw === "object" && "profiles" in raw) {
      return raw;
    }
  } catch {
    // 文件不存在或解析失败，返回默认结构
  }
  return { profiles: {} };
}

/**
 * 写入 auth-profile.json 文件
 * 目录不存在时会自动创建（权限 0o700），文件权限 0o600
 */
export function writeAuthProfile(profile: AuthProfile): void {
  const filePath = getAuthProfilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), { mode: 0o600 });
}

/**
 * 从 auth-profile.json 读取 qwen-portal 的 OAuth 凭证
 */
export function getQwenPortalCredentials(): QwenPortalCredentials | null {
  const profile = readAuthProfile();
  return profile.profiles["qwen-portal:default"] ?? null;
}

/**
 * 保存 qwen-portal 的 OAuth 凭证到 auth-profile.json
 * 会自动补全 type 和 provider 字段
 */
export function saveQwenPortalCredentials(
  credentials: Omit<QwenPortalCredentials, "type" | "provider">,
): void {
  const profile = readAuthProfile();
  profile.profiles["qwen-portal:default"] = {
    type: "oauth",
    provider: "qwen-portal",
    ...credentials,
  };
  writeAuthProfile(profile);
}

/**
 * 检查凭证是否过期（提前 5 分钟视为过期，避免边界问题）
 */
export function isQwenPortalCredentialsExpired(
  credentials: QwenPortalCredentials,
): boolean {
  const bufferMs = 5 * 60 * 1000; // 5 分钟缓冲
  return Date.now() + bufferMs >= credentials.expires;
}