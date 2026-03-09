#!/usr/bin/env node
/** 把 src/public 拷到 dist/public，保证 node dist/server.js 能直接读到静态文件 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src", "public");
const dest = path.join(root, "dist", "public");

if (!fs.existsSync(src)) {
  console.warn("[copy-public] src/public 不存在，跳过");
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });
for (const name of fs.readdirSync(src)) {
  const srcPath = path.join(src, name);
  const destPath = path.join(dest, name);
  fs.copyFileSync(srcPath, destPath);
}
console.log("[copy-public] 已复制 src/public -> dist/public");
