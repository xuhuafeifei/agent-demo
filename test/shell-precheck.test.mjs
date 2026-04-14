/**
 * shellPrecheck 单测
 * 运行：tsc && node --test test/shell-precheck.test.mjs
 *
 * 测试目标：shellPrecheck 的核心业务逻辑
 * - 白名单命令放行
 * - 非白名单命令拒绝
 * - 路径参数合法放行
 * - 路径参数非法拒绝
 * - 命令解析正确性
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);

const { shellPrecheck } = await import(
  path.join(root, "dist/agent/tool/security/shell-precheck.js")
);
const { DEFAULT_GUARD_CONFIG } = await import(
  path.join(root, "dist/agent/tool/security/tool-security.defaults.js")
);

// 创建临时工作区
const TEST_WORKSPACE = path.join(
  os.tmpdir(),
  `shell-precheck-test-${Date.now()}`,
);

function cleanup() {
  if (fs.existsSync(TEST_WORKSPACE)) {
    fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  }
}

function setup() {
  cleanup();
  fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
  fs.writeFileSync(path.join(TEST_WORKSPACE, ".env"), "SECRET=test");
  fs.mkdirSync(path.join(TEST_WORKSPACE, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(TEST_WORKSPACE, "src", "index.ts"),
    "console.log('hi')",
  );
}

function teardown() {
  cleanup();
}

/** 默认配置（workspace scope，不允许隐藏文件） */
function workspaceOnlyConfig() {
  return {
    ...DEFAULT_GUARD_CONFIG,
    access: {
      ...DEFAULT_GUARD_CONFIG.access,
      scope: "workspace",
      allowHiddenFiles: false,
    },
  };
}

// ===========================================================================
// 白名单验证
// ===========================================================================

test("白名单命令放行: git status", async () => {
  setup();
  try {
    const result = await shellPrecheck(
      "git status",
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    assert.equal(result.command, "git");
    assert.deepEqual(result.args, ["status"]);
  } finally {
    teardown();
  }
});

test("白名单命令放行: ls -la", async () => {
  setup();
  try {
    const result = await shellPrecheck(
      "ls -la",
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    assert.equal(result.command, "ls");
    assert.deepEqual(result.args, ["-la"]);
  } finally {
    teardown();
  }
});

test("白名单命令放行: cat 绝对路径", async () => {
  setup();
  try {
    // 使用绝对路径（workspace 内），相对路径会被 checkPathSafety 拒绝
    const absPath = path.join(TEST_WORKSPACE, "src", "index.ts");
    const result = await shellPrecheck(
      `cat ${absPath}`,
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    assert.equal(result.command, "cat");
    assert.deepEqual(result.args, [absPath]);
  } finally {
    teardown();
  }
});

test("非白名单命令拒绝: rm -rf /tmp", async () => {
  setup();
  try {
    await assert.rejects(
      () => shellPrecheck("rm -rf /tmp", TEST_WORKSPACE, workspaceOnlyConfig()),
      /不在允许列表中/,
    );
  } finally {
    teardown();
  }
});

test("非白名单命令拒绝: sudo ls", async () => {
  setup();
  try {
    await assert.rejects(
      () => shellPrecheck("sudo ls", TEST_WORKSPACE, workspaceOnlyConfig()),
      /不在允许列表中/,
    );
  } finally {
    teardown();
  }
});

test("非白名单命令拒绝: chmod 777", async () => {
  setup();
  try {
    await assert.rejects(
      () => shellPrecheck("chmod 777 .", TEST_WORKSPACE, workspaceOnlyConfig()),
      /不在允许列表中/,
    );
  } finally {
    teardown();
  }
});

test("非白名单命令拒绝: kill", async () => {
  setup();
  try {
    await assert.rejects(
      () => shellPrecheck("kill 1234", TEST_WORKSPACE, workspaceOnlyConfig()),
      /不在允许列表中/,
    );
  } finally {
    teardown();
  }
});

test("空命令拒绝", async () => {
  setup();
  try {
    await assert.rejects(
      () => shellPrecheck("", TEST_WORKSPACE, workspaceOnlyConfig()),
      /命令不能为空/,
    );
  } finally {
    teardown();
  }
});

// ===========================================================================
// 路径安全检查
// ===========================================================================

test("工作区内绝对路径放行: cat <workspace>/src/index.ts", async () => {
  setup();
  try {
    const absPath = path.join(TEST_WORKSPACE, "src", "index.ts");
    const result = await shellPrecheck(
      `cat ${absPath}`,
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    assert.equal(result.command, "cat");
  } finally {
    teardown();
  }
});

test("工作区外绝对路径拒绝: cat /etc/passwd", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck("cat /etc/passwd", TEST_WORKSPACE, workspaceOnlyConfig()),
      /不允许访问/,
    );
  } finally {
    teardown();
  }
});

test("隐藏文件拒绝: cat .env", async () => {
  setup();
  try {
    await assert.rejects(
      () => shellPrecheck("cat .env", TEST_WORKSPACE, workspaceOnlyConfig()),
      /不允许访问/,
    );
  } finally {
    teardown();
  }
});

test("~ 路径拒绝（超出 workspace 范围）", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck(
          "cat ~/.ssh/id_rsa",
          TEST_WORKSPACE,
          workspaceOnlyConfig(),
        ),
      /不允许访问/,
    );
  } finally {
    teardown();
  }
});

