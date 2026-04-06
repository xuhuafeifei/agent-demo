/**
 * 安全相关常量：扩展名集合、Shell 白名单、全局黑名单路径
 * 单一数据源，供路径检查、文件类型判定、Shell 预检使用
 */

// ==================== 文件扩展名集合 ====================

/** 明确的文本文件扩展名 */
export const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".toml",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".mjs",
  ".cjs",
  ".d.ts",
  ".py",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".c",
  ".cpp",
  ".cc",
  ".cxx",
  ".h",
  ".hpp",
  ".hxx",
  ".java",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".lua",
  ".r",
  ".R",
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".env",
  ".env.example",
  ".env.local",
  ".env.development",
  ".env.production",
  ".gitignore",
  ".dockerignore",
  ".npmignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
  ".csv",
  ".tsv",
  ".log",
  ".ini",
  ".cfg",
  ".conf",
  ".properties",
  ".vue",
  ".svelte",
  ".astro",
]);

/** 明确的二进制文件扩展名 */
export const BINARY_EXTENSIONS = new Set([
  // 可执行文件
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".a",
  ".lib",
  ".o",
  ".obj",
  ".bin",
  ".cmd",
  ".com",
  // 图片
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".svg",
  ".tiff",
  ".tif",
  // 音频/视频
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wav",
  ".mkv",
  ".flv",
  ".wmv",
  ".webm",
  ".aac",
  ".flac",
  ".ogg",
  ".m4a",
  // 压缩文件
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".xz",
  ".zst",
  // 文档
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  // 数据库/镜像
  ".db",
  ".sqlite",
  ".sqlite3",
  ".iso",
  ".img",
  // Java/字节码
  ".class",
  ".jar",
  ".war",
  ".ear",
  // Python
  ".pyc",
  ".pyo",
  ".pyd",
  ".whl",
  // 字体
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
  // 其他
  ".wasm",
  ".map",
]);

// ==================== Shell 命令白名单 ====================

/**
 * 初版 Shell 命令白名单（basename）
 * 跨平台：macOS/Linux 通过 PATH 解析，Windows 需额外处理
 */
export const SHELL_ALLOWLIST = new Set([
  // 文件与文本
  "cat",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "grep",

  // 路径与目录
  "pwd",
  "ls",
  "dirname",
  "basename",
  "find",
  "tree",

  // 运行时与包管理
  "node",
  "npm",
  "npx",
  "corepack",
  "pnpm",
  "yarn",

  // 版本控制
  "git",

  // 系统与调试信息
  "uname",
  "hostname",
  "date",
  "whoami",
  "which",
  "where",
  "type",
  "command",

  // 其它安全小工具
  "echo",
  "printf",
  "test",
  "[",
  "sleep",
  "true",
  "false",
  "jq", // JSON 处理

  // 网络（受限）
  "curl",
  "wget", // 后续可按需移除
]);

/** 明确禁止的危险命令 */
export const SHELL_DENYLIST = new Set([
  "rm",
  "dd",
  "mkfs",
  "mkfs.ext4",
  "mkfs.vfat",
  "ssh",
  "scp",
  "sftp",
  "sudo",
  "su",
  "chmod",
  "chown",
  "chgrp",
  "kill",
  "killall",
  "pkill",
  "reboot",
  "shutdown",
  "halt",
  "poweroff",
  "iptables",
  "ufw",
  "firewall-cmd",
]);

/** 环境变量中常见的敏感键模式（用于脱敏） */
export const SENSITIVE_ENV_PATTERNS = [
  "API_KEY",
  "SECRET",
  "TOKEN",
  "PASSWORD",
  "PRIVATE_KEY",
  "CREDENTIAL",
  "AUTH",
  "ACCESS_KEY",
  "SECRET_KEY",
];

// ==================== 全局路径白名单 ====================

/**
 * 临时目录全局白名单（跨平台）
 * 在 checkPathSafety 中优先级最高：路径规范化后先于作用域与黑白名单；不受 scope 限制，且先于全局/用户黑名单。
 */
