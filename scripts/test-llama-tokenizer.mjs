import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { getLlama } from "node-llama-cpp";

const DEFAULT_MODEL_NAME = "nomic-embed-text-v1.5.Q4_K_M";
const DEFAULT_EMBEDDING_DIR = path.join(
  os.homedir(),
  ".fgbg",
  "workspace",
  "embedding",
);

function parseArgs(argv) {
  const args = { model: "", verbose: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--model" && argv[i + 1]) {
      args.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--verbose") {
      args.verbose = true;
    }
  }
  return args;
}

function normalizeModelName(name) {
  return name
    .toLowerCase()
    .replace(/\.gguf$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function resolveModelPath(inputModel) {
  const requested = (inputModel || DEFAULT_MODEL_NAME).trim();
  const direct = requested.startsWith("~")
    ? path.join(os.homedir(), requested.slice(1))
    : requested;

  if (path.isAbsolute(direct) && fs.existsSync(direct)) {
    return direct;
  }

  // 仅从本地 embedding 目录挑选 GGUF，避免误扫其他目录。
  const files = fs
    .readdirSync(DEFAULT_EMBEDDING_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".gguf"))
    .map((entry) => path.join(DEFAULT_EMBEDDING_DIR, entry.name));

  if (files.length === 0) {
    throw new Error(`No .gguf model found in ${DEFAULT_EMBEDDING_DIR}`);
  }

  const target = normalizeModelName(path.basename(direct));
  if (target) {
    const exact = files.find(
      (candidate) => normalizeModelName(path.basename(candidate)) === target,
    );
    if (exact) return exact;

    const fuzzy = files.find((candidate) =>
      normalizeModelName(path.basename(candidate)).includes(target),
    );
    if (fuzzy) return fuzzy;
  }

  return files[0];
}

function buildSamples() {
  // 覆盖英文、中文、混合符号、换行和空格等常见输入形态。
  return [
    "hello world",
    "中文测试：今天天气不错。",
    "混合文本 with numbers 12345 and symbols !@#$%^&*()",
    "line1\nline2\nline3",
    "trim  spaces   around",
    "nomic embedding tokenization check",
  ];
}

function printMismatch(index, original, roundtrip, tokenCount, verbose) {
  console.log(`\n[${index}] mismatch`);
  console.log(`tokens: ${tokenCount}`);
  if (verbose) {
    console.log(`original : ${JSON.stringify(original)}`);
    console.log(`roundtrip: ${JSON.stringify(roundtrip)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const modelPath = resolveModelPath(args.model);

  console.log(`[llama-tokenizer] model: ${modelPath}`);
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });

  const samples = buildSamples();
  let mismatchCount = 0;

  // roundtrip: 文本 -> token ids -> 文本，用于验证 tokenizer 是否稳定。
  for (let i = 0; i < samples.length; i += 1) {
    const text = samples[i];
    const tokens = model.tokenize(text);
    const roundtrip = model.detokenize(tokens);
    const same = text === roundtrip;
    if (!same) {
      mismatchCount += 1;
      printMismatch(i + 1, text, roundtrip, tokens.length, args.verbose);
    } else {
      console.log(`[${i + 1}] ok tokens=${tokens.length}`);
    }
  }

  console.log("\n[summary]");
  console.log(`samples: ${samples.length}`);
  console.log(`mismatch: ${mismatchCount}`);
  console.log(`embeddingVectorSize: ${model.embeddingVectorSize}`);
  console.log(
    mismatchCount === 0
      ? "tokenizer roundtrip: PASS"
      : "tokenizer roundtrip: WARN (model/tokenizer may be incompatible)",
  );
}

await main();
