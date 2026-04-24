import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { syncAllMemorySources, syncMemoryByPath, appendLaneEvent } from "./indexer.js";
import { closeMemoryDb } from "./store.js";
import type {
  MemoryHit,
  MemorySource,
  SearchOptions,
  SyncResult,
  SyncSummary,
} from "./types.js";
import { searchMemory } from "./recall.js";
import { createPrepareStrategy, setModelRepairingFlag } from "./embedding/embedding-provider.js";
import { readFgbgUserConfig } from "../config/index.js";
import {
  ensureDirSync,
  resolveWorkspaceMemoryDir,
  resolveWorkspaceMemoryPath,
  resolveWorkspaceUserinfoDir,
} from "./utils/path.js";
import { getEventBus } from "../event-bus/index.js";
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
 *
 * 每个租户对应一个独立实例，通过 getMemoryIndexManager(tenantId) 获取。
 */
export class MemoryIndexManager {
  /** 该实例所属的租户 ID */
  private readonly tenantId: string;
  private state: "stopped" | "starting" | "running" | "repairing" | "stopping" =
    "stopped";
  private timerByPath = new Map<string, NodeJS.Timeout>();
  private watchers: FSWatcher[] = [];

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  /**
   * 设置记忆系统状态（用于内部状态管理）
   */
  private setState(
    newState: "stopped" | "starting" | "running" | "repairing" | "stopping",
  ): void {
    const oldState = this.state;
    if (oldState !== newState) {
      memoryLogger.debug(` 状态变更: ${oldState} → ${newState}`);
      this.state = newState;
      // 通知 embedding-provider 修复状态变化，供 isModelDownloading() 使用
      setModelRepairingFlag(newState === "repairing");
    }
  }

  /**
   * 检查是否正在修复
   */
  public isRepairing(): boolean {
    return this.state === "repairing";
  }

  /**
   * 启动监听并执行首次全量同步。
   * 仅当全部成功后才置 state="running"，否则按未启动处理。
   * 如果模型正在下载中，则暂停启动过程。
   */
  async start(): Promise<void> {
    if (this.state === "running" || this.state === "starting") return;

    // 如果模型正在修复中，暂停启动过程
    if (this.state === "repairing") {
      memoryLogger.warn(` 正在修复中，记忆系统启动已暂停`);
      return;
    }

    this.setState("starting");

    // watcher 启动前确保目录存在，避免监听初始化失败
    ensureAgentWorkspace(this.tenantId);
    ensureDirSync(resolveWorkspaceMemoryDir(this.tenantId));
    ensureDirSync(resolveWorkspaceUserinfoDir(this.tenantId));

    // 监听：工作区 MEMORY.md、~/.fgbg/tenants/{tenantId}/workspace/memory/*.md、workspace/userinfo/*.md、lane/*.jsonl
    this.watchFile(resolveWorkspaceMemoryPath(this.tenantId), "MEMORY.md");
    this.watchDir(resolveWorkspaceMemoryDir(this.tenantId), "memory");
    this.watchDir(resolveWorkspaceUserinfoDir(this.tenantId), "userinfo");

    // lane 终身走增量，由 EventBus 驱动，不监听文件系统
    getEventBus().on("lane:appended", (payload) => {
      const p = payload as { tenantId: string; laneFile: string; event: { role: string; content: string } };
      if (p.tenantId !== this.tenantId) return;
      if (this.state !== "running") return;
      void this.appendLaneEvent(p.laneFile, p.event);
    });

    // 获取配置并创建准备策略
    const config = readFgbgUserConfig().agents.memorySearch;
    const prepareStrategy = createPrepareStrategy(config);

    // 检查服务是否可连接
    const isConnected = await prepareStrategy.connect();

    if (!isConnected) {
      // 服务不可连接，尝试自动修复
      memoryLogger.warn(` embedding 服务不可连接，尝试自动修复`);
      this.setState("repairing");

      const repairSuccess = await prepareStrategy.repair();

      if (!repairSuccess) {
        // 修复失败，停止启动
        memoryLogger.error(`自动修复失败，记忆系统启动失败`);
        this.setState("stopped");
        return;
      }

      // 修复成功，重新检查连接
      const reconnected = await prepareStrategy.connect();
      if (!reconnected) {
        memoryLogger.error(` 修复后仍然无法连接，记忆系统启动失败`);
        this.setState("stopped");
        return;
      }
    }

    // 冷启动先全量同步，建立索引基线；成功后再标记为运行中
    try {
      await this.syncAllInternal();
      this.setState("running");
      // 调度搜索, 触发模型检测
      await searchMemory(this.tenantId, "init_memory_system");
    } catch (error) {
      memoryLogger.error(` 启动失败: ${error}`);
      this.setState("stopped");
      // 清理已创建的 watchers
      for (const watcher of this.watchers) {
        await watcher.close();
      }
      this.watchers = [];
    }
  }

