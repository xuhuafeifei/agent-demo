/** 记忆来源类型。 */
export type MemorySource = "MEMORY.md" | "memory" | "sessions";

/** 单路径同步动作。 */
export type SyncAction = "skip" | "create" | "rebuild" | "delete";

/** 单路径同步结果。 */
export type SyncResult = {
  path: string;
  action: SyncAction;
  chunkCount: number;
  costMs: number;
};

/** 全量同步汇总结果。 */
export type SyncSummary = {
  total: number;
  create: number;
  rebuild: number;
  delete: number;
  skip: number;
  failed: number;
  durationMs: number;
};

/** 记忆检索命中项。 */
export type MemoryHit = {
  id: number;
  path: string;
  source: MemorySource;
  lineStart: number;
  lineEnd: number;
  content: string;
  score: number;
  scoreDetail?: {
    ftsRank?: number;
    vectorRank?: number;
    rrfScore: number;
  };
};

/** 检索可选参数。 */
export type SearchOptions = {
  topKFts?: number;
  topKVector?: number;
  topN?: number;
};
