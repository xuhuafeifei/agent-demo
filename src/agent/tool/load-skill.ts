import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../logger/logger.js";
import { resolveWorkspaceDir } from "../../utils/app-path.js";
import { errResult, okResult, type ToolDetails } from "./types.js";

const toolLogger = getSubsystemConsoleLogger("tool");

const loadSkillParameters = Type.Object({
  skillDir: Type.String({ minLength: 1 }),
});

type LoadSkillInput = Static<typeof loadSkillParameters>;

type LoadSkillOutput = {
  skillDir: string;
  skillPath: string;
  content: string;
};

function sanitizeSkillPath(input: string): string | null {
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

export function createLoadSkillTool(): ToolDefinition<
  typeof loadSkillParameters,
  ToolDetails<LoadSkillOutput>
> {
  return {
    name: "loadSkill",
    label: "Load Skill",
    description:
      "Load SKILL.md content by skill directory name from ~/.fgbg/workspace/skills/<skillDir>/SKILL.md.",
    parameters: loadSkillParameters,
    execute: async (
      _toolCallId,
      params: LoadSkillInput,
      _signal,
      _onUpdate,
      _ctx,
    ) => {
      const started = Date.now();
      const safeSkillPath = sanitizeSkillPath(params.skillDir);
      if (!safeSkillPath) {
        return errResult("skillDir 非法，仅支持 skills 下相对路径", {
          code: "INVALID_ARGUMENT",
          message: "skillDir 非法，仅支持 skills 下相对路径",
        });
      }

      const skillPath = path.join(
        resolveWorkspaceDir(),
        "skills",
        safeSkillPath,
        "SKILL.md",
      );
      try {
        const content = await fs.readFile(skillPath, "utf8");
        const durationMs = Date.now() - started;
        toolLogger.info(
          `tool=loadSkill skillDir=${safeSkillPath} bytes=${Buffer.byteLength(content, "utf8")} durationMs=${durationMs}`,
        );
        return okResult(`已加载 skill: ${safeSkillPath}`, {
          skillDir: safeSkillPath,
          skillPath,
          content,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolLogger.warn(
          `tool=loadSkill skillDir=${safeSkillPath} path=${skillPath} error=${message}`,
        );
        return errResult(`未找到 skill 文件: ${safeSkillPath}/SKILL.md`, {
          code: "NOT_FOUND",
          message,
        });
      }
    },
  };
}
