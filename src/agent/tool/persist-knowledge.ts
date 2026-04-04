import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { resolveUserMemoryDir } from "../../memory/utils/path.js";
import { resolveWorkspaceDir } from "../../utils/app-path.js";
import { getSkillManager } from "../skill/skill-manager.js";
import { exists, atomicWriteText, enforceTextSizeLimit } from "./file-utils.js";
import { errResult, okResult, type ToolDetails } from "./types.js";

const toolLogger = getSubsystemConsoleLogger("persist-knowledge-tool");

const persistKnowledgeMemory = Type.Object({
  type: Type.Literal("memory", {
    description:
      "User-wide topic notes under ~/.fgbg/memory/. Append if the file exists, else create. Plain Markdown only (no YAML header).",
  }),
  fileName: Type.String({
    minLength: 1,
    description:
      "Basename only; must end with .md (e.g. notes.md). No slashes or ..; allowed: letters, digits, _, ., -",
  }),
  content: Type.String({
    description:
      "Markdown body to write or append (the tool does not add frontmatter for this type).",
  }),
});

const persistKnowledgeUserinfo = Type.Object({
  type: Type.Literal("userinfo", {
    description:
      "User preferences and collaboration habits under workspace/userinfo/. Overwrites the whole file; tool writes YAML frontmatter; indexed for memorySearch.",
  }),
  fileName: Type.String({
    minLength: 1,
    description:
      "Basename only; must end with .md. Same rules as type=memory fileName.",
  }),
  name: Type.String({
    minLength: 1,
    description:
      "Short title for this file; written to frontmatter and summarized in the system prompt User section.",
  }),
  description: Type.String({
    minLength: 1,
    description:
      "One-line summary for prompts and discovery; written to frontmatter (not the same field as the Markdown body in content).",
  }),
  content: Type.String({
    description:
      "Markdown body after frontmatter (detailed preferences, habits, constraints).",
  }),
});

const persistKnowledgeSkill = Type.Object({
  type: Type.Literal("skill", {
    description:
      "Reusable workflow: writes workspace/skills/<skillDir>/SKILL.md and meta.json (overwrite). Load full steps with loadSkill; do not use memorySearch for skill bodies.",
  }),
  skillDir: Type.String({
    minLength: 1,
    description:
      "Directory under skills/ (e.g. my-workflow). Relative segments only; no .. or absolute paths.",
  }),
  name: Type.String({
    minLength: 1,
    description:
      "Skill display name; written to frontmatter and meta.json for the Skills list in the system prompt.",
  }),
  description: Type.String({
    minLength: 1,
    description:
      "When to use this skill; written to meta.json and frontmatter for the Skills section.",
  }),
  content: Type.String({
    description:
      "SKILL.md body after frontmatter (steps, rules, tool usage); overwrites existing SKILL.md.",
  }),
});

const persistKnowledgeParameters = Type.Union(
  [persistKnowledgeMemory, persistKnowledgeUserinfo, persistKnowledgeSkill],
  {
    description:
      "Discriminated union by type: memory (append user memory file), userinfo (overwrite indexed preferences), skill (overwrite skill dir + meta). Required fields depend on type; see each variant.",
  },
);

type PersistKnowledgeInput = Static<typeof persistKnowledgeParameters>;

type PersistKnowledgeOutput = {
  path: string;
  action: "created" | "appended" | "overwritten";
  bytesWritten: number;
};

