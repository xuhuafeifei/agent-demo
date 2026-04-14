/**
 * 环境变量传递测试
 * 验证 execFile 是否能正确传递环境变量到子进程
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { parse } from "shell-quote";

const promisifiedExecFile = promisify(execFile);

console.log("=== 1. process.env 快照 ===");
console.log("USER:", process.env.USER ?? "(undefined)");
console.log("HOME:", process.env.HOME ?? "(undefined)");
console.log("PATH:", process.env.PATH?.slice(0, 50) ?? "(undefined)");
console.log("env keys:", Object.keys(process.env).length);

console.log("\n=== 2. 不传 env（Node 默认继承） ===");
try {
  const { stdout } = await promisifiedExecFile(
    os.platform() === "win32" ? "cmd.exe" : "bash",
    os.platform() === "win32" ? ["/c", "echo $USER && echo $HOME"] : ["-c", "echo USER=$USER && echo HOME=$HOME"],
  );
  console.log("stdout:", stdout.trim());
} catch (e) {
  console.log("error:", e.message);
}

console.log("\n=== 3. 传 env: process.env ===");
try {
  const { stdout } = await promisifiedExecFile(
    os.platform() === "win32" ? "cmd.exe" : "bash",
    os.platform() === "win32" ? ["/c", "echo $USER && echo $HOME"] : ["-c", "echo USER=$USER && echo HOME=$HOME"],
    { env: process.env },
  );
  console.log("stdout:", stdout.trim());
} catch (e) {
  console.log("error:", e.message);
}

console.log("\n=== 4. 传 env: { ...process.env }（浅拷贝） ===");
try {
  const { stdout } = await promisifiedExecFile(
    os.platform() === "win32" ? "cmd.exe" : "bash",
    os.platform() === "win32" ? ["/c", "echo $USER && echo $HOME"] : ["-c", "echo USER=$USER && echo HOME=$HOME"],
    { env: { ...process.env } },
  );
  console.log("stdout:", stdout.trim());
} catch (e) {
  console.log("error:", e.message);
}

console.log("\n=== 5. 传 env: { ...process.env, MY_VAR=hello } ===");
try {
  const { stdout } = await promisifiedExecFile(
    os.platform() === "win32" ? "cmd.exe" : "bash",
    os.platform() === "win32" ? ["/c", "echo $USER && echo $HOME && echo MY=$MY_VAR"] : ["-c", "echo USER=$USER && echo HOME=$HOME && echo MY=$MY_VAR"],
    { env: { ...process.env, MY_VAR: "hello" } },
  );
  console.log("stdout:", stdout.trim());
} catch (e) {
  console.log("error:", e.message);
}

console.log("\n=== 6. shell-quote 解析测试 ===");
const testCmd = 'echo $USER && echo "hello world"';
const parsed = parse(testCmd);
console.log("input:", testCmd);
console.log("parsed:", JSON.stringify(parsed, null, 2));
