/**
 * read 工具（createReadTool）行为检验：路径策略、存在性、文本门控、分页。
 * 运行：npm run test:read-tool
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);

const tmpConfigDir = fs.mkdtempSync(path.join(os.homedir(), ".fgbg"));
const cfgPath = path.join(tmpConfigDir, "fgbg.json");

const workspace = fs.mkdtempSync(path.join(os.homedir(), ".fgbg-workspace"));

// 设置配置路径和 workspace 环境变量
process.env.FGBG_CONFIG_PATH = cfgPath;
process.env.FGBG_WORKSPACE_DIR = workspace;

fs.writeFileSync(
  cfgPath,
  JSON.stringify({
    workspaceDir: workspace,
    toolSecurity: {
      preset: "guard",
      approval: { enabled: false },
      access: {
        scope: "workspace",
        allowHiddenFiles: true,
        allowSymlinks: false,
      },
    },
  }),
  "utf8",
);

const { evicateFgbgUserConfigCache } = await import(
  path.join(root, "dist/config/index.js")
);
evicateFgbgUserConfigCache();

const { createReadTool } = await import(
  path.join(root, "dist/agent/tool/func/read.js")
);

const tool = createReadTool(workspace);

async function runRead(params) {
  return tool.execute("test-call", params, undefined, undefined, undefined);
}

test("成功读取 workspace 内文本文件", async () => {
  const filePath = path.join(workspace, "hello.txt");
  // 无末尾换行，split 后行数与肉眼行数一致
  fs.writeFileSync(filePath, "hello\nworld", "utf8");
  const res = await runRead({ path: filePath });
  assert.equal(res.details?.ok, true);
  assert.equal(res.details?.data?.content, "hello\nworld");
  assert.equal(res.details?.data?.totalLines, 2);
});

test("offset / limit 分页", async () => {
  const filePath = path.join(workspace, "lines.txt");
  fs.writeFileSync(filePath, "a\nb\nc", "utf8");
  const res = await runRead({ path: filePath, offset: 1, limit: 1 });
  assert.equal(res.details?.ok, true);
  assert.equal(res.details?.data?.content, "b");
  assert.equal(res.details?.data?.totalLines, 3);
});

test("路径超出 workspace 时拒绝", async () => {
  const outside = path.join(
    os.homedir(),
    `.fgbg`,
    `read-outside-${process.pid}.txt`,
  );
  fs.writeFileSync(outside, "x", "utf8");
  try {
    const res = await runRead({ path: outside });
    assert.equal(res.details?.ok, false);
    assert.equal(res.details?.error?.code, "PATH_OUT_OF_WORKSPACE");
  } finally {
    try {
      fs.unlinkSync(outside);
    } catch {
      /* ignore */
    }
  }
});

test("workspace 内文件不存在 → NOT_FOUND", async () => {
  const missing = path.join(workspace, "no-such-file.txt");
  const res = await runRead({ path: missing });
  assert.equal(res.details?.ok, false);
  assert.equal(res.details?.error?.code, "NOT_FOUND");
});

test("相对路径拒绝（须绝对路径）", async () => {
  const res = await runRead({ path: "relative.txt" });
  assert.equal(res.details?.ok, false);
  assert.equal(res.details?.error?.code, "PATH_OUT_OF_WORKSPACE");
  assert.match(res.details?.error?.message ?? "", /绝对路径/);
});

test("二进制扩展名拒绝（如 .png）", async () => {
  const filePath = path.join(workspace, "x.png");
  fs.writeFileSync(filePath, "not-really-png", "utf8");
  const res = await runRead({ path: filePath });
  assert.equal(res.details?.ok, false);
  assert.equal(res.details?.error?.code, "INVALID_ARGUMENT");
});
