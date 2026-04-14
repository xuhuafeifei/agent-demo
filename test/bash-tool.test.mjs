/**
 * bash 工具单测
 * 运行：tsc && node --test test/bash-tool.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bash-tool-test-"));
const cfgPath = path.join(tmpDir, "fgbg.json");
process.env.FGBG_CONFIG_PATH = cfgPath;

fs.writeFileSync(
  cfgPath,
  JSON.stringify({
    workspaceDir: process.cwd(),
    toolSecurity: {
      preset: "guard",
      approval: { enabled: false },
    },
  }),
  "utf8",
);

const { evicateFgbgUserConfigCache } = await import(
  path.join(root, "dist/config/index.js")
);
evicateFgbgUserConfigCache();

const { createBashTool } = await import(path.join(root, "dist/agent/tool/func/bash.js"));

test("USER 缺失时，echo $USER 仍返回当前用户名", async () => {
  const tool = createBashTool("tenant-test", "web", "agent-test");
  const originalUser = process.env.USER;
  delete process.env.USER;

  try {
    const res = await tool.execute(
      "test-call",
      { command: "echo $USER" },
      undefined,
      undefined,
      undefined,
    );

    assert.equal(res.details?.ok, true);
    assert.equal(res.details?.data?.stdout, os.userInfo().username);
  } finally {
    if (originalUser === undefined) {
      delete process.env.USER;
    } else {
      process.env.USER = originalUser;
    }
  }
});

test("HOME 缺失时，echo $HOME 仍返回当前 home 目录", async () => {
  const tool = createBashTool("tenant-test", "web", "agent-test");
  const originalHome = process.env.HOME;
  delete process.env.HOME;

  try {
    const res = await tool.execute(
      "test-call",
      { command: "echo $HOME" },
      undefined,
      undefined,
      undefined,
    );

    assert.equal(res.details?.ok, true);
    assert.equal(res.details?.data?.stdout, os.homedir());
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }
});
