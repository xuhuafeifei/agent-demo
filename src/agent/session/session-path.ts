import path from "node:path";
import { resolveStateDir } from "../../utils/app-path.js";

export function resolveSessionDir(): string {
  return path.join(resolveStateDir(), "sessions");
}

export function resolveSessionIndexPath(): string {
  return path.join(resolveSessionDir(), "session.json");
}
