import { debuglog } from "node:util";

/** 日志级别：数字越大越重要，用于过滤。 */
export const LogLevel = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

export type LogLevelName = keyof typeof LogLevel;

const LEVEL_NAMES: LogLevelName[] = ["debug", "info", "warn", "error"];

/** 从环境变量 LOG_LEVEL 读取（debug | info | warn | error），默认 info。 */
function getMinLevel(): number {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (raw && LEVEL_NAMES.includes(raw as LogLevelName)) {
    return LogLevel[raw as LogLevelName];
  }
  return LogLevel.info;
}

let minLevel = getMinLevel();

/** 是否输出该级别（仅读环境变量一次，后续可调用 setMinLevel 覆盖）。 */
function shouldLog(level: number): boolean {
  return level >= minLevel;
}

/**
 * 设置最低日志级别，低于此级别不输出。
 * 不调用则使用环境变量 LOG_LEVEL（默认 info）。
 */
export function setMinLevel(level: LogLevelName | number): void {
  minLevel = typeof level === "string" ? LogLevel[level] : level;
}

const PREFIX: Record<LogLevelName, string> = {
  debug: "[debug]",
  info: "[info]",
  warn: "[warn]",
  error: "[error]",
};

function write(level: LogLevelName, message: string, ...args: unknown[]): void {
  if (!shouldLog(LogLevel[level])) return;
  const prefix = PREFIX[level];
  const first = `${prefix} ${message}`;
  switch (level) {
    case "debug":
      args.length === 0 ? console.debug(first) : console.debug(first, ...args);
      break;
    case "info":
      args.length === 0 ? console.info(first) : console.info(first, ...args);
      break;
    case "warn":
      args.length === 0 ? console.warn(first) : console.warn(first, ...args);
      break;
    case "error":
      args.length === 0 ? console.error(first) : console.error(first, ...args);
      break;
    default:
      args.length === 0 ? console.log(first) : console.log(first, ...args);
  }
}

/**
 * 带级别的追踪日志。
 * 用法：logTrace("info", "msg")、logTrace("warn", "msg", err)；仅传一条字符串时视为 info：logTrace("msg")。
 * 级别由低到高：debug < info < warn < error；仅当级别 ≥ 当前最低级别时输出。
 * 最低级别来自环境变量 LOG_LEVEL（默认 info），或 setMinLevel()。
 */
export function logTrace(
  levelOrMessage: LogLevelName | string,
  messageOrArg?: string | unknown,
  ...args: unknown[]
): void {
  const isLevel = (x: string): x is LogLevelName =>
    x === "debug" || x === "info" || x === "warn" || x === "error";
  if (isLevel(levelOrMessage) && typeof messageOrArg === "string") {
    write(levelOrMessage, messageOrArg, ...args);
    return;
  }
  if (messageOrArg !== undefined) {
    write("info", levelOrMessage as string, messageOrArg, ...args);
  } else {
    write("info", levelOrMessage as string);
  }
}

/** 仅当 NODE_DEBUG 包含指定 section 时输出，适合大量 debug 日志。 */
export function createDebugTrace(section: string): (message: string, ...args: unknown[]) => void {
  const debug = debuglog(section);
  return (message: string, ...args: unknown[]) => {
    if (args.length === 0) debug(message);
    else debug(message, ...args);
  };
}
