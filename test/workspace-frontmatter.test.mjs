/**
 * workspace frontmatter（parseFrontmatterMeta / buildMarkdownWithFrontmatter）测试。
 * 运行：pnpm run test:workspace-frontmatter（先 tsc，再对 dist 跑 node:test）
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);

const { parseFrontmatterMeta, buildMarkdownWithFrontmatter } = await import(
  path.join(root, "dist/agent/workspace.js")
);

/** GitHub 上常见的 skill YAML 片段（多行块标量），外包 Markdown frontmatter 分隔符 */
const githubStyleSkill = `---
name: example_skill
description: |
  This is a multi-line
  description that should
  work properly
---

# Skill body
Do something useful.
`;

test("GitHub 风格：多行 description（| 块标量）解析正确", () => {
  const parsed = parseFrontmatterMeta(githubStyleSkill);
  assert.ok(parsed);
  assert.equal(parsed.name, "example_skill");
  assert.equal(
    parsed.description,
    [
      "This is a multi-line",
      "description that should",
      "work properly",
    ].join("\n"),
  );
});

test("普通场景：单行 name / description", () => {
  const md = `---
name: my_doc
description: Short one-line summary
---

Content here.
`;
  assert.deepEqual(parseFrontmatterMeta(md), {
    name: "my_doc",
    description: "Short one-line summary",
  });
});

test("普通场景：双引号与特殊字符", () => {
  const md = `---
name: "quoted: name"
description: "Say \\"hi\\""
---

x
`;
  const parsed = parseFrontmatterMeta(md);
  assert.ok(parsed);
  assert.equal(parsed.name, "quoted: name");
  assert.equal(parsed.description, 'Say "hi"');
});

test("buildMarkdownWithFrontmatter 与 parseFrontmatterMeta 往返一致", () => {
  const name = 'Skill "A"';
  const description = "Line1\nLine2\nLine3";
  const built = buildMarkdownWithFrontmatter({
    name,
    description,
    body: "## Body\n\nok",
  });
  assert.deepEqual(parseFrontmatterMeta(built), { name, description });
  assert.match(built, /^---\n/);
  assert.match(built, /\n---\n\n## Body/);
});

test("错误场景：无 YAML frontmatter（纯正文）→ null", () => {
  assert.equal(parseFrontmatterMeta("# Title\n\nNo header here."), null);
  assert.equal(parseFrontmatterMeta(""), null);
});

test("错误场景：仅有开头 --- 无闭合 → null", () => {
  assert.equal(
    parseFrontmatterMeta("---\nname: x\ndescription: y\n"),
    null,
  );
});

test("错误场景：YAML 非法 → null", () => {
  assert.equal(parseFrontmatterMeta("---\nname: [\n---\n"), null);
});

test("错误场景：缺 name 或 description → null", () => {
  assert.equal(parseFrontmatterMeta("---\nname: only\n---\n"), null);
  assert.equal(parseFrontmatterMeta("---\ndescription: only\n---\n"), null);
});
