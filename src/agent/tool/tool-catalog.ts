/**
 * 工具目录（Tool Catalog）—— 静态注册表
 *
 * 核心职责：
 * - 集中定义「系统中有哪些工具」的静态映射表：名称 → factory
 * - 这是唯一的「工具注册点」，新增工具只需在此处添加条目
 * - 不读取任何配置，仅定义「有什么」和「怎么实例化」
 * - 工具说明文案（description）只在各工具工厂返回的 ToolDefinition 中维护一份，
 *   createToolBundle / ToolHook 会从实例上读取并写入 system prompt ## Toolings
 *
 * 工具按功能类别组织：
 * - 系统必带（builtin-tools，与 enabledTools 无关）：memorySearch、getNow、persistKnowledge、loadSkill
 * - 文件 / 工程类（典型仅 heavy + enabledTools）：read、write、edit、bash 等
 * - 文件操作：read、write
 * - 知识管理：memorySearch、persistKnowledge、loadSkill
 * - 任务调度：listTaskSchedules、runTaskByName、deleteTaskByName、createReminderTask、createAgentTask、getNow
 * - 上下文管理：compactContext
 * - 系统执行：shellExecute
 * - IM 通信：sendIMMessage
 *
 * tenantId 对工具行为的影响：
 * - 大多数工具接收 tenantId 后，用于限定操作范围（只访问该租户的 workspace）
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
import { createBashTool } from "./func/bash.js";
import { createEditTool } from "./func/edit.js";
import { createIMSendTool } from "./func/IM-send.js";
import { createWebSearchTool } from "./func/web-search.js";
import { createWebFetchTool } from "./func/web-fetch.js";
import type { AgentChannel } from "../channel-policy.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ToolCheckSpec } from "./security/security-wrapper.js";
import {
  CHANNEL_RUNTIME_MISMATCH_HINT_IM_SEND,
  CHANNEL_RUNTIME_MISMATCH_HINT_REMINDER,
} from "./utils/channel-runtime-assert.js";
import { BUILTIN_TOOL_NAMES, type BuiltinToolName } from "./builtin-tools.js";

export type RuntimeToolDefinition = ToolDefinition<any, any>;

/** 工具工厂函数签名：agentId 为本次运行实例键 `agent:{module}:{tenantId}`，与 agent-state 表一致 */
type ToolFactory = (
  cwd: string,
  tenantId: string,
  channel: AgentChannel,
  agentId: string,
) => RuntimeToolDefinition;

/** 工具目录条目：工厂函数 + 可选的安全检查规格 */
export type ToolEntry = {
  factory: ToolFactory;
  /** 安全检查规格，createToolBundle 装配时自动织入 */
  checks?: ToolCheckSpec[];
};

/**
 * 工具目录：名称 → 工厂函数（模块内可扩展；对外请用 {@link TOOL_CATALOG} 只读视图）。
 */
