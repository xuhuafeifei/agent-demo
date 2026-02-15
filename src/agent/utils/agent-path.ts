import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveStateDir(): string {
  const override = process.env.FGBG_STATE_DIR?.trim();
  if (override) {
    // 允许外部覆盖状态目录，便于多环境隔离。
    return path.resolve(override);
  }

  return path.join(os.homedir(), ".fgbg");
}

export function resolveAgentDir(): string {
  const override = process.env.FGBG_AGENT_DIR?.trim();
  if (override) {
    // 优先使用外部覆盖路径，便于本地调试和测试隔离。
    return path.resolve(override);
  }

  // 默认路径固定在状态目录，避免工作目录变化导致配置丢失。
  return path.join(resolveStateDir(), "agent");
}

export function resolveGlobalConfigPath(): string {
  const override = process.env.FGBG_CONFIG_PATH?.trim();
  if (override) {
    // 明确支持通过 FGBG_CONFIG_PATH 指定全局配置文件位置。
    return path.resolve(override);
  }

  // 默认使用 ~/.fgbg/fgbg.json。
  return path.join(resolveStateDir(), "fgbg.json");
}

export function ensureAgentDir(): string {
  const agentDir = resolveAgentDir();

  // 仅在路径不存在时创建，保持幂等。
  if (!fs.existsSync(agentDir)) {
    fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  }

  return agentDir;
}
