import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { syncAllMemorySources, syncMemoryByPath } from "./indexer.js";
import { closeMemoryDb } from "./store.js";
import type {
  MemoryHit,
  MemorySource,
  SearchOptions,
  SyncResult,
  SyncSummary,
} from "./types.js";
import { searchMemory } from "./recall.js";
import {
  ensureDirSync,
  resolveUserMemoryDir,
  resolveWorkspaceMemoryPath,
} from "./utils/path.js";
import { resolveSessionDir } from "../agent/session/session-path.js";
import { ensureAgentWorkspace } from "../agent/workspace.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";

const DEBOUNCE_MS = 1500;
const memoryLogger = getSubsystemConsoleLogger("memory");

/**
 * 记忆系统门面。
 *
 * 职责：
 * - 管理 watcher 生命周期（start/stop）
 * - 将来源事件转换为按 path 的同步任务
 * - 对外提供 syncAll / search 能力
 */
export class MemoryIndexManager {
  private started = false;
  private timerByPath = new Map<string, NodeJS.Timeout>();
  private watchers: FSWatcher[] = [];

  /**
   * 启动监听并执行首次全量同步。
   * 仅当全部成功后才置 started=true，否则调用方方法均按未启动处理（返回空）。
   */
  async start(): Promise<void> {
    if (this.started) return;

    // watcher 启动前确保目录存在，避免监听初始化失败
    ensureAgentWorkspace();
    const workspaceMemory = resolveWorkspaceMemoryPath();
    ensureDirSync(resolveUserMemoryDir());

    // 两路监听：工作区 MEMORY.md 单文件 + 用户 ~/.fgbg/memory/*.md 目录
    this.watchFile(workspaceMemory, "MEMORY.md");
    this.watchDir(resolveUserMemoryDir(), "memory");

    // 冷启动先全量同步，建立索引基线；成功后再标记已启动
    await this.syncAllInternal();
    this.started = true;
  }

  /**
   * 停止监听并释放资源。
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    // 先清空所有待执行 debounce，避免 stop 后仍触发 handleSync
    for (const timer of this.timerByPath.values()) {
      clearTimeout(timer);
    }
    this.timerByPath.clear();

    // 再关闭所有 watcher，防止后续文件事件进入队列
    const closing = this.watchers.map((watcher) => watcher.close());
    await Promise.allSettled(closing);
    this.watchers = [];
    this.started = false;

    // 最后关闭 SQLite 连接，释放文件句柄
    await closeMemoryDb();
  }

  /**
   * 统一的外部事件入口。
   * 所有来源最终归一化到内部 MemorySource，并按 path 去重防抖。
   */
  onMemorySourceChanged(
    source: "workspace" | "memory" | "session",
    filePath: string,
  ): void {
    if (!this.started) return;

    const normalized = path.resolve(filePath);
    let mapped: MemorySource = "sessions";
    if (source === "memory") mapped = "MEMORY.md"; // 用户 memory 目录（~/.fgbg/memory/*.md）→ MEMORY.md
    if (source === "workspace") mapped = "memory"; // 工作区 MEMORY.md 路径 → memory
    if (source === "session") mapped = "sessions";

    // 同一路径防抖：取消未执行的定时器，只保留最后一次变更
    const existing = this.timerByPath.get(normalized);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      void this.handleSync(normalized, mapped);
    }, DEBOUNCE_MS);
    this.timerByPath.set(normalized, timer);
  }

  /**
   * 执行一次全源扫描同步。未启动时返回空汇总。
   */
  async syncAll(): Promise<SyncSummary> {
    if (!this.started) {
      return {
        total: 0,
        create: 0,
        rebuild: 0,
        delete: 0,
        skip: 0,
        failed: 0,
        durationMs: 0,
      };
    }
    return this.syncAllInternal();
  }

  /**
   * 内部全量同步（不检查 started），供 start() 与 syncAll() 使用。
   */
  private async syncAllInternal(): Promise<SyncSummary> {
    const sessionDir = resolveSessionDir();
    const summary = await syncAllMemorySources(sessionDir);
    memoryLogger.info(
      `syncAll total=${summary.total} create=${summary.create} rebuild=${summary.rebuild} delete=${summary.delete} skip=${summary.skip} failed=${summary.failed} durationMs=${summary.durationMs}ms`,
    );
    return summary;
  }

  /**
   * 对外检索接口。未启动时返回空数组。
   */
  async search(query: string, options?: SearchOptions): Promise<MemoryHit[]> {
    if (!this.started) return [];
    const startMs = Date.now();
    const hits = await searchMemory(query, options);
    const durationMs = Date.now() - startMs;
    memoryLogger.info(
      `search query="${query.slice(0, 80)}${query.length > 80 ? "…" : ""}" durationMs=${durationMs}ms hits=${hits.length}`,
    );
    return hits;
  }

  /**
   * 单 path 同步执行器。
   * 失败仅记录日志，不向上抛出，保证队列继续前进。
   */
  private async handleSync(
    filePath: string,
    source: MemorySource,
  ): Promise<SyncResult | null> {
    this.timerByPath.delete(filePath);
    try {
      const result = await syncMemoryByPath({ path: filePath, source });
      memoryLogger.debug(
        `sync path=${result.path} action=${result.action} chunks=${result.chunkCount} costMs=${result.costMs}ms`,
      );
      return result;
    } catch (error) {
      // 单 path 失败不抛给上层，只打日志，保证其他路径继续同步
      const message = error instanceof Error ? error.message : String(error);
      memoryLogger.warn(
        `sync error path=${filePath} source=${source} error=${message}`,
      );
      return null;
    }
  }

  /**
   * 监听单文件（workspace MEMORY.md）。
   */
  private watchFile(filePath: string, source: "MEMORY.md"): void {
    const _source = source;
    const watcher = chokidar.watch(filePath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    watcher.on("add", () => this.onMemorySourceChanged("workspace", filePath));
    watcher.on("change", () =>
      this.onMemorySourceChanged("workspace", filePath),
    );
    watcher.on("unlink", () =>
      this.onMemorySourceChanged("workspace", filePath),
    );
    watcher.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      memoryLogger.warn(`watcher disabled for ${filePath}: ${message}`);
    });
    this.watchers.push(watcher);
  }

  /**
   * 监听目录下的 Markdown 文件（~/.fgbg/memory/*.md）。
   */
  private watchDir(dirPath: string, _source: "memory"): void {
    const watcher = chokidar.watch(path.join(dirPath, "*.md"), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    const onUpdate = (filePath: string) =>
      this.onMemorySourceChanged("memory", filePath);
    watcher.on("add", onUpdate);
    watcher.on("change", onUpdate);
    watcher.on("unlink", onUpdate);
    watcher.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      memoryLogger.warn(`watcher disabled for ${dirPath}: ${message}`);
    });
    this.watchers.push(watcher);
  }
}

let singleton: MemoryIndexManager | null = null;

/**
 * 获取全局单例，避免重复创建 watcher 与数据库连接。
 */
export function getMemoryIndexManager(): MemoryIndexManager {
  if (!singleton) {
    singleton = new MemoryIndexManager();
  }
  return singleton;
}
