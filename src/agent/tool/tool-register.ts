import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";
import { createLoadSkillTool } from "./load-skill.js";
import { createMemorySearchTool } from "./memory-search.js";
import { createPersistKnowledgeTool } from "./persist-knowledge.js";
import { createCompactContextTool } from "./compact-context.js";
import {
  createAgentTaskTool,
  createDeleteTaskTool,
  createGetNowTool,
  createListTasksTool,
  createReminderTaskTool,
  createRunTaskTool,
  createShiftTimeTool,
} from "./watch-dog.js";
import { createShellExecuteTool } from "./shell-execute.js";
import { getEventBus, TOPIC_TOOL_BEFORE_BUILD } from "../../event-bus/index.js";
import { readFgbgUserConfig } from "../../config/index.js";
import { resolveToolSecurityConfig, type ToolMode } from "./security/types.js";

const eventBus = getEventBus();

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

/** 工具注册表：名称 → 工厂函数 + 描述 */
const TOOL_REGISTRY: Record<string, ToolEntry> = {
  read: readToolEntry,
  readFile: readToolEntry,
  write: writeToolEntry,
  writeFile: writeToolEntry,
  memorySearch: {
    factory: () => createMemorySearchTool(),
    description:
      "memorySearch(query, topKFts?, topKVector?, topN?) - retrieve recent memory",
  },
  persistKnowledge: {
    factory: (cwd) => createPersistKnowledgeTool(cwd),
    description:
      "persistKnowledge - discriminated by type (see JSON schema descriptions on each field): memory → ~/.fgbg/memory/*.md append/create; userinfo → workspace/userinfo/*.md overwrite+YAML frontmatter+indexed; skill → workspace/skills/<dir>/ SKILL.md+meta.json overwrite",
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
  shiftTime: {
    factory: () => createShiftTimeTool(),
    description:
      "shiftTime(time, offset_seconds) - shift HH:mm by seconds (wraps around 24h)",
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
};

export type ToolBundle = {
  /** 工具实例列表 */
  tools: unknown[];
  /** 工具说明文案列表（用于 system prompt） */
  toolings: string[];
  /** 当前预设模式 */
  preset: ToolMode;
};

/**
 * 工具注册表单例：从 fgbg.json 的 toolSecurity 读取配置，按名称解析并装载工具实例。
 * 完全由 ToolSecurityConfig 管理，不再区分 tools/customTools/innerTools。
 */
export class ToolRegister {
  private static instance: ToolRegister;

  private constructor() {}

  static getInstance(): ToolRegister {
    if (!ToolRegister.instance) {
      ToolRegister.instance = new ToolRegister();
    }
    return ToolRegister.instance;
  }

  /**
   * 返回需要从 session 历史对话记录（context）中过滤掉的工具名列表。
   * 下述工具的返回值本就会成为系统提示词的一部分，因此不应该出现在历史对话信息中
   */
  getFilterContextToolNames(): string[] {
    return [
      "memorySearch",
      "persistKnowledge",
      "loadSkill",
      "read",
      "reminderTask",
    ];
  }

  /**
   * 根据当前配置为给定 cwd 生成工具实例与说明文案。
   * 工具列表完全由 toolSecurity.enabledTools 决定。
   */
  getToolBundle(cwd: string): ToolBundle {
    const config = readFgbgUserConfig();
    const securityConfig = resolveToolSecurityConfig(config.toolSecurity);

    // 从 enabledTools 过滤出已注册的工具
    const enabledToolNames = securityConfig.enabledTools.filter(
      (name): name is string =>
        typeof name === "string" && name in TOOL_REGISTRY,
    );

    const tools = enabledToolNames.map((name) =>
      TOOL_REGISTRY[name].factory(cwd),
    );
    const toolings = enabledToolNames.map(
      (name) => TOOL_REGISTRY[name].description,
    );

    // 动态工具注入：其他模块可在此时通过 event-bus 同步追加工具
    const dynamicTools: unknown[] = [];
    eventBus.emitSync(TOPIC_TOOL_BEFORE_BUILD, dynamicTools);
    if (dynamicTools.length > 0) {
      tools.push(...dynamicTools);
    }

    return {
      tools,
      toolings,
      preset: securityConfig.preset || "guard",
    };
  }

  /** 返回当前配置下所有启用工具的说明文案（用于 system prompt）。 */
  getToolings(cwd: string): string[] {
    return this.getToolBundle(cwd).toolings;
  }

  /** 返回当前安全配置的预设模式 */
  getPreset(): ToolMode {
    const config = readFgbgUserConfig();
    const securityConfig = resolveToolSecurityConfig(config.toolSecurity);
    return securityConfig.preset || "guard";
  }

  /** 返回当前审批配置 */
  getApprovalConfig() {
    const config = readFgbgUserConfig();
    const securityConfig = resolveToolSecurityConfig(config.toolSecurity);
    return securityConfig.approval;
  }

  /** 检查某个工具是否需要审批 */
  requiresApproval(toolName: string): boolean {
    const approvalConfig = this.getApprovalConfig();
    if (!approvalConfig.enabled) return false;
    return approvalConfig.requireApprovalFor?.includes(toolName) || false;
  }
}
