import fs from "node:fs";
import path from "node:path";
import type { AgentLane } from "../../hook/events.js";
import { resolveTenantDir } from "../../utils/app-path.js";

export type RouteDecisionRecord = {
  userInput: string;
  llmTotalResponse: string;
  emotions: string[];
  emotionRate: number;
  consumeTime: number;
  mode: AgentLane;
  /** router | fallback_prev | fallback_heavy | non_main_module */
  decisionSource: string;
  routerRawResponse: string;
};

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function resolveRouteLogPath(tenantId: string, module: string): string {
  return path.join(
    resolveTenantDir(tenantId),
    "route",
    `route__${safeSegment(module)}__${safeSegment(tenantId)}.jsonl`,
  );
}

function parseModeFromLine(line: string): AgentLane | null {
  try {
    const o = JSON.parse(line) as { mode?: unknown };
    if (o.mode === "light" || o.mode === "heavy") return o.mode;
  } catch {
    /* ignore */
  }
  return null;
}

const ROUTE_LOG_TAIL_MAX = 512 * 1024;

/**
 * 仅读取末条记录的 mode；大文件只读尾部一段，避免整文件读入内存。
 */
export async function readLastRouteMode(
  tenantId: string,
  module: string,
): Promise<AgentLane | null> {
  const file = resolveRouteLogPath(tenantId, module);
  try {
    const st = await fs.promises.stat(file);
    if (st.size === 0) return null;
    let content: string;
    if (st.size <= ROUTE_LOG_TAIL_MAX) {
      content = await fs.promises.readFile(file, "utf-8");
    } else {
      const h = await fs.promises.open(file, "r");
      try {
        const buf = Buffer.alloc(ROUTE_LOG_TAIL_MAX);
        const { bytesRead } = await h.read(
          buf,
          0,
          ROUTE_LOG_TAIL_MAX,
          st.size - ROUTE_LOG_TAIL_MAX,
        );
        content = buf.subarray(0, bytesRead).toString("utf-8");
      } finally {
        await h.close();
      }
    }
    const lines = content.trimEnd().split("\n");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const mode = parseModeFromLine(lines[i].trim());
      if (mode) return mode;
    }
    return null;
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err?.code === "ENOENT") return null;
    return null;
  }
}

/**
 * 追加一行 JSON（append-only，历史永不删除）。
 */
export async function appendRouteDecisionLog(params: {
  tenantId: string;
  module: string;
  record: RouteDecisionRecord;
}): Promise<void> {
  try {
    const file = resolveRouteLogPath(params.tenantId, params.module);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.appendFile(
      file,
      `${JSON.stringify(params.record)}\n`,
      "utf-8",
    );
  } catch {
    /* 日志失败不影响主流程 */
  }
}
