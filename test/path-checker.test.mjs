/**
 * 路径安全检查（checkPathSafety / user-home / ~）的独立测试。
 * 运行：npm run test:path-checker（会先 tsc，再对 dist 跑 node:test）
 */
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);

const { checkPathSafety } = await import(
  path.join(root, "dist/agent/tool/security/path-checker.js")
);
const { DEFAULT_GUARD_CONFIG } = await import(
  path.join(root, "dist/agent/tool/security/tool-security.defaults.js")
);

function userHomeConfig() {
  return {
    ...DEFAULT_GUARD_CONFIG,
    access: { ...DEFAULT_GUARD_CONFIG.access, scope: "user-home" },
  };
}

/** 显式 workspace 作用域（与 preset 默认值无关，用于断言「仅工作区」行为） */
function workspaceOnlyConfig() {
  return {
    ...DEFAULT_GUARD_CONFIG,
    access: { ...DEFAULT_GUARD_CONFIG.access, scope: "workspace" },
  };
}

const homedir = path.resolve(os.homedir());
const workspaceTmp = path.join(os.homedir(), ".fgbg");

test("user-home：主目录下的绝对路径允许（workspace 在别处）", async () => {
  const underHome = path.join(homedir, ".path-checker-does-not-need-to-exist");
  const r = await checkPathSafety(underHome, workspaceTmp, userHomeConfig());
  assert.equal(r.allowed, true);
  assert.equal(r.realPath, underHome);
});

test("user-home：仅落在 workspace 下的路径允许", async () => {
  const underWs = path.join(workspaceTmp, "only-in-workspace.txt");
  const r = await checkPathSafety(underWs, workspaceTmp, userHomeConfig());
  assert.equal(r.allowed, true);
  assert.equal(r.realPath, underWs);
});

test("workspace：仅允许 workspace 子路径，主目录下路径拒绝", async () => {
  const underHome = path.join(homedir, ".path-checker-not-in-ws");
  const r = await checkPathSafety(
    underHome,
    workspaceTmp,
    workspaceOnlyConfig(),
  );
  assert.equal(r.allowed, false);
  assert.match(r.reason ?? "", /工作区/);
});

test("workspace：workspace 子路径允许", async () => {
  const underWs = path.join(workspaceTmp, "in-ws.txt");
  const r = await checkPathSafety(
    underWs,
    workspaceTmp,
    workspaceOnlyConfig(),
  );
  assert.equal(r.allowed, true);
});

test("workspace 作用域下系统临时目录仍允许（临时目录白名单优先于作用域）", async () => {
  // 与 TEMP_PATH_WHITELIST 对齐：macOS 上 os.tmpdir() 常在 /var/folders，未必命中白名单
  const underTmp =
    process.platform === "win32"
      ? path.join(os.tmpdir(), "path-checker-temp-allow.txt")
      : path.join("/tmp", "path-checker-temp-allow.txt");
  const r = await checkPathSafety(
    underTmp,
    workspaceTmp,
    workspaceOnlyConfig(),
  );
  assert.equal(r.allowed, true);
  assert.equal(r.realPath, path.resolve(underTmp));
});

test("`~` 展开与 os.homedir() 一致", async () => {
  const suffix = "path-checker-tilde-sub";
  const r = await checkPathSafety(
    `~/${suffix}`,
    workspaceTmp,
    userHomeConfig(),
  );
  assert.equal(r.allowed, true);
  assert.equal(r.realPath, path.join(homedir, suffix));
});

test("`~` 无后缀段时解析为主目录本身", async () => {
  const r = await checkPathSafety("~", workspaceTmp, userHomeConfig());
  assert.equal(r.allowed, true);
  assert.equal(r.realPath, homedir);
});

test("`~用户名` 拒绝（避免误解析为当前主目录下子路径）", async () => {
  const r = await checkPathSafety(
    "~alice/.bashrc",
    workspaceTmp,
    userHomeConfig(),
  );
  assert.equal(r.allowed, false);
  assert.match(r.reason ?? "", /不支持 `~用户名`/);
});

test("/root/ 路径拒绝", async () => {
  const r = await checkPathSafety("/root/", workspaceTmp, userHomeConfig());
  assert.equal(r.allowed, false);
  assert.match(r.reason ?? "", /路径超出允许的用户目录范围/);
});

test("相对路径拒绝", async () => {
  const r = await checkPathSafety("../", workspaceTmp, userHomeConfig());
  assert.equal(r.allowed, false);
  assert.match(r.reason ?? "", /请使用绝对路径/);
});


test("~/.env 先展开为 os.homedir()/.env 再命中黑名单（与绝对路径一致）", async () => {
  const absEnv = path.join(homedir, ".env");
  const viaTilde = await checkPathSafety("~/.env", workspaceTmp, userHomeConfig());
  const viaAbs = await checkPathSafety(absEnv, workspaceTmp, userHomeConfig());
  assert.equal(viaTilde.realPath, absEnv, "~/.env 应展开为与 path.join(homedir, '.env') 相同");
  assert.equal(viaAbs.realPath, absEnv);
  assert.equal(viaTilde.allowed, false);
  assert.equal(viaAbs.allowed, false);
  assert.match(viaTilde.reason ?? "", /路径不允许访问/);
});

test("Windows 风格 ~\\.env 同样展开后命中黑名单", async () => {
  const absEnv = path.join(homedir, ".env");
  const r = await checkPathSafety("~\\.env", workspaceTmp, userHomeConfig());
  assert.equal(r.realPath, absEnv);
  assert.equal(r.allowed, false);
  assert.match(r.reason ?? "", /路径不允许访问/);
});