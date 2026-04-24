import fs from "node:fs";
import path from "node:path";
import { resolveTenantLaneDir } from "../utils/app-path.js";
import { resolveLaneIndexPath } from "./lane-path.js";
import type { LaneEvent, LaneIndex } from "./lane-types.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";


// 获取 lane 子系统的日志记录器，用于输出轮转等关键操作的日志
const laneLogger = getSubsystemConsoleLogger("lane");

// 单个 lane 文件的最大容量限制（256 KB），超过后将触发文件轮转
const MAX_LANE_FILE_SIZE = 256 * 1024;

// 文件轮转时，从旧文件中保留的最近事件条数
const PRESERVE_EVENT_COUNT = 10;

// 保留事件内容的最大字符数，超出部分将被截断，避免保留过多数据
const PRESERVE_CONTENT_MAX_CHARS = 500;

/**
 * 确保指定租户的 lane 目录存在。
 * 若目录不存在，则递归创建，并设置权限为仅所有者可读写执行（0o700）。
 *
 * @param tenantId - 租户唯一标识
 * @returns 该租户对应的 lane 目录绝对路径
 */
export function ensureLaneDir(tenantId: string): string {
  // 解析租户对应的 lane 目录路径
  const laneDir = resolveTenantLaneDir(tenantId);
  // 目录不存在时递归创建，保障后续文件写入不会失败
  if (!fs.existsSync(laneDir)) {
    fs.mkdirSync(laneDir, { recursive: true, mode: 0o700 });
  }
  return laneDir;
}

/**
 * 加载指定租户的 lane 索引文件。
 * 索引文件为 JSON 格式，记录了每个 laneKey 对应的 laneId、laneFile 及更新时间。
 *
 * @param tenantId - 租户唯一标识
 * @returns 解析后的 LaneIndex 对象；若文件不存在或读取失败则返回空对象
 */
export function loadLaneIndex(tenantId: string): LaneIndex {
  const indexPath = resolveLaneIndexPath(tenantId);
  try {
    // 同步读取索引文件内容
    const raw = fs.readFileSync(indexPath, "utf-8");
    // 将 JSON 字符串解析为 LaneIndex 类型对象
    return JSON.parse(raw) as LaneIndex;
  } catch {
    // 文件不存在、权限不足或 JSON 解析异常时，安全降级返回空对象
    return {};
  }
}

/**
 * 将 lane 索引持久化到磁盘。
 * 以格式化 JSON（2 空格缩进）写入，并设置文件权限为仅所有者可读写（0o600），防止信息泄露。
 *
 * @param tenantId - 租户唯一标识
 * @param index    - 需要保存的 LaneIndex 对象
 */
export function saveLaneIndex(tenantId: string, index: LaneIndex): void {
  const indexPath = resolveLaneIndexPath(tenantId);
  // 写入时追加换行符，保持文件末尾规范
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, {
    mode: 0o600,
  });
}

/**
 * 生成唯一的 lane 标识符。
 * 格式为：lane-<module>-<tenantId>-<ISO 时间戳>，其中时间戳中的冒号和点被替换为短横线，确保文件名安全。
 *
 * @param module   - 所属模块名称
 * @param tenantId - 租户唯一标识
 * @returns 新生成的 laneId 字符串
 */
function generateLaneId(module: string, tenantId: string): string {
  // 获取当前时间的 ISO 格式字符串，并替换文件名非法字符
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `lane-${module}-${tenantId}-${ts}`;
}

/**
 * 从指定的 lane 文件中提取需要保留的事件。
 * 主要用于文件大小超限后创建新文件时，将最近的若干条事件迁移到新文件，保证上下文连续性。
 *
 * @param laneFilePath - lane 文件绝对路径
 * @returns 需要保留的事件数组，每条事件的内容会被截断至指定最大字符数
 */
function getEventsToPreserve(laneFilePath: string): LaneEvent[] {
  // 文件不存在时无需保留任何事件
  if (!fs.existsSync(laneFilePath)) return [];

  // 读取整个文件内容并按行拆分，过滤掉空行
  const content = fs.readFileSync(laneFilePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());

  const events: LaneEvent[] = [];
  // 从最后一行向前遍历，提取最多 PRESERVE_EVENT_COUNT 条有效事件（即最近的事件）
  for (
    let i = lines.length - 1;
    i >= 0 && events.length < PRESERVE_EVENT_COUNT;
    i--
  ) {
    try {
      const event = JSON.parse(lines[i]) as LaneEvent;
      // 由于是从后往前遍历，使用 unshift 保证最终数组按时间正序排列
      events.unshift(event);
    } catch {
      // 某一行解析失败时跳过，避免脏数据导致整体迁移失败
      continue;
    }
  }

  // 对保留的事件内容做截断处理，防止旧事件的超长内容占用新文件过多空间
  return events.map((e) => ({
    ...e,
    content: e.content.slice(0, PRESERVE_CONTENT_MAX_CHARS),
  }));
}