  /**
   * 停止监听并释放资源。
   */
  async stop(): Promise<void> {
    if (this.state === "stopped" || this.state === "stopping") return;

    this.setState("stopping");

    try {
      // 先清空所有待执行 debounce，避免 stop 后仍触发 handleSync
      for (const timer of this.timerByPath.values()) {
        clearTimeout(timer);
      }
      this.timerByPath.clear();

      // 再关闭所有 watcher，防止后续文件事件进入队列
      const closing = this.watchers.map((watcher) => watcher.close());
      await Promise.allSettled(closing);
      this.watchers = [];

      // 最后关闭该租户的 SQLite 连接，释放文件句柄
      await closeMemoryDb(this.tenantId);
    } catch (error) {
      memoryLogger.error(` 停止过程中出错: ${error}`);
    } finally {
      this.setState("stopped");
    }
  }

  /**
   * 统一的外部事件入口。
   * 所有来源最终归一化到内部 MemorySource，并按 path 去重防抖。
   */
  onMemorySourceChanged(
    source: "workspace" | "memory" | "userinfo" | "lane",
    filePath: string,
  ): void {
    if (this.state !== "running") return;

    const normalized = path.resolve(filePath);
    let mapped: MemorySource = "lane";
    if (source === "memory") mapped = "MEMORY.md"; // 用户 memory 目录（~/.fgbg/tenants/{tenantId}/workspace/memory/*.md）→ MEMORY.md
    if (source === "workspace") mapped = "memory"; // 工作区 MEMORY.md 路径 → memory
    if (source === "lane") mapped = "lane";
    if (source === "userinfo") mapped = "userinfo";

    // 同一路径防抖：取消未执行的定时器，只保留最后一次变更
    const existing = this.timerByPath.get(normalized);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      void this.handleSync(normalized, mapped);
    }, DEBOUNCE_MS);
    this.timerByPath.set(normalized, timer);
  }

  /**
   * 执行一次全源扫描同步。状态不是 running 时返回空汇总。
   */
  async syncAll(): Promise<SyncSummary> {
    if (this.state !== "running") {
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
   * 内部全量同步（不检查 state），供 start() 与 syncAll() 使用。
   */
  private async syncAllInternal(): Promise<SyncSummary> {
    const summary = await syncAllMemorySources(this.tenantId);
    memoryLogger.info(
      `syncAll total=${summary.total} create=${summary.create} rebuild=${summary.rebuild} delete=${summary.delete} skip=${summary.skip} failed=${summary.failed} durationMs=${summary.durationMs}ms`,
    );
    return summary;
  }

  /**
   * 增量索引单个 lane 事件。
   */
  private async appendLaneEvent(
    laneFile: string,
    event: { role: string; content: string },
  ): Promise<void> {
    try {
      await appendLaneEvent(this.tenantId, laneFile, event);
      memoryLogger.debug(`lane incremental indexed path=${laneFile}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      memoryLogger.warn(`lane incremental index error path=${laneFile} error=${message}`);
    }
  }

  /**
   * 对外检索接口。状态不是 running 时返回空数组。
   */
  async search(query: string, options?: SearchOptions): Promise<MemoryHit[]> {
    if (this.state !== "running") return [];
    const startMs = Date.now();
    const hits = await searchMemory(this.tenantId, query, options);
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
      const result = await syncMemoryByPath(this.tenantId, { path: filePath, source });
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
   * 监听目录下顶层 *.md（chokidar glob），事件映射到对应 MemorySource。
   */
  private watchDir(dirPath: string, channel: "memory" | "userinfo"): void {
    const watcher = chokidar.watch(path.join(dirPath, "*.md"), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    const onUpdate = (filePath: string) =>
      this.onMemorySourceChanged(channel, filePath);
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

// 按租户 ID 管理 MemoryIndexManager 单例，每个租户一个独立实例
const managerMap = new Map<string, MemoryIndexManager>();

/**
 * 获取指定租户的 MemoryIndexManager 单例。
 * 同一 tenantId 在进程内只创建一个实例，避免重复 watcher 与数据库连接。
 */
export function getMemoryIndexManager(tenantId: string): MemoryIndexManager {
  let manager = managerMap.get(tenantId);
  if (!manager) {
    manager = new MemoryIndexManager(tenantId);
    managerMap.set(tenantId, manager);
  }
  return manager;
}
