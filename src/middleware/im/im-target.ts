import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../utils/app-path.js";

export type IMChannel = "qq" | "weixin";

type IMTargetStore = Partial<Record<IMChannel, string>>;

function dir(): string {
  const d = path.join(resolveStateDir(), "im");
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

function targetPath(): string {
  return path.join(dir(), "targets.json");
}

function readStore(): IMTargetStore {
  try {
    const p = targetPath();
    if (!fs.existsSync(p)) return {};
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as IMTargetStore;
    return typeof raw === "object" && raw ? raw : {};
  } catch {
    return {};
  }
}

function writeStore(store: IMTargetStore): void {
  fs.writeFileSync(targetPath(), `${JSON.stringify(store)}\n`, { mode: 0o600 });
}

export function saveLastIMTarget(channel: IMChannel, userId: string): void {
  const v = userId.trim();
  if (!v) return;
  const store = readStore();
  if (store[channel] === v) return;
  store[channel] = v;
  writeStore(store);
}

export function loadLastIMTarget(channel: IMChannel): string {
  const store = readStore();
  const v = store[channel];
  return typeof v === "string" ? v.trim() : "";
}
