export type CacheTraceStage =
  | "request:start"
  | "request:end"
  | "prompt:start"
  | "prompt:first_assistant"
  | "prompt:end";

export type CacheTraceEvent = {
  ts: string;
  seq: number;
  stage: CacheTraceStage;
  requestId?: string;
  provider?: string;
  model?: string;
  note?: string;
};

export type CacheTrace = {
  enabled: boolean;
  recordStage: (stage: CacheTraceStage, note?: string) => void;
  logTimeline: (status: "done" | "error") => void;
};

export function createCacheTrace(params: {
  requestId: string;
  provider: string;
  model: string;
}): CacheTrace {
  const { requestId, provider, model } = params;
  let seq = 0;
  const stages = new Map<CacheTraceStage, { timestamp: number; note?: string }>();

  const recordStage: CacheTrace["recordStage"] = (stage, note) => {
    stages.set(stage, { timestamp: Date.now(), note });
  };

  const logTimeline: CacheTrace["logTimeline"] = (status) => {
    const start = stages.get("request:start");
    if (!start) return;

    const promptStart = stages.get("prompt:start");
    const firstAssistant = stages.get("prompt:first_assistant");
    const promptEnd = stages.get("prompt:end");
    const end = stages.get("request:end");

    const requestToPromptMs = promptStart ? promptStart.timestamp - start.timestamp : -1;
    const promptToFirstMs = promptStart && firstAssistant ? firstAssistant.timestamp - promptStart.timestamp : -1;
    const firstToEndMs = firstAssistant && promptEnd ? promptEnd.timestamp - firstAssistant.timestamp : -1;
    const promptToEndMs = promptStart && promptEnd ? promptEnd.timestamp - promptStart.timestamp : -1;
    const totalMs = end ? end.timestamp - start.timestamp : -1;

    const stageReport = Array.from(stages.entries())
      .map(([key, value]) => `${key}=${value.timestamp - start.timestamp}ms`)
      .join(" ");

    console.log(
      `[请求时间线] requestId=${requestId} status=${status} provider=${provider} model=${model} ` +
        `requestToPromptMs=${requestToPromptMs} promptToFirstMs=${promptToFirstMs} ` +
        `firstToEndMs=${firstToEndMs} promptToEndMs=${promptToEndMs} totalMs=${totalMs} ` +
        `stages=[${stageReport}]`,
    );
  };

  return {
    enabled: true,
    recordStage,
    logTimeline,
  };
}
