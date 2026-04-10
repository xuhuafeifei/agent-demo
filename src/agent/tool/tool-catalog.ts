/**
 * 工具目录（静态表）
 *
 * 唯一维护 `Record<工具名, { factory, description }>` 的地方。
 * 不读 fgbg.json、不解析 ToolSecurityConfig。
 * 这是「有哪些工具、怎么 new」的目录；配置里启用谁，不在这里决定。
 */

import { createReadTool } from "./func/read.js";
import { createWriteTool } from "./func/write.js";
import { createLoadSkillTool } from "./func/load-skill.js";
import { createMemorySearchTool } from "./func/memory-search.js";
import { createPersistKnowledgeTool } from "./func/persist-knowledge.js";
import { createCompactContextTool } from "./func/compact-context.js";
import {
  createAgentTaskTool,
  createDeleteTaskTool,
  createGetNowTool,
  createListTasksTool,
  createReminderTaskTool,
  createRunTaskTool,
} from "./func/watch-dog.js";
import { createShellExecuteTool } from "./func/shell-execute.js";
import { createIMSendTool } from "./func/IM-send.js";

type ToolFactory = (cwd: string) => unknown;

type ToolEntry = { factory: ToolFactory; description: string };

/** 与 ToolDefinition.name / enabledTools 中 read、write 对齐；readFile、writeFile 为兼容别名 */
const readToolEntry: ToolEntry = {
  factory: () => createReadTool(),
  description:
    "readFile(path, offset?, limit?) - read text from file (safe, text-only)",
};
const writeToolEntry: ToolEntry = {
  factory: (cwd) => createWriteTool(cwd),
  description:
    "writeFile(path, content) - write file content (safe, text-only)",
};

/**
 * 工具目录：名称 → 工厂函数 + 描述
 * 这是「有哪些工具、怎么实例化」的静态表，不读配置。
 */
export const TOOL_CATALOG: Record<string, ToolEntry> = {
  read: readToolEntry,
  write: writeToolEntry,
  memorySearch: {
    factory: () => createMemorySearchTool(),
    description:
      "memorySearch(query, topKFts?, topKVector?, topN?) - retrieve recent memory",
  },
  persistKnowledge: {
    factory: (cwd) => createPersistKnowledgeTool(cwd),
    description:
      "persistKnowledge - discriminated by type (see JSON schema descriptions on each field): memory → ~/.fgbg/memory/*.md create; userinfo → workspace/userinfo/*.md create with YAML frontmatter and indexed; skill → workspace/skills/<dir>/ SKILL.md create with YAML frontmatter",
  },
  loadSkill: {
    factory: () => createLoadSkillTool(),
    description:
      "loadSkill(skillDir) - load SKILL.md from ~/.fgbg/workspace/skills/<skillDir>/SKILL.md",
  },
  listTaskSchedules: {
    factory: () => createListTasksTool(),
    description:
      "listTaskSchedules() - list all task_schedule entries (status, next run, attempts, last_error)",
  },
  runTaskByName: {
    factory: () => createRunTaskTool(),
    description:
      "runTaskByName(task_name) - set task to pending and next_run_time=now to trigger it immediately",
  },
  deleteTaskByName: {
    factory: () => createDeleteTaskTool(),
    description:
      "deleteTaskByName(task_name) - delete scheduled task and its execution details",
  },
  createReminderTask: {
    factory: () => createReminderTaskTool(),
    description:
      "createReminderTask(content, scheduleType, runAt?, cron?, timezone?, channels?, taskName?) - create execute_reminder scheduled task",
  },
  createAgentTask: {
    factory: () => createAgentTaskTool(),
    description:
      "createAgentTask(goal, scheduleType, runAt?, cron?, timezone?, notify?, channels?, mode?, title?, taskName?) - create execute_agent scheduled task",
  },
  getNow: {
    factory: () => createGetNowTool(),
    description: "getNow(timezone?) - get current time as ISO and unix ms",
  },
  compactContext: {
    factory: () => createCompactContextTool(),
    description: "compactContext() - compress session context to reduce size",
  },
  shellExecute: {
    factory: () => createShellExecuteTool(),
    description:
      "shellExecute(command) - execute whitelisted shell command securely",
  },
  sendIMMessage: {
    factory: () => createIMSendTool(),
    description:
      "sendIMMessage(channel, content) - send text to latest phone IM user (qq/weixin), target user id loaded internally",
  },
};

/** 工具目录名称联合类型（可用于类型约束） */
export type ToolCatalogName = keyof typeof TOOL_CATALOG;