test("相对路径拒绝: cat ./src/index.ts", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck(
          "cat ./src/index.ts",
          TEST_WORKSPACE,
          workspaceOnlyConfig(),
        ),
      /不允许访问/,
    );
  } finally {
    teardown();
  }
});

// ===========================================================================
// 敏感环境变量检查
// ===========================================================================

test("敏感环境变量拦截: echo $CFL_TOKEN 拒绝", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck("echo $CFL_TOKEN", TEST_WORKSPACE, workspaceOnlyConfig()),
      /敏感环境变量/,
    );
  } finally {
    teardown();
  }
});

test("敏感环境变量拦截: echo $API_KEY 拒绝", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck("echo $API_KEY", TEST_WORKSPACE, workspaceOnlyConfig()),
      /敏感环境变量/,
    );
  } finally {
    teardown();
  }
});

test("敏感环境变量拦截: echo ${SECRET_KEY} 拒绝", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck(
          "echo ${SECRET_KEY}",
          TEST_WORKSPACE,
          workspaceOnlyConfig(),
        ),
      /敏感环境变量/,
    );
  } finally {
    teardown();
  }
});

test("敏感环境变量放行: echo $HOME 允许（非敏感变量）", async () => {
  setup();
  try {
    const result = await shellPrecheck(
      "echo $HOME",
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    assert.equal(result.command, "echo");
  } finally {
    teardown();
  }
});

test("敏感环境变量不影响非输出命令: git status 不需要检查", async () => {
  setup();
  try {
    const result = await shellPrecheck(
      "git status",
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    assert.equal(result.command, "git");
  } finally {
    teardown();
  }
});

// ===========================================================================
// 元字符拦截
// ===========================================================================

test("元字符拦截: 管道 | 拒绝", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck(
          "cat /tmp/log | grep error",
          TEST_WORKSPACE,
          workspaceOnlyConfig(),
        ),
      /不允许使用管道/,
    );
  } finally {
    teardown();
  }
});

test("元字符拦截: 分号 ; 拒绝", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck(
          "cat file.txt; rm -rf /tmp",
          TEST_WORKSPACE,
          workspaceOnlyConfig(),
        ),
      /不允许使用分号/,
    );
  } finally {
    teardown();
  }
});

test("元字符拦截: 命令替换 $() 拒绝", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck("echo $(whoami)", TEST_WORKSPACE, workspaceOnlyConfig()),
      /不允许使用命令替换/,
    );
  } finally {
    teardown();
  }
});

test("元字符拦截: 反引号拒绝", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck("echo `whoami`", TEST_WORKSPACE, workspaceOnlyConfig()),
      /不允许使用反引号/,
    );
  } finally {
    teardown();
  }
});

test("元字符拦截: 输出重定向 > 拒绝", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck(
          "echo hello > /tmp/out.txt",
          TEST_WORKSPACE,
          workspaceOnlyConfig(),
        ),
      /不允许使用输出重定向/,
    );
  } finally {
    teardown();
  }
});

