import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getSubsystemConsoleLogger } from "../../../logger/logger.js";
import { resolveTenantWorkspaceDir, resolveSharedSkillsDir } from "../../../utils/app-path.js";
import { errResult, okResult, type ToolDetails } from "../tool-result.js";

const toolLogger = getSubsystemConsoleLogger("tool");

const loadSkillParameters = Type.Object({
  skillDir: Type.String({
    minLength: 1,
    description:
      "Directory name under workspace/skills/ or shared/skills/ containing SKILL.md (e.g. task-scheduler). Relative segments only; no .. or absolute paths.",
  }),
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

/**
 * 创建 skill 加载工具。
 * 查找顺序：租户 workspace/skills/ 优先，其次 shared/skills/（系统预置）。
 *
 * @param tenantId 租户 ID，用于定位租户私有 skills 目录
 */
export function createLoadSkillTool(tenantId: string): ToolDefinition<
  typeof loadSkillParameters,
  ToolDetails<LoadSkillOutput>
> {
  // 预先计算两个 skills 目录路径，工厂闭包持有
  const tenantSkillsDir = path.join(resolveTenantWorkspaceDir(tenantId), "skills");
  const sharedSkillsDir = resolveSharedSkillsDir();

  return {
    name: "loadSkill",
    label: "Load Skill",
    description:
      "loadSkill(skillDir) — load SKILL.md from tenant workspace/skills/<skillDir>/ or shared/skills/<skillDir>/.",
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
        return errResult("skillDir 非法，仅支持相对路径", {
          code: "INVALID_ARGUMENT",
          message: "skillDir 非法，仅支持相对路径",
        });
      }

      // 优先从租户 workspace/skills/ 查找，找不到再查 shared/skills/
      const candidates = [
        path.join(tenantSkillsDir, safeSkillPath, "SKILL.md"),
        path.join(sharedSkillsDir, safeSkillPath, "SKILL.md"),
      ];

      for (const skillPath of candidates) {
        try {
          const content = await fs.readFile(skillPath, "utf8");
          const durationMs = Date.now() - started;
          toolLogger.info(
            `tool=loadSkill skillDir=${safeSkillPath} path=${skillPath} bytes=${Buffer.byteLength(content, "utf8")} durationMs=${durationMs}`,
          );
          return okResult(`已加载 skill: ${safeSkillPath}`, {
            skillDir: safeSkillPath,
            skillPath,
            content,
          });
        } catch {
          // 当前候选路径不存在，继续尝试下一个
        }
      }

      toolLogger.warn(`tool=loadSkill skillDir=${safeSkillPath} not found in any skills directory`);
      return errResult(`未找到 skill: ${safeSkillPath}/SKILL.md`, {
        code: "NOT_FOUND",
        message: `Not found in tenant workspace/skills/ or shared/skills/`,
      });
    },
  };
}
