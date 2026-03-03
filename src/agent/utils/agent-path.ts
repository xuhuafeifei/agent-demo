import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../utils/app-path.js";

/**
 * Agent 工作目录（默认 ~/.fgbg/agent）。
 * 可通过 FGBG_AGENT_DIR 覆盖，用于存放 agent 运行时生成的文件（如 model.json）。
 */
export function resolveAgentDir(): string {
  const override = process.env.FGBG_AGENT_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(resolveStateDir(), "agent");
}

/**
 * 确保 agent 目录存在，不存在则创建（权限 0o700）。
 */
export function ensureAgentDir(): string {
  const agentDir = resolveAgentDir();
  if (!fs.existsSync(agentDir)) {
    fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  }
  return agentDir;
}