export const TEMP_PATH_WHITELIST = [
  // POSIX (macOS/Linux)
  "/tmp",
  "/tmp/**",
  "/var/tmp",
  "/var/tmp/**",
  // Windows 系统级临时目录
  "C:/Windows/Temp",
  "C:/Windows/Temp/**",
  // Windows 用户级临时目录（%TEMP% 通常指向这里）
  "**/AppData/Local/Temp",
  "**/AppData/Local/Temp/**",
];

// ==================== 全局路径黑名单 ====================

/** POSIX 系统（macOS/Linux）全局黑名单 */
export const GLOBAL_DENY_PATHS_POSIX = [
  "**/.env",
  "**/.bash_profile",
  "**/.bashrc",
  "**/.zshrc",
  "**/.profile",
  "**/.zsh_profile",
  "**/.zprofile",
  "**/.zlogin",
  "**/.zlogout",
  "**/.zlogout",
  "**/.env.*",
  "**/.secrets",
  "**/.ssh/**",
  "**/.gnupg/**",
  "**/.aws/**",
  "**/.azure/**",
  "**/.gcloud/**",
  "/etc/**",
  "/System/**", // macOS
  "/private/**", // macOS
  "/usr/bin/**", // 系统二进制，可按需调整
  "/usr/sbin/**",
  "/var/root/**", // macOS root 用户
];

/** Windows 全局黑名单 */
export const GLOBAL_DENY_PATHS_WIN = [
  "**/.ssh/**",
  "**/.aws/**",
  "**/NTUSER.DAT",
  "**/Cookies/**",
  "C:/Windows/System32/config/**",
  "C:/Windows/System32/drivers/**",
  "**/.env",
];

// ==================== 模式工具集合定义 ====================

export type ToolMode = "safety" | "guard" | "yolo" | "custom";

/** 各模式内置工具表（代码内自带默认） */
export const MODE_TOOL_SETS: Record<ToolMode, { tools: string[] }> = {
  safety: {
    tools: [
      "read",
      "write",
      "memorySearch",
      "persistKnowledge",
      "loadSkill",
      "getNow",
      "shiftTime",
      "createReminderTask",
      "listTaskSchedules",
    ],
  },
  guard: {
    tools: [
      "read",
      "write",
      "memorySearch",
      "persistKnowledge",
      "loadSkill",
      "createReminderTask",
      "createAgentTask",
      "compactContext",
      "getNow",
      "shiftTime",
      "listTaskSchedules",
      "runTaskByName",
      "deleteTaskByName",
    ],
  },
  yolo: {
    tools: [
      "read",
      "write",
      "memorySearch",
      "persistKnowledge",
      "loadSkill",
      "createReminderTask",
      "createAgentTask",
      "compactContext",
      "shellExecute",
      "getNow",
      "shiftTime",
      "listTaskSchedules",
      "runTaskByName",
      "deleteTaskByName",
    ],
  },
  custom: {
    // 需要用户自己设置配置文件
    tools: [
      "read",
      "write",
      "append",
      "update",
      "memorySearch",
      "persistKnowledge",
      "loadSkill",
      "createReminderTask",
      "createAgentTask",
      "compactContext",
      "shellExecute",
      "getNow",
      "shiftTime",
      "listTaskSchedules",
      "runTaskByName",
      "deleteTaskByName",
    ],
  },
};

// ==================== Shell 元字符检测 ====================

/** 初版禁止的 Shell 元字符（防止管道、子 shell、链式命令） */
export const SHELL_METACHARACTERS_REGEX = /[|;&`$(){}<>!\\]/;

/**
 * 检测命令是否包含危险的 Shell 元字符
 * 初版直接拒绝包含这些字符的命令
 */
export function containsShellMetacharacters(command: string): boolean {
  return SHELL_METACHARACTERS_REGEX.test(command);
}
