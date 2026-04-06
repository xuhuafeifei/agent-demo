/**
 * Shell 命令预检模块
 * 功能：
 * 1. 命令长度检查
 * 2. Shell 元字符检测（初版禁止管道、链式命令）
 * 3. 命令白名单验证（basename 匹配）
 * 4. 网络访问检查
 */

import path from 'node:path';
import {
  SHELL_ALLOWLIST,
  containsShellMetacharacters,
} from './constants.js';

export interface SandboxConfig {
  network?: boolean;
}

/**
 * 简单解析命令行为 argv 数组
 * 支持引号包裹的参数
 */
function parseArgvSimple(command: string): string[] {
  const argv: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        argv.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  
  if (current) {
    argv.push(current);
  }
  
  return argv;
}

/**
 * 检查命令是否可能访问网络
 * 简化判断：检查命令名和参数
 */
function mayAccessNetwork(argv: string[]): boolean {
  if (argv.length === 0) return false;
  const bin = path.basename(argv[0]).toLowerCase();
  
  // 明确的网络命令
  const networkCommands = ['curl', 'wget', 'ssh', 'scp', 'ping', 'nslookup', 'dig'];
  if (networkCommands.includes(bin)) return true;
  
  // git 的某些子命令
  if (bin === 'git' && argv[1]) {
    const gitSubcommands = ['clone', 'fetch', 'pull', 'push', 'remote'];
    return gitSubcommands.some(sub => argv[1] === sub);
  }
  
  // npm/yarn/pnpm 的网络操作
  if (['npm', 'yarn', 'pnpm', 'npx'].includes(bin)) {
    const nonNetworkCommands = ['run', 'test', 'lint', 'build', 'start'];
    return !argv[1] || !nonNetworkCommands.includes(argv[1]);
  }
  
  return false;
}

/**
 * Shell 命令预检
 * 
 * @param command 命令字符串
 * @param config 沙箱配置
 * @throws 如果命令不合法
 */
export async function preExecuteCheck(
  command: string,
  config?: SandboxConfig,
): Promise<void> {
  // 1. 长度检查
  if (command.length > 10000) {
    throw new Error('命令过长（超过 10000 字符）');
  }
  
  // 2. Shell 元字符检查（初版直接拒绝）
  if (containsShellMetacharacters(command)) {
    throw new Error('不支持管道与链式 shell（初版）');
  }
  
  // 3. 解析命令
  const argv = parseArgvSimple(command);
  if (argv.length === 0) {
    throw new Error('命令不能为空');
  }
  
  // 4. 白名单验证（basename）
  const bin = path.basename(argv[0]);
  if (!SHELL_ALLOWLIST.has(bin)) {
    throw new Error(`命令 '${bin}' 不在允许列表中`);
  }
  
  // 5. 网络访问检查
  if (!config?.network && mayAccessNetwork(argv)) {
    throw new Error(`网络类命令 '${bin}' 已禁用`);
  }
}
