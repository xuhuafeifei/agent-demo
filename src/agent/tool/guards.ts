import path from "node:path";
import type { ToolError } from "./types.js";

function normalizeWorkspace(workspace: string): string {
  return path.resolve(workspace);
}

export function resolvePathInWorkspace(
  workspace: string,
  inputPath: string,
): { ok: true; value: string } | { ok: false; error: ToolError } {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "path 不能为空" },
    };
  }

  const root = normalizeWorkspace(workspace);
  const target = path.resolve(root, trimmed);
  const rel = path.relative(root, target);
  const inWorkspace =
    rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));

  if (!inWorkspace) {
    return {
      ok: false,
      error: {
        code: "PATH_OUT_OF_WORKSPACE",
        message: `路径超出工作区: ${inputPath}`,
      },
    };
  }

  return { ok: true, value: target };
}
