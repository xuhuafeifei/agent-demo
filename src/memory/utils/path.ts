import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveStateDir, resolveWorkspaceDir } from "../../utils/app-path.js";

/**
 * 记忆模块根目录（默认 ~/.fgbg/memory）。
 */
export function resolveMemoryRootDir(): string {
  const override = process.env.FGBG_MEMORY_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(resolveStateDir(), "memory"); // 与 resolveUserMemoryDir 同目录，语义区分
}

/**
 * SQLite 文件路径（memory.db）。
 */
export function resolveMemoryDbPath(): string {
  return path.join(resolveMemoryRootDir(), "memory.db");
}

/**
 * 工作区 MEMORY.md 路径。
 */
export function resolveWorkspaceMemoryPath(): string {
  return path.join(resolveWorkspaceDir(), "MEMORY.md");
}

/**
 * 工作区 memory/ 目录（~/.fgbg/workspace/memory）。
 */
export function resolveWorkspaceMemoryDir(): string {
  return path.join(resolveWorkspaceDir(), "memory");
}

/**
 * 工作区 userinfo/（扁平 *.md，参与 memorySearch）。
 */
export function resolveWorkspaceUserinfoDir(): string {
  return path.join(resolveWorkspaceDir(), "userinfo");
}

/**
 * 工作区 skills/（不参与 memorySearch，仅 loadSkill）。
 */
export function resolveWorkspaceSkillsDir(): string {
  return path.join(resolveWorkspaceDir(), "skills");
}

/**
 * 用户 memory 目录（~/.fgbg/memory）。
 */
export function resolveUserMemoryDir(): string {
  return path.join(resolveStateDir(), "memory");
}

/**
 * 本地 embedding 模型目录（~/.fgbg/workspace/embedding）。
 */
export function resolveEmbeddingModelDir(): string {
  return path.join(resolveWorkspaceDir(), "embedding");
}

/**
 * 确保目录存在并返回目录路径。
 */
export function ensureDirSync(dir: string): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); // 仅当前用户可读写
  }
  return dir;
}

/**
 * memory 模块需要的目录前置创建。
 */
export function ensureMemoryPaths(): void {
  ensureDirSync(resolveMemoryRootDir());   // memory.db、用户 .md 所在目录
  ensureDirSync(resolveEmbeddingModelDir()); // GGUF 模型目录
}

/**
 * 将 ~/ 开头路径展开为绝对路径。
 */
export function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2)); // ~/ -> homedir
  }
  return p;
}
