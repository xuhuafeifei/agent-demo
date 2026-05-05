import {
  type PromptSection,
  type PromptSectionWithMeta,
  resolvePromptSectionContent,
} from "./section-pipeline.js";
import { estimateTextTokens } from "../utils/token-counter.js";

type CacheScope = {
  tenantId: string;
  sessionKey: string;
  lane: string;
};

type SectionCacheEntry = {
  content: string;
  tokens: number;
  updatedAt: number;
};

type SectionCacheMap = Map<string, SectionCacheEntry>;

const sectionCacheStore = new Map<string, SectionCacheMap>();

function scopeKey(scope: CacheScope): string {
  return `${scope.tenantId}::${scope.sessionKey}::${scope.lane}`;
}

function sectionCacheKey(section: PromptSection): string {
  return `${section.id}::${section.source}`;
}

function getOrCreateScopeMap(scope: CacheScope): SectionCacheMap {
  const key = scopeKey(scope);
  const existing = sectionCacheStore.get(key);
  if (existing) return existing;
  const map: SectionCacheMap = new Map();
  sectionCacheStore.set(key, map);
  return map;
}

export function materializePromptSectionsWithCache(
  sections: PromptSection[],
  scope: CacheScope,
): PromptSectionWithMeta[] {
  const scopeMap = getOrCreateScopeMap(scope);
  const resolved: PromptSectionWithMeta[] = [];
  for (const section of sections) {
    const sKey = sectionCacheKey(section);
    const cached = section.cacheable ? scopeMap.get(sKey) : undefined;
    if (cached) {
      resolved.push({
        ...section,
        content: cached.content,
        tokens: cached.tokens,
        fromCache: true,
      });
      continue;
    }

    const content = resolvePromptSectionContent(section);
    const tokens = estimateTextTokens(content);
    if (section.cacheable) {
      scopeMap.set(sKey, {
        content,
        tokens,
        updatedAt: Date.now(),
      });
    }
    resolved.push({
      ...section,
      content,
      tokens,
      fromCache: false,
    });
  }
  return resolved.filter((s) => s.content.length > 0);
}

export function invalidatePromptSectionCache(scope?: Partial<CacheScope>): void {
  if (!scope) {
    sectionCacheStore.clear();
    return;
  }
  for (const key of [...sectionCacheStore.keys()]) {
    const [tenantId, sessionKey, lane] = key.split("::");
    if (scope.tenantId && scope.tenantId !== tenantId) continue;
    if (scope.sessionKey && scope.sessionKey !== sessionKey) continue;
    if (scope.lane && scope.lane !== lane) continue;
    sectionCacheStore.delete(key);
  }
}
