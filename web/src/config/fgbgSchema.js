export const LOG_LEVEL_OPTIONS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
];

export const CONSOLE_STYLE_OPTIONS = ["pretty", "common", "json"];

export const MEMORY_MODE_OPTIONS = ["local", "remote"];
export const THINKING_LEVEL_OPTIONS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export const SETTINGS_SECTIONS = [
  {
    key: "models",
    title: "模型与 Provider",
    fields: [
      { path: "models.mode", label: "模型合并模式", type: "text" },
      {
        path: "agents.defaults.model.primary",
        label: "默认主模型",
        type: "text",
        required: true,
      },
    ],
  },
  {
    key: "agents",
    title: "Agent 行为",
    fields: [
      { path: "agents.retry.baseDelayMs", label: "重试基础延迟(ms)", type: "number", min: 0 },
      { path: "agents.retry.maxRetries", label: "最大重试次数", type: "number", min: 0 },
      { path: "agents.retry.maxDelayMs", label: "重试最大延迟(ms)", type: "number", min: 0 },
      {
        path: "agents.memorySearch.mode",
        label: "记忆检索模式",
        type: "select",
        options: MEMORY_MODE_OPTIONS,
      },
      {
        path: "agents.thinking.web",
        label: "上下文快照等级（Web）",
        type: "select",
        options: THINKING_LEVEL_OPTIONS,
      },
      {
        path: "agents.thinking.qq",
        label: "上下文快照等级（QQ）",
        type: "select",
        options: THINKING_LEVEL_OPTIONS,
      },
      { path: "agents.memorySearch.endpoint", label: "远程检索 endpoint", type: "url" },
      { path: "agents.memorySearch.apiKey", label: "远程检索 API Key", type: "sensitive" },
      { path: "agents.memorySearch.chunkMaxChars", label: "chunk 最大字符数", type: "number", min: 1 },
      { path: "agents.memorySearch.embeddingDimensions", label: "向量维度", type: "number", min: 1 },
      { path: "agents.memorySearch.download.enabled", label: "允许自动下载模型", type: "boolean" },
      { path: "agents.memorySearch.download.url", label: "模型下载地址", type: "url" },
      { path: "agents.memorySearch.download.timeout", label: "下载超时(ms)", type: "number", min: 1000 },
    ],
  },
  {
    key: "toolRegister",
    title: "工具注册",
    fields: [
      { path: "toolRegister", label: "工具注册配置(JSON)", type: "json" },
    ],
  },
  {
    key: "qqbot",
    title: "通道配置（QQBot）",
    fields: [
      { path: "channels.qqbot.enabled", label: "启用 QQBot", type: "boolean" },
      { path: "channels.qqbot.appId", label: "QQ AppId", type: "text" },
      { path: "channels.qqbot.clientSecret", label: "QQ Client Secret", type: "sensitive" },
      { path: "channels.qqbot.targetOpenid", label: "目标 OpenID", type: "text" },
      { path: "channels.qqbot.accounts", label: "账号配置(JSON)", type: "json" },
    ],
  },
  {
    key: "logging-heartbeat",
    title: "日志与运维",
    fields: [
      { path: "logging.cacheTimeSecond", label: "缓存时间(秒)", type: "number", min: 1 },
      { path: "logging.level", label: "日志等级", type: "select", options: LOG_LEVEL_OPTIONS },
      { path: "logging.file", label: "日志文件路径", type: "text", required: true },
      { path: "logging.consoleLevel", label: "控制台日志等级", type: "select", options: LOG_LEVEL_OPTIONS },
      { path: "logging.consoleStyle", label: "控制台输出样式", type: "select", options: CONSOLE_STYLE_OPTIONS },
      { path: "logging.allowModule", label: "允许模块(JSON数组)", type: "json" },
      { path: "heartbeat.enabled", label: "启用心跳", type: "boolean" },
      { path: "heartbeat.intervalMs", label: "心跳间隔(ms)", type: "number", min: 200, max: 60000 },
      { path: "heartbeat.concurrency", label: "心跳并发", type: "number", min: 1, max: 3 },
      { path: "heartbeat.allowedScripts", label: "允许脚本(JSON数组)", type: "json" },
    ],
  },
  {
    key: "meta",
    title: "元信息（只读）",
    fields: [
      { path: "meta.lastTouchedVersion", label: "最后触达版本", type: "text", readOnly: true },
      { path: "meta.lastTouchedAt", label: "最后更新时间", type: "text", readOnly: true },
    ],
  },
];
