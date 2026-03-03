#!/usr/bin/env node

const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);

if (!Number.isFinite(major) || major < 22) {
  console.error(`[runtime-check] Node.js >= 22 is required. Current: ${process.version} (${process.arch}).`);
  console.error('[runtime-check] Please run: nvm use 22.22.0');
  process.exit(1);
}

try {
  await import('node:sqlite');
} catch {
  console.error('[runtime-check] Built-in module node:sqlite is unavailable in this runtime.');
  console.error(`[runtime-check] Current runtime: ${process.version} (${process.arch}).`);
  console.error('[runtime-check] Please switch to Node 22 and restart the server.');
  process.exit(1);
}

console.log(`[runtime-check] OK: ${process.version} (${process.arch}), node:sqlite available.`);
