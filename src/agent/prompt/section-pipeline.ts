import { estimateTextTokens } from "../utils/token-counter.js";

export const CORE_REQUIRED_SECTION_IDS = new Set<string>([
  "who-you-are",
  "environment",
  "channel",
  "channel-rules",
  "language",
]);

export const enum PromptSectionPriority {
  CORE = 1000,
  POLICY = 900,
  MEMORY = 800,
  CONTEXT = 700,
  TOOLS = 600,
  OPTIONAL = 500,
}

export type PromptSection = {
  id: string;
  content?: string;
  getContent?: () => string;
  priority: number;
  source: string;
  cacheable?: boolean;
  required?: boolean;
};

export type PromptSectionWithMeta = PromptSection & {
  content: string;
  tokens: number;
  fromCache: boolean;
};

export type PromptAssembleDecision = {
  kind:
    | "dedupe_keep_existing"
    | "dedupe_replace_with_higher_priority"
    | "dedupe_replace_with_latest_same_priority"
    | "trim_optional_section";
  sectionId: string;
  detail: string;
};

export type PromptAssembleResult = {
  prompt: string;
  sections: PromptSectionWithMeta[];
  totalTokens: number;
  threshold: number;
  decisions: PromptAssembleDecision[];
  wasTrimmed: boolean;
};

export function resolvePromptSectionContent(section: PromptSection): string {
  const raw = section.content ?? section.getContent?.() ?? "";
  return raw.trim();
}

export function dedupeAndSortPromptSections(
  sections: PromptSection[],
): { sections: PromptSection[]; decisions: PromptAssembleDecision[] } {
  const byId = new Map<string, PromptSection>();
  const decisions: PromptAssembleDecision[] = [];
  for (const section of sections) {
    const existing = byId.get(section.id);
    if (!existing) {
      byId.set(section.id, section);
      continue;
    }
    if (section.priority > existing.priority) {
      byId.set(section.id, section);
      decisions.push({
        kind: "dedupe_replace_with_higher_priority",
        sectionId: section.id,
        detail: `${section.source}(${section.priority}) replaced ${existing.source}(${existing.priority})`,
      });
      continue;
    }
    if (section.priority === existing.priority) {
      byId.set(section.id, section);
      decisions.push({
        kind: "dedupe_replace_with_latest_same_priority",
        sectionId: section.id,
        detail: `${section.source} replaced ${existing.source} at same priority`,
      });
      continue;
    }
    decisions.push({
      kind: "dedupe_keep_existing",
      sectionId: section.id,
      detail: `${existing.source}(${existing.priority}) kept, dropped ${section.source}(${section.priority})`,
    });
  }
  const sorted = [...byId.values()].sort((a, b) => b.priority - a.priority);
  return { sections: sorted, decisions };
}

export function assemblePromptFromSections(
  inputSections: PromptSectionWithMeta[],
  opts: {
    maxTokens: number;
    tokenRatio: number;
    userMessageText?: string;
  },
): PromptAssembleResult {
  const decisions: PromptAssembleDecision[] = [];
  const sections = [...inputSections];
  const threshold = opts.maxTokens * opts.tokenRatio;

  let totalTokens = sections.reduce((sum, s) => sum + s.tokens, 0);
  const userTokens = estimateTextTokens(opts.userMessageText ?? "");
  let combinedTokens = totalTokens + userTokens;
  let wasTrimmed = false;

  // 超预算时仅裁剪可选段，核心段永不裁剪。
  if (combinedTokens > threshold) {
    const trimCandidates = sections
      .filter((s) => !s.required && !CORE_REQUIRED_SECTION_IDS.has(s.id))
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.tokens - a.tokens;
      });

    for (const candidate of trimCandidates) {
      if (combinedTokens <= threshold) break;
      const idx = sections.findIndex((s) => s.id === candidate.id);
      if (idx < 0) continue;
      sections.splice(idx, 1);
      totalTokens -= candidate.tokens;
      combinedTokens = totalTokens + userTokens;
      wasTrimmed = true;
      decisions.push({
        kind: "trim_optional_section",
        sectionId: candidate.id,
        detail: `trimmed ${candidate.tokens} tokens from ${candidate.source}`,
      });
    }
  }

  return {
    prompt: sections.map((s) => s.content).join("\n\n"),
    sections,
    totalTokens: totalTokens + userTokens,
    threshold,
    decisions,
    wasTrimmed,
  };
}