test("元字符拦截: 输入重定向 < 拒绝", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck(
          "cat < /tmp/in.txt",
          TEST_WORKSPACE,
          workspaceOnlyConfig(),
        ),
      /不允许使用输入重定向/,
    );
  } finally {
    teardown();
  }
});

test("元字符拦截: 后台执行 & 拒绝", async () => {
  setup();
  try {
    await assert.rejects(
      () => shellPrecheck("sleep 10 &", TEST_WORKSPACE, workspaceOnlyConfig()),
      /不允许使用后台执行/,
    );
  } finally {
    teardown();
  }
});

test("元字符放行: && 允许", async () => {
  setup();
  try {
    const result = await shellPrecheck(
      "pwd && ls",
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    // && 允许通过，但 shell-quote 会把它当作分隔符
    assert.equal(result.command, "pwd");
  } finally {
    teardown();
  }
});

// ===========================================================================
// 命令解析正确性
// ===========================================================================

test("正确解析带参数的命令: git diff HEAD~1", async () => {
  setup();
  try {
    const result = await shellPrecheck(
      "git diff HEAD~1",
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    assert.equal(result.command, "git");
    assert.deepEqual(result.args, ["diff", "HEAD~1"]);
  } finally {
    teardown();
  }
});

test('正确处理带引号的参数: git commit -m "fix"', async () => {
  setup();
  try {
    const result = await shellPrecheck(
      'git commit -m "fix: update config"',
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    assert.equal(result.command, "git");
    assert.ok(result.args.includes("commit"));
  } finally {
    teardown();
  }
});

test("no-path-args 命令不需要路径检查: whoami", async () => {
  setup();
  try {
    const result = await shellPrecheck(
      "whoami",
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    assert.equal(result.command, "whoami");
    assert.deepEqual(result.args, []);
  } finally {
    teardown();
  }
});

test("no-path-args 命令不需要路径检查: pwd", async () => {
  setup();
  try {
    const result = await shellPrecheck(
      "pwd",
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    assert.equal(result.command, "pwd");
    assert.deepEqual(result.args, []);
  } finally {
    teardown();
  }
});

test("no-path-args 命令不需要路径检查: echo hello", async () => {
  setup();
  try {
    const result = await shellPrecheck(
      "echo hello world",
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    assert.equal(result.command, "echo");
    assert.deepEqual(result.args, ["hello", "world"]);
  } finally {
    teardown();
  }
});

// ===========================================================================
// mayHavePathArgs 标记边界
// ===========================================================================

test("mayHavePathArgs=false 的命令不触发路径检查: npm run build", async () => {
  setup();
  try {
    const result = await shellPrecheck(
      "npm run build",
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    assert.equal(result.command, "npm");
    assert.deepEqual(result.args, ["run", "build"]);
  } finally {
    teardown();
  }
});

test("mayHavePathArgs=false 的命令: pnpm install", async () => {
  setup();
  try {
    const result = await shellPrecheck(
      "pnpm install",
      TEST_WORKSPACE,
      workspaceOnlyConfig(),
    );
    assert.equal(result.command, "pnpm");
  } finally {
    teardown();
  }
});

test("echo $CFL_TOKEN 不放行", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck("echo $CFL_TOKEN", TEST_WORKSPACE, workspaceOnlyConfig()),
      /命令引用了敏感环境变量/,
    );
  } finally {
    teardown();
  }
});

test("echo $CFL_TOKEN_ABAB 不放行", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck(
          "echo $CFL_TOKEN_ABAB",
          TEST_WORKSPACE,
          workspaceOnlyConfig(),
        ),
      /命令引用了敏感环境变量/,
    );
  } finally {
    teardown();
  }
});

test("echo $API_KEY 不放行", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck("echo $API_KEY", TEST_WORKSPACE, workspaceOnlyConfig()),
      /命令引用了敏感环境变量/,
    );
  } finally {
    teardown();
  }
});

test("echo $HHHAPI_KEYBBB 不放行", async () => {
  setup();
  try {
    await assert.rejects(
      () =>
        shellPrecheck(
          "echo $HHHAPI_KEYBBB",
          TEST_WORKSPACE,
          workspaceOnlyConfig(),
        ),
      /命令引用了敏感环境变量/,
    );
  } finally {
    teardown();
  }
});
