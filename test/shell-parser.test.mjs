import { parseShellCommand } from '../dist/agent/tool/security/shell-parser.js';
import { validateCommandPaths } from '../dist/agent/tool/security/path-validator.js';
import { preExecuteCheck } from '../dist/agent/tool/security/shell-precheck.js';

console.log('=== 测试解析功能 ===');

// 测试简单命令
const test1 = 'ls -la src/';
const result1 = parseShellCommand(test1);
console.log('命令:', test1);
console.log('解析结果:', JSON.stringify(result1, null, 2));

// 测试带路径的命令
const test2 = 'cat /etc/passwd';
const result2 = parseShellCommand(test2);
console.log('\n命令:', test2);
console.log('解析结果:', JSON.stringify(result2, null, 2));

// 测试包含路径参数的命令
const test3 = 'find . -name "*.ts" -type f';
const result3 = parseShellCommand(test3);
console.log('\n命令:', test3);
console.log('解析结果:', JSON.stringify(result3, null, 2));

console.log('\n=== 测试路径验证 ===');

const paths1 = ['/tmp/test.txt', '/etc/passwd', './src/test.ts', '~/Documents/file.md'];
const testPath1 = { paths: paths1 };
const validation1 = validateCommandPaths(testPath1);
console.log('验证路径:', paths1);
console.log('验证结果:', validation1);

console.log('\n=== 测试完整预检流程 ===');

// 测试安全命令
try {
  await preExecuteCheck('ls -la src/');
  console.log('通过: ls -la src/');
} catch (error) {
  console.log('失败: ls -la src/');
  console.error(error);
}

// 测试路径不在允许范围的命令
try {
  await preExecuteCheck('cat /etc/passwd');
  console.log('通过: cat /etc/passwd');
} catch (error) {
  console.log('失败: cat /etc/passwd');
  console.error(error);
}

// 测试可能访问网络的命令
try {
  await preExecuteCheck('curl https://example.com');
  console.log('通过: curl https://example.com');
} catch (error) {
  console.log('失败: curl https://example.com');
  console.error(error);
}

console.log('\n=== 测试完成 ===');