function yamlDoubleQuotedScalar(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

function buildMarkdownWithFrontmatter(params: {
  name: string;
  description: string;
  body: string;
}): string {
  const header = [
    "---",
    `name: ${yamlDoubleQuotedScalar(params.name)}`,
    `description: ${yamlDoubleQuotedScalar(params.description)}`,
    "---",
    "",
  ].join("\n");
  const body = params.body.trimEnd();
  return body ? `${header}${body}\n` : `${header}\n`;
}

/** 仅允许单层安全文件名 *.md */
function safeMarkdownBasename(input: string): string | null {
  const t = input.trim();
  if (!t || t.includes("/") || t.includes("\\") || t.includes("\0"))
    return null;
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

/**
 * 按 type 写入固定根目录：memory → ~/.fgbg/memory；userinfo / skill → workspace 下对应目录。
 */
export function createPersistKnowledgeTool(
  _workspace: string,
): ToolDefinition<
  typeof persistKnowledgeParameters,
  ToolDetails<PersistKnowledgeOutput>
> {
  return {
    name: "persistKnowledge",
    label: "Persist knowledge",
    description:
      "Persist structured knowledge by type. memory: ~/.fgbg/memory/<file>.md append-or-create, plain Markdown. userinfo: workspace/userinfo/<file>.md full overwrite with YAML frontmatter, memorySearch-indexed. skill: workspace/skills/<skillDir>/ overwrites SKILL.md + meta.json; use loadSkill for full text.",
    parameters: persistKnowledgeParameters,
    execute: async (
      _toolCallId,
      params: PersistKnowledgeInput,
      _signal,
      _onUpdate,
      _ctx,
    ) => {
      const started = Date.now();

      if (params.type === "memory") {
        const fileName = safeMarkdownBasename(params.fileName);
        if (!fileName) {
          return errResult("fileName 非法：仅允许单层 *.md 且字母数字 _ . -", {
            code: "INVALID_ARGUMENT",
            message: "invalid fileName",
          });
        }
        if (!enforceTextSizeLimit(params.content)) {
          return errResult("content 超过 1MB 限制", {
            code: "INVALID_ARGUMENT",
            message: "content 超过 1MB",
          });
        }
        const dir = resolveUserMemoryDir();
        const filePath = path.join(dir, fileName);
        const fileExists = await exists(filePath);
        try {
          if (fileExists) {
            const toAppend = params.content.endsWith("\n")
              ? params.content
              : `${params.content}\n`;
            await fs.mkdir(dir, { recursive: true, mode: 0o700 });
            await fs.appendFile(filePath, toAppend, {
              encoding: "utf8",
              mode: 0o600,
            });
            const bytesWritten = Buffer.byteLength(toAppend, "utf8");
            toolLogger.info(
              `tool=persistKnowledge type=memory path=${filePath} action=appended bytes=${bytesWritten} durationMs=${Date.now() - started}`,
            );
            return okResult(`已追加 ${bytesWritten} 字节到用户记忆 ${fileName}`, {
              path: filePath,
              action: "appended",
              bytesWritten,
            });
          }
          await atomicWriteText(filePath, params.content);
          const bytesWritten = Buffer.byteLength(params.content, "utf8");
          toolLogger.info(
            `tool=persistKnowledge type=memory path=${filePath} action=created bytes=${bytesWritten} durationMs=${Date.now() - started}`,
          );
          return okResult(`已创建用户记忆 ${fileName}`, {
            path: filePath,
            action: "created",
            bytesWritten,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          toolLogger.warn(
            `tool=persistKnowledge type=memory path=${filePath} error=${message}`,
          );
          return errResult(`写入失败: ${message}`, {
            code: "IO_ERROR",
            message,
          });
        }
      }

      if (params.type === "userinfo") {
        const fileName = safeMarkdownBasename(params.fileName);
        if (!fileName) {
          return errResult("fileName 非法：仅允许单层 *.md 且字母数字 _ . -", {
            code: "INVALID_ARGUMENT",
            message: "invalid fileName",
          });
        }
        const full = buildMarkdownWithFrontmatter({
          name: params.name,
          description: params.description,
          body: params.content,
        });
        if (!enforceTextSizeLimit(full)) {
          return errResult("内容（含头）超过 1MB 限制", {
            code: "INVALID_ARGUMENT",
            message: "超过 1MB",
          });
        }
        const userinfoDir = path.join(resolveWorkspaceDir(), "userinfo");
        const filePath = path.join(userinfoDir, fileName);
        try {
          await atomicWriteText(filePath, full);
          const bytesWritten = Buffer.byteLength(full, "utf8");
          toolLogger.info(
            `tool=persistKnowledge type=userinfo path=${filePath} action=overwritten bytes=${bytesWritten} durationMs=${Date.now() - started}`,
          );
          return okResult(`已写入 userinfo/${fileName}`, {
            path: filePath,
            action: "overwritten",
            bytesWritten,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          toolLogger.warn(
            `tool=persistKnowledge type=userinfo path=${filePath} error=${message}`,
          );
          return errResult(`写入失败: ${message}`, {
            code: "IO_ERROR",
            message,
          });
        }
      }

      const safeSkillPath = sanitizeSkillDir(params.skillDir);
      if (!safeSkillPath) {
        return errResult("skillDir 非法，仅支持 skills 下相对路径段", {
          code: "INVALID_ARGUMENT",
          message: "skillDir 非法",
        });
      }
      const fullSkill = buildMarkdownWithFrontmatter({
        name: params.name,
        description: params.description,
        body: params.content,
      });
      const metaJson = `${JSON.stringify(
        {
          name: params.name,
          description: params.description,
          path: safeSkillPath,
        },
        null,
        2,
      )}\n`;
      if (
        !enforceTextSizeLimit(fullSkill) ||
        !enforceTextSizeLimit(metaJson)
      ) {
        return errResult("内容超过 1MB 限制", {
          code: "INVALID_ARGUMENT",
          message: "超过 1MB",
        });
      }
      const skillRoot = path.join(resolveWorkspaceDir(), "skills", safeSkillPath);
      const skillPath = path.join(skillRoot, "SKILL.md");
      const metaPath = path.join(skillRoot, "meta.json");
      try {
        await fs.mkdir(skillRoot, { recursive: true, mode: 0o700 });
        await atomicWriteText(skillPath, fullSkill);
        await atomicWriteText(metaPath, metaJson);
        getSkillManager().loadMetaInfos();
        const bytesWritten =
          Buffer.byteLength(fullSkill, "utf8") +
          Buffer.byteLength(metaJson, "utf8");
        toolLogger.info(
          `tool=persistKnowledge type=skill path=${skillPath} action=overwritten bytes=${bytesWritten} durationMs=${Date.now() - started}`,
        );
        return okResult(`已写入 skills/${safeSkillPath}/SKILL.md 与 meta.json`, {
          path: skillPath,
          action: "overwritten",
          bytesWritten,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.warn(
          `tool=persistKnowledge type=skill path=${skillPath} error=${message}`,
        );
        return errResult(`写入失败: ${message}`, {
          code: "IO_ERROR",
          message,
        });
      }
    },
  };
}
