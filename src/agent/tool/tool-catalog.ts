/**
 * 工具目录（Tool Catalog）—— 静态注册表
 *
 * 核心职责：
 * - 集中定义「系统中有哪些工具」的静态映射表：名称 → { factory, description }
 * - 这是唯一的「工具注册点」，新增工具只需在此处添加条目
 * - 不读取任何配置，仅定义「有什么」和「怎么实例化」
 *
 * 工具按功能类别组织：
 * - 文件操作：read、write
 * - 知识管理：memorySearch、persistKnowledge、loadSkill
 * - 任务调度：listTaskSchedules、runTaskByName、deleteTaskByName、createReminderTask、createAgentTask、getNow
 * - 上下文管理：compactContext
 * - 系统执行：shellExecute
 * - IM 通信：sendIMMessage
 *
 * tenantId 对工具行为的影响：
 * - 大多数工具接收 tenantId 后，用于限定操作范围（如只访问该租户的 workspace）
 * - IM 工具根据 tenantId 路由到对应的 bot 账号和 channel
 * - 任务调度工具根据 tenantId 区分任务归属（非 default 租户只能操作自己的任务）
 * - 部分工具忽略 cwd（用 _cwd 表示），因为只依赖 tenantId 即可
 * - getNow 是唯一的无状态工具，不需要 cwd 或 tenantId
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
import { createWebSearchTool } from "./func/web-search.js";
import { createWebFetchTool } from "./func/web-fetch.js";

/** 工具工厂函数签名：cwd 为租户 workspace 目录，tenantId 为租户 ID */
type ToolFactory = (cwd: string, tenantId: string) => unknown;

/** 工具目录条目：包含工厂函数和说明文案 */
type ToolEntry = { factory: ToolFactory; description: string };

/**
 * read 工具条目 —— readFile(path, offset?, limit?)
 * 注意：read 不使用 cwd（用 _cwd 表示），因为 tenantId 已足够定位文件路径
 * readFile 是兼容别名，实际工具名为 read
 */
const readToolEntry: ToolEntry = {
  factory: (_cwd, tenantId) => createReadTool(tenantId),
  description: "readFile(path, offset?, limit?) - read text from file (safe, text-only)",
};

/**
 * write 工具条目 —— writeFile(path, content)
 * 使用 cwd 进行路径安全检查（防止写入 workspace 外部），使用 tenantId 路由 bot 通知
 * writeFile 是兼容别名，实际工具名为 write
 */
const writeToolEntry: ToolEntry = {
  factory: (cwd, tenantId) => createWriteTool(cwd, tenantId),
  description: "writeFile(path, content) - write file content (safe, text-only)",
};

/**
 * 工具目录：名称 → 工厂函数 + 描述
 *
 * 这是「有哪些工具、怎么实例化」的静态表，不读配置。
 * 每个工具条目包含：
 *   - factory(cwd, tenantId)：实例化工具，返回工具对象
 *   - description：工具用法说明，用于 system prompt
 *
 * tenantId 影响说明：
 *   - 使用 tenantId 的工具：限定操作范围、路由 bot 账号、区分任务归属
 *   - 忽略 cwd 的工具（_cwd）：只依赖 tenantId 即可工作
 *   - 完全无参数的工具：如 getNow，与租户无关
 */
export const TOOL_CATALOG: Record<string, ToolEntry> = {
  // ===== 文件操作 =====
  read: readToolEntry,
  write: writeToolEntry,

  // ===== 知识管理（tenantId 用于定位租户专属的知识库路径） =====
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

  // ===== 任务调度（tenantId 用于区分任务归属，非 default 租户只能操作自己的任务） =====
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

  // ===== 工具类 =====
  getNow: {
    factory: () => createGetNowTool(), // 无状态工具，不需要 cwd 或 tenantId
    description: "getNow(timezone?) - get current time as ISO and unix ms",
  },

  // ===== 上下文管理 =====
  compactContext: {
    factory: (_cwd, tenantId) => createCompactContextTool(tenantId),
    description: "compactContext() - compress session context to reduce size",
  },

  // ===== 系统执行（tenantId 用于 shell 执行的权限控制和日志归属） =====
  shellExecute: {
    factory: (_cwd, tenantId) => createShellExecuteTool(tenantId),
    description: "shellExecute(command) - execute whitelisted shell command securely",
  },

  // ===== IM 通信（tenantId 用于路由到对应 bot 账号和 channel） =====
  sendIMMessage: {
    factory: (_cwd, tenantId) => createIMSendTool(tenantId),
    description: "sendIMMessage(channel, content, tenantId) - send text to phone IM user",
  },

  // ===== 网络工具 =====
  webSearch: {
    factory: () => createWebSearchTool(),
    description: "webSearch(query, limit?) - search the web for information",
  },
  webFetch: {
    factory: () => createWebFetchTool(),
    description: "webFetch(url, prompt) - fetch and extract content from a URL",
  },
};

/**
 * 工具目录名称联合类型
 * 用于类型安全地引用工具名，如：ToolCatalogName = "read" | "write" | "memorySearch" | ...
 */
export type ToolCatalogName = keyof typeof TOOL_CATALOG;
