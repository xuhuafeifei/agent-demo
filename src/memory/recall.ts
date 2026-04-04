import {
  embeddingText,
  isModelDownloading,
} from "./embedding/embedding-provider.js";
import { getChunksByIds, queryFts, queryVector } from "./store.js";
import type { MemoryHit, SearchOptions } from "./types.js";
import { getSubsystemConsoleLogger } from "../logger/logger.js";

const memoryLogger = getSubsystemConsoleLogger("memory");

const RRF_K = 60;

/**
 * 执行混合检索（FTS + 向量）并融合排序。
 */
export async function searchMemory(
  query: string,
  options?: SearchOptions,
): Promise<MemoryHit[]> {
  // 检查模型是否正在下载，如果是则返回空结果
  if (isModelDownloading()) {
    memoryLogger.info(`embedding正在自动修复，搜索请求已暂停: ${query}`);
    throw new Error("embedding正在自动修复，搜索请求已暂停");
  }

  const topKFts = options?.topKFts ?? 20;
  const topKVector = options?.topKVector ?? 20;
  const topN = options?.topN ?? 8;

  // 并行执行 FTS 关键词召回与向量 KNN 召回
  const [ftsRows, vectorRows] = await Promise.all([
    queryFts(query, topKFts),
    embeddingText(query).then((embedding) =>
      queryVector(embedding, topKVector),
    ),
  ]);

  const ftsRank = new Map<number, number>();
  const vectorRank = new Map<number, number>();
  for (const row of ftsRows) ftsRank.set(row.id, row.rank);
  for (const row of vectorRows) vectorRank.set(row.id, row.rank);

  const allIds = Array.from(new Set([...ftsRank.keys(), ...vectorRank.keys()]));
  if (allIds.length === 0) return [];

  const chunks = await getChunksByIds(allIds);
  const byId = new Map(chunks.map((item) => [item.id, item])); // id -> ChunkRow，便于按 id 取 content

  const hits: MemoryHit[] = [];
  for (const id of allIds) {
    const chunk = byId.get(id);
    if (!chunk) continue;

    const fRank = ftsRank.get(id);
    const vRank = vectorRank.get(id);

    // RRF 融合：1/(k+rank)，排名越前分数越高
    let score = 0;
    if (fRank) score += 1 / (RRF_K + fRank);
    if (vRank) score += 1 / (RRF_K + vRank);

    // 来源加权：MEMORY.md / userinfo 略高于 sessions，再高于普通 memory
    if (chunk.source === "MEMORY.md") score *= 1.1;
    if (chunk.source === "userinfo") score *= 1.15;
    if (chunk.source === "sessions") score *= 1.05;

    hits.push({
      id,
      path: chunk.path,
      source: chunk.source,
      lineStart: chunk.line_start,
      lineEnd: chunk.line_end,
      content: chunk.chunk_content,
      score,
      scoreDetail: {
        ftsRank: fRank,
        vectorRank: vRank,
        rrfScore: score,
      },
    });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topN); // 按融合分数取前 topN 条
}
