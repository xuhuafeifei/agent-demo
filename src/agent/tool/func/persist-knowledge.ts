import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import {
  resolveWorkspaceMemoryDir,
  resolveWorkspaceSkillsDir,
  resolveWorkspaceUserinfoDir,
} from "../../../memory/utils/path.js";
import { buildMarkdownWithFrontmatter } from "../../workspace.js";
import { getSkillManager } from "../../skill/skill-manager.js";
import {
  exists,
  atomicWriteText,
  enforceTextSizeLimit,
} from "../utils/file-utils.js";
import { errResult, okResult, type ToolDetails } from "../tool-result.js";

const toolLogger = getSubsystemConsoleLogger("persist-knowledge-tool");

const persistKnowledgeParameters = Type.Object(
  {
    type: Type.Union(
      [
        Type.Literal("memory", {
          description:
            "Records of important events or topics, written under workspace/memory/",
        }),
        Type.Literal("userinfo", {
          description:
            "User profile and preferences (e.g. name, coding style, collaboration habits), written under workspace/userinfo/",
        }),
        Type.Literal("skill", {
          description: "Reusable workflow, written under workspace/skills/",
        }),
      ],
      {
        description:
          "Knowledge type: memory (important events/topics), userinfo (user profile/preferences), skill (reusable workflow)",
      },
    ),
    fileName: Type.String({
      minLength: 1,
      description:
        "Required input from model. Markdown filename (must end with .md, e.g. notes.md). Used by memory/userinfo;",
    }),
    path: Type.String({
      minLength: 1,
      description:
        "Required input from model. Relative path under skills/ (e.g. my-workflow or ci/deploy). Used by skill;",
    }),
    title: Type.String({
      minLength: 1,
      description:
        "Required input from model. Title written to YAML frontmatter name for userinfo/skill;",
    }),
    description: Type.String({
      minLength: 1,
      description:
        "Required input from model. One-line summary written to YAML frontmatter description for userinfo/skill;",
    }),
    content: Type.String({
      minLength: 1,
      description:
        "Required input from model. Markdown body. memory writes plain markdown without header; userinfo/skill auto-add YAML frontmatter.",
    }),
  },
  {
    description:
      "Persist structured knowledge with unified required inputs. memory/userinfo use fileName (ignore path); skill uses path (ignore fileName) and always writes SKILL.md.",
  },
);

type PersistKnowledgeInput = Static<typeof persistKnowledgeParameters>;

type PersistKnowledgeOutput = {
  path: string;
  action: "created";
  bytesWritten: number;
};

function buildMemoryMarkdown(body: string): string {
  const content = body.trimEnd();
  return content ? `${content}\n` : "";
}

/** 仅允许单层安全文件名 *.md */
function safeMarkdownBasename(input: string): string | null {
  const t = input.trim();
  if (!t || t.includes("/") || t.includes("\\") || t.includes("\0")) return null;
  const base = path.basename(t);
  if (base !== t) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.md$/i.test(base)) return null;
  return base;
}

function sanitizeSkillDir(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.includes("..") ||
    normalized.split("/").some((seg) => !seg.trim())
  ) {
    return null;
  }
  return normalized;
}

async function writeNewFile(params: {
  fullPath: string;
  content: string;
}): Promise<number> {
  await atomicWriteText(params.fullPath, params.content);
  return Buffer.byteLength(params.content, "utf8");
}

/**
 * 创建知识持久化工具。
 * 按 type 写入租户私有目录：
 *   memory   → tenants/{tenantId}/workspace/memory/
 *   userinfo → tenants/{tenantId}/workspace/userinfo/
 *   skill    → tenants/{tenantId}/workspace/skills/<path>/SKILL.md
 *
 * @param tenantId 租户 ID，用于定位写入目录
 */
export function createPersistKnowledgeTool(
  tenantId: string,
): ToolDefinition<
  typeof persistKnowledgeParameters,
  ToolDetails<PersistKnowledgeOutput>
> {
  return {
    name: "persistKnowledge",
    label: "Persist knowledge",
    description:
      "Persist structured knowledge. memory: records of important events/topics (workspace/memory/, no frontmatter); userinfo: user profile/preferences (workspace/userinfo/, with frontmatter); skill: reusable workflow (workspace/skills/<path>/SKILL.md, with frontmatter). All inputs are required and selectively used by type.",
    parameters: persistKnowledgeParameters,
    execute: async (
      _toolCallId,
      params: PersistKnowledgeInput,
      _signal,
      _onUpdate,
      _ctx,
    ) => {
      const started = Date.now();
      const fileName = safeMarkdownBasename(params.fileName);
      if (!fileName) {
        return errResult(
          "Invalid fileName: only single-level *.md with letters, digits, _, ., -",
          { code: "INVALID_ARGUMENT", message: "invalid fileName" },
        );
      }
      const safeSkillDir = sanitizeSkillDir(params.path);
      if (!safeSkillDir) {
        return errResult(
          "Invalid path: only relative path segments under skills/ are allowed",
          { code: "INVALID_ARGUMENT", message: "invalid path" },
        );
      }
      const normalizedTitle = params.title.trim();
      const normalizedDescription = params.description.trim();
      if (!normalizedTitle || !normalizedDescription) {
        return errResult("Invalid title/description: must be non-empty", {
          code: "INVALID_ARGUMENT",
          message: "invalid title/description",
        });
      }
      if (!params.content.trim()) {
        return errResult("Invalid content: must be non-empty", {
          code: "INVALID_ARGUMENT",
          message: "invalid content",
        });
      }

      const trueContent =
        params.type === "memory"
          ? buildMemoryMarkdown(params.content)
          : buildMarkdownWithFrontmatter({
              name: normalizedTitle,
              description: normalizedDescription,
              body: params.content,
            });

      if (!enforceTextSizeLimit(trueContent)) {
        return errResult("content exceeds 1MB limit", {
          code: "INVALID_ARGUMENT",
          message: "exceeds 1MB",
        });
      }

      // 按 type 解析目标目录（均在当前租户 workspace 下）
      const trueDir =
        params.type === "memory"
          ? resolveWorkspaceMemoryDir(tenantId)
          : params.type === "userinfo"
            ? resolveWorkspaceUserinfoDir(tenantId)
            : path.join(resolveWorkspaceSkillsDir(tenantId), safeSkillDir);
      const trueFileName = params.type === "skill" ? "SKILL.md" : fileName;
      const truePath = path.join(trueDir, trueFileName);

      const fileExists = await exists(truePath);
      if (fileExists) {
        return errResult(
          `File already exists: ${trueFileName}. Please read first, then merge updates.`,
          { code: "ALREADY_EXISTS", message: `File ${trueFileName} already exists` },
        );
      }
      try {
        await fs.mkdir(trueDir, { recursive: true, mode: 0o700 });
        const bytesWritten = await writeNewFile({ fullPath: truePath, content: trueContent });
        if (params.type === "skill") {
          // 通知 skill manager 刷新租户 skill 列表
          getSkillManager(tenantId).loadMetaInfos();
        }
        toolLogger.info(
          `tool=persistKnowledge type=${params.type} path=${truePath} action=created bytes=${bytesWritten} durationMs=${Date.now() - started}`,
        );
        return okResult(`Created ${truePath}`, {
          path: truePath,
          action: "created",
          bytesWritten,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.warn(
          `tool=persistKnowledge type=${params.type} path=${truePath} error=${message}`,
        );
        return errResult(`Write failed: ${message}`, {
          code: "IO_ERROR",
          message,
        });
      }
    },
  };
}