/**
 * 向指定租户的 lane 追加一条事件。
 * 如果对应 lane 文件不存在则新建；若文件大小超过阈值，则触发文件轮转，
 * 并将旧文件中的最近若干条事件迁移到新文件，最后更新索引并通知内存索引管理器。
 *
 * @param tenantId - 租户唯一标识
 * @param event    - 需要追加的 LaneEvent 事件对象
 */
export function appendLane(tenantId: string, event: LaneEvent): { laneFile: string } {
  // 确保租户 lane 目录已就绪
  const laneDir = ensureLaneDir(tenantId);
  // 加载当前租户的 lane 索引，用于定位已有 lane 文件
  const index = loadLaneIndex(tenantId);
  const entry = index[event.laneKey];

  let laneId: string;
  let laneFile: string;

  // 判断该 laneKey 是否已有对应的 lane 文件且文件真实存在于磁盘
  if (entry?.laneFile && fs.existsSync(entry.laneFile)) {
    // 复用现有的 laneId 与文件路径
    laneId = entry.laneId;
    laneFile = entry.laneFile;

    // 检查当前文件大小，决定是否触发轮转
    const stat = fs.statSync(laneFile);
    if (stat.size > MAX_LANE_FILE_SIZE) {
      // 从旧文件中提取最近需保留的事件，保证上下文不丢失
      const eventsToPreserve = getEventsToPreserve(laneFile);

      // 生成新的 laneId 与文件路径
      laneId = generateLaneId(event.module, tenantId);
      laneFile = path.join(laneDir, `${laneId}.jsonl`);

      // 将保留的事件先写入新文件
      for (const e of eventsToPreserve) {
        fs.appendFileSync(laneFile, `${JSON.stringify(e)}\n`, { flag: "a" });
      }

      // 记录轮转日志，便于后续排查问题
      laneLogger.info(
        "[lane] rotated lane file laneKey=%s oldLaneId=%s newLaneId=%s",
        event.laneKey,
        entry.laneId,
        laneId,
      );
    }
  } else {
    // 无现有文件或索引记录失效时，全新创建 lane 文件
    laneId = generateLaneId(event.module, tenantId);
    laneFile = path.join(laneDir, `${laneId}.jsonl`);
  }

  // 将当前事件以 JSON Lines 格式追加写入文件
  fs.appendFileSync(laneFile, `${JSON.stringify(event)}\n`, { flag: "a" });

  // 更新索引中该 laneKey 的元数据：laneId、文件路径、最新更新时间
  index[event.laneKey] = {
    laneId,
    laneFile,
    updatedAt: Date.now(),
  };
  // 将更新后的索引持久化到磁盘
  saveLaneIndex(tenantId, index);

  return { laneFile };
}

/**
 * 加载指定租户、指定 laneKey 的全部事件。
 * 通过索引定位到实际的 lane 文件，逐行解析 JSON Lines 格式数据。
 *
 * @param tenantId - 租户唯一标识
 * @param laneKey  - lane 的唯一键名
 * @returns 该 lane 下的所有 LaneEvent 数组；若索引或文件不存在则返回空数组
 */
export function loadLane(tenantId: string, laneKey: string): LaneEvent[] {
  // 加载索引并定位目标 lane 的元数据
  const index = loadLaneIndex(tenantId);
  const entry = index[laneKey];
  // 索引中无记录或文件已丢失时返回空数组
  if (!entry?.laneFile || !fs.existsSync(entry.laneFile)) return [];

  // 读取文件并按行拆分，过滤空行
  const content = fs.readFileSync(entry.laneFile, "utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());

  const events: LaneEvent[] = [];
  // 逐行解析 JSON，将有效事件加入结果数组
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as LaneEvent);
    } catch {
      // 解析失败的脏数据行直接跳过，不影响整体读取
      continue;
    }
  }
  return events;
}

/**
 * 清除指定租户、指定 laneKey 的全部历史数据。
 * 包括删除对应的 lane 数据文件，以及从索引中移除该 laneKey 的记录。
 *
 * @param tenantId - 租户唯一标识
 * @param laneKey  - 需要清除的 lane 键名
 */
export function clearLaneHistory(tenantId: string, laneKey: string): void {
  // 加载当前索引
  const index = loadLaneIndex(tenantId);
  const entry = index[laneKey];
  // 若索引中无此 laneKey，直接返回，无需操作
  if (!entry?.laneFile) return;

  try {
    // 尝试删除物理文件；若文件已不存在或权限不足则静默忽略
    fs.unlinkSync(entry.laneFile);
  } catch {
    // ignore
  }

  // 从索引对象中移除该 laneKey 的引用
  delete index[laneKey];
  // 将更新后的索引写回磁盘
  saveLaneIndex(tenantId, index);
}
