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

// ==================== 环境变量中常见的敏感键模式（用于脱敏） ====================
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

/**
 * 各模式「参考」工具名表（面向文档/展示；运行时 = 系统必带四项 + enabledTools，见 builtin-tools / tool-security.defaults）。
 * 系统必带（全 heavy 预装）：memorySearch、getNow、persistKnowledge、loadSkill — 勿再写入此表以免重复表述。
 */
export const MODE_TOOL_SETS: Record<ToolMode, { tools: string[] }> = {
  safety: {
    tools: [
      "read",
      "write",
      "edit",
      "sendIMMessage",
      "createReminderTask",
      "listTaskSchedules",
    ],
  },
  guard: {
    tools: [
      "read",
      "write",
      "edit",
      "sendIMMessage",
      "createReminderTask",
      "createAgentTask",
      "compactContext",
      "listTaskSchedules",
      "runTaskByName",
      "deleteTaskByName",
      "bash",
      "webSearch",
      "webFetch",
    ],
  },
  yolo: {
    tools: [
      "read",
      "write",
      "edit",
      "sendIMMessage",
      "createReminderTask",
      "createAgentTask",
      "compactContext",
      "bash",
      "listTaskSchedules",
      "runTaskByName",
      "deleteTaskByName",
      "webSearch",
      "webFetch",
    ],
  },
  custom: {
    tools: [
      "read",
      "write",
      "edit",
      "sendIMMessage",
      "createReminderTask",
      "createAgentTask",
      "compactContext",
      "bash",
      "listTaskSchedules",
      "runTaskByName",
      "deleteTaskByName",
      "webSearch",
      "webFetch",
    ],
  },
};
