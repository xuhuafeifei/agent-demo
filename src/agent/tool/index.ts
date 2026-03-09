import {
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { createAppendTool } from "./append.js";
import { createMemorySearchTool } from "./memory-search.js";
import { createPersistMemoryTool } from "./persist-memory.js";
import { createUpdateTool } from "./update.js";

const AGENT_TOOLINGS: string[] = [
  "read(path, offset?, limit?) - read text from file",
  "write(path, content) - write file content",
  "append(path, content, ensureTrailingNewline?, createIfNotExists?) - append text to file tail",
  "update(path, find, replace, all?, expectedCount?) - literal text replace in file",
  "memorySearch(query, topKFts?, topKVector?, topN?) - retrieve recent memory",
  "persistMemory(filename, content) - persist as .md: USER.md for user info (name, preferences), memory/xxx.md for topic summaries, MEMORY.md for other; append if exists else create",
];

export function getAgentToolings(): string[] {
  return [...AGENT_TOOLINGS];
}

export function createAgentToolBundle(cwd: string) {
  const tools = [createReadTool(cwd), createWriteTool(cwd)];
  const customTools = [
    createAppendTool(cwd),
    createUpdateTool(cwd),
    createMemorySearchTool(),
    createPersistMemoryTool(cwd),
  ];

  return {
    tools,
    customTools,
    toolings: getAgentToolings(),
  };
}