const TOOL_CATALOG_INTERNAL = {
  // ===== 文件操作 =====
  read: {
    factory: (_cwd, tenantId, channel, agentId) =>
      createReadTool(tenantId, channel, agentId),
    checks: [
      { type: "pathCheck", param: "path" },
      { type: "approval", param: "path", description: "读取文件" },
    ],
  },
  write: {
    factory: (cwd, tenantId, channel, agentId) =>
      createWriteTool(cwd, tenantId, channel, agentId),
    checks: [
      { type: "pathCheck", param: "path" },
      { type: "approval", param: "path", description: "写入文件" },
    ],
  },
  edit: {
    factory: (cwd, tenantId, channel, agentId) =>
      createEditTool(tenantId, channel, agentId),
    checks: [
      { type: "pathCheck", param: "path" },
      { type: "approval", param: "path", description: "编辑文件" },
    ],
  },

  // ===== 知识管理（tenantId 用于定位租户专属的知识库路径） =====
  memorySearch: {
    factory: (_cwd, tenantId, _channel, _agentId) =>
      createMemorySearchTool(tenantId),
  },
  persistKnowledge: {
    factory: (_cwd, tenantId, _channel, _agentId) =>
      createPersistKnowledgeTool(tenantId),
  },
  loadSkill: {
    factory: (_cwd, tenantId, _channel, _agentId) =>
      createLoadSkillTool(tenantId),
  },

  // ===== 任务调度（tenantId 用于区分任务归属，非 default 租户只能操作自己的任务） =====
  listTaskSchedules: {
    factory: (_cwd, tenantId, _channel, _agentId) =>
      createListTasksTool(tenantId),
    checks: [{ type: "tenantPermissionAssert", tenantParam: "tenantId" }],
  },
  runTaskByName: {
    factory: (_cwd, tenantId, _channel, _agentId) => createRunTaskTool(tenantId),
    checks: [{ type: "tenantPermissionAssert", tenantParam: "tenantId" }],
  },
  deleteTaskByName: {
    factory: (_cwd, tenantId, _channel, _agentId) =>
      createDeleteTaskTool(tenantId),
    checks: [{ type: "tenantPermissionAssert", tenantParam: "tenantId" }],
  },
  createReminderTask: {
    factory: (_cwd, tenantId, channel, _agentId) =>
      createReminderTaskTool(tenantId, channel),
    checks: [
      {
        type: "channelRuntimeAssert",
        channelParam: "currentChannel",
        tenantParam: "currentTenantId",
        mismatchHint: CHANNEL_RUNTIME_MISMATCH_HINT_REMINDER,
      },
      { type: "tenantPermissionAssert", tenantParam: "sendToTenantId" },
    ],
  },
  createAgentTask: {
    // todo: 这个任务干啥的完全忘了，以后调研一下
    factory: (_cwd, tenantId, _channel, _agentId) =>
      createAgentTaskTool(tenantId),
    checks: [{ type: "tenantPermissionAssert", tenantParam: "tenantId" }],
  },

  // ===== 工具类 =====
  getNow: {
    factory: (_cwd, _tenantId, _channel, _agentId) => createGetNowTool(),
  },

  // ===== 上下文管理 =====
  compactContext: {
    factory: (_cwd, tenantId, _channel, _agentId) =>
      createCompactContextTool(tenantId),
  },

  // ===== 系统执行（tenantId 用于 bash 执行的权限控制和日志归属） =====
  bash: {
    factory: (_cwd, tenantId, channel, agentId) =>
      createBashTool(tenantId, channel, agentId),
    checks: [
      { type: "approval", param: "command", description: "执行命令" },
    ],
  },

  // ===== IM 通信（tenantId 用于路由到对应 bot 账号和 channel） =====
  sendIMMessage: {
    factory: (_cwd, tenantId, channel, _agentId) =>
      createIMSendTool(tenantId, channel),
    checks: [
      {
        type: "channelRuntimeAssert",
        channelParam: "currentChannel",
        tenantParam: "currentTenantId",
        mismatchHint: CHANNEL_RUNTIME_MISMATCH_HINT_IM_SEND,
      },
      { type: "tenantPermissionAssert", tenantParam: "sendToTenantId" },
    ],
  },

  // ===== 网络工具 =====
  webSearch: {
    factory: (_cwd, _tenantId, _channel, _agentId) => createWebSearchTool(),
  },
  webFetch: {
    factory: (_cwd, _tenantId, _channel, _agentId) => createWebFetchTool(),
  },
} satisfies Record<string, ToolEntry>;

/**
 * 只读工具目录：供包外与其它模块只读使用（不要依赖可变性）。
 */
export const TOOL_CATALOG: Readonly<typeof TOOL_CATALOG_INTERNAL> =
  TOOL_CATALOG_INTERNAL;

/** 用户可勾选/配置的工具子集（已排除 {@link BUILTIN_TOOL_NAMES}） */
export const CHOOSEABLE_TOOLS_CATALOG = {
  ...Object.fromEntries(
    Object.entries(TOOL_CATALOG_INTERNAL).filter(([key]) =>
      !(BUILTIN_TOOL_NAMES as readonly string[]).includes(key),
    ),
  ),
} as Readonly<Omit<typeof TOOL_CATALOG_INTERNAL, BuiltinToolName>>;

/**
 * 与 {@link TOOL_CATALOG} 同步的 Map，便于按名 O(1) 取条目（装配用户勾选工具等）。
 */
export const TOOL_ENTRY_BY_NAME: ReadonlyMap<string, ToolEntry> = new Map(
  Object.entries(TOOL_CATALOG_INTERNAL),
);

/**
 * 工具目录名称联合类型
 * 用于类型安全地引用工具名，如：ToolCatalogName = "read" | "write" | "memorySearch" | ...
 */
export type ToolCatalogName = keyof typeof TOOL_CATALOG_INTERNAL;
