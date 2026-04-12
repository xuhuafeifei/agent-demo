/**
 * 工具目录（静态表）
 *
 * 唯一维护 `Record<工具名, { factory, description }>` 的地方。
 * factory 签名统一为 (cwd: string, tenantId: string) => unknown：
 *   - cwd：租户 workspace 目录，用于路径安全检查和文件操作
 *   - tenantId：租户 ID，用于获取 agent 运行状态（channel）和路由 bot 账号
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

/** 工具工厂函数签名：cwd 为租户 workspace 目录，tenantId 为租户 ID */
type ToolFactory = (cwd: string, tenantId: string) => unknown;

type ToolEntry = { factory: ToolFactory; description: string };

/** 与 ToolDefinition.name / enabledTools 中 read、write 对齐；readFile、writeFile 为兼容别名 */
const readToolEntry: ToolEntry = {
  factory: (_cwd, tenantId) => createReadTool(tenantId),
  description: "readFile(path, offset?, limit?) - read text from file (safe, text-only)",
};
const writeToolEntry: ToolEntry = {
  factory: (cwd, tenantId) => createWriteTool(cwd, tenantId),
  description: "writeFile(path, content) - write file content (safe, text-only)",
};

/**
 * 工具目录：名称 → 工厂函数 + 描述
 * 这是「有哪些工具、怎么实例化」的静态表，不读配置。
 */
export const TOOL_CATALOG: Record<string, ToolEntry> = {
  read: readToolEntry,
  write: writeToolEntry,
  memorySearch: {
    factory: (_cwd, tenantId) => createMemorySearchTool(tenantId),
    description: "memorySearch(query, topKFts?, topKVector?, topN?) - retrieve recent memory",
  },
  persistKnowledge: {
    factory: (_cwd, tenantId) => createPersistKnowledgeTool(tenantId),
    description:
      "persistKnowledge - discriminated by type: memory → workspace/memory/*.md; userinfo → workspace/userinfo/*.md; skill → workspace/skills/<path>/SKILL.md",
  },
  loadSkill: {
    factory: (_cwd, tenantId) => createLoadSkillTool(tenantId),
    description:
      "loadSkill(skillDir) - load SKILL.md from tenant workspace/skills/<skillDir>/ or shared/skills/<skillDir>/",
  },
  listTaskSchedules: {
    factory: (_cwd, tenantId) => createListTasksTool(tenantId),
    description: "listTaskSchedules() - list task_schedule entries (default sees all; others see own)",
  },
  runTaskByName: {
    factory: (_cwd, tenantId) => createRunTaskTool(tenantId),
    description: "runTaskByName(task_name) - set task to pending and next_run_time=now to trigger it immediately",
  },
  deleteTaskByName: {
    factory: (_cwd, tenantId) => createDeleteTaskTool(tenantId),
    description: "deleteTaskByName(task_name) - delete scheduled task (default can delete any; others only own)",
  },
  createReminderTask: {
    factory: (_cwd, tenantId) => createReminderTaskTool(tenantId),
    description:
      "createReminderTask(content, scheduleType, runAt?, cron?, timezone?, channels?, tenantId?, taskName?) - create execute_reminder task",
  },
  createAgentTask: { // todo: 这个任务干啥的完全忘了，以后调研一下
    factory: (_cwd, tenantId) => createAgentTaskTool(tenantId),
    description:
      "createAgentTask(goal, scheduleType, runAt?, cron?, timezone?, notify?, channels?, mode?, title?, taskName?) - create execute_agent scheduled task",
  },
  getNow: {
    factory: () => createGetNowTool(),
    description: "getNow(timezone?) - get current time as ISO and unix ms",
  },
  compactContext: {
    factory: (_cwd, tenantId) => createCompactContextTool(tenantId),
    description: "compactContext() - compress session context to reduce size",
  },
  shellExecute: {
    factory: (_cwd, tenantId) => createShellExecuteTool(tenantId),
    description: "shellExecute(command) - execute whitelisted shell command securely",
  },
  sendIMMessage: {
    factory: (_cwd, tenantId) => createIMSendTool(tenantId),
    description: "sendIMMessage(channel, content, tenantId) - send text to phone IM user (qq/weixin)",
  },
};

/** 工具目录名称联合类型 */
export type ToolCatalogName = keyof typeof TOOL_CATALOG;
