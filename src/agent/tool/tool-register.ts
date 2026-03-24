import { createReadTool, createWriteTool } from "@mariozechner/pi-coding-agent";
import type { ToolRegisterConfig } from "../../types.js";
import {
  getUserFgbgConfig,
  writeFgbgUserConfig,
} from "../../utils/app-path.js";
import { createAppendTool } from "./append.js";
import { createLoadSkillTool } from "./load-skill.js";
import { createMemorySearchTool } from "./memory-search.js";
import { createPersistMemoryTool } from "./persist-memory.js";
import { createUpdateTool } from "./update.js";
import {
  createAgentTaskTool,
  createDeleteTaskTool,
  createListTasksTool,
  createReminderTaskTool,
  createRunTaskTool,
} from "./watch-dog.js";
import {
  getEventBus,
  TOPIC_TOOL_BEFORE_BUILD,
  TOPPIC_HEART_BEAT,
} from "../../event-bus/index.js";

const eventBus = getEventBus();

const DEFAULT_TOOL_REGISTER: ToolRegisterConfig = {
  tools: [],
  customTools: [
    "memorySearch",
    "persistMemory",
    "loadSkill",
    "createReminderTask",
    "createAgentTask",
    "deleteTaskByName",
  ],
  innerTools: ["listTaskSchedules", "runTaskByName", "deleteTaskByName"],
};

type ToolFactory = (cwd: string) => unknown;

const TOOL_REGISTRY: Record<
  string,
  { factory: ToolFactory; description: string }
> = {
  read: {
    factory: (cwd) => createReadTool(cwd),
    description: "read(path, offset?, limit?) - read text from file",
  },
  write: {
    factory: (cwd) => createWriteTool(cwd),
    description: "write(path, content) - write file content",
  },
  append: {
    factory: (cwd) => createAppendTool(cwd),
    description:
      "append(path, content, ensureTrailingNewline?, createIfNotExists?) - append text to file tail",
  },
  update: {
    factory: (cwd) => createUpdateTool(cwd),
    description:
      "update(path, find, replace, all?, expectedCount?) - literal text replace in file",
  },
  memorySearch: {
    factory: () => createMemorySearchTool(),
    description:
      "memorySearch(query, topKFts?, topKVector?, topN?) - retrieve recent memory",
  },
  persistMemory: {
    factory: (cwd) => createPersistMemoryTool(cwd),
    description:
      "persistMemory(filename, content) - persist as .md: USER.md for user info (name, preferences), memory/xxx.md for topic summaries, MEMORY.md for other; append if exists else create",
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
      "createReminderTask(content, scheduleType, time?, runAt?, timezone?, channels?, taskName?) - create execute_reminder scheduled task",
  },
  createAgentTask: {
    factory: () => createAgentTaskTool(),
    description:
      "createAgentTask(goal, scheduleType, time?, runAt?, timezone?, notify?, channels?, mode?, title?, taskName?) - create execute_agent scheduled task",
  },
};

function parseToolList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export type ToolBundle = {
  tools: unknown[];
  customTools: unknown[];
  innerTools: unknown[];
  toolings: string[];
};

/**
 * 工具注册表单例：从 fgbg.json 的 toolRegister 读取配置，按名称解析并装载工具实例。
 * 配置项可为数组或逗号分隔字符串，不支持通配符。
 */
export class ToolRegister {
  private static instance: ToolRegister | null = null;

  private config: ToolRegisterConfig;

  private constructor() {
    eventBus.on(TOPPIC_HEART_BEAT, () => {
      // 重新加载配置
      const newConfig = getUserFgbgConfig();
      if (newConfig.toolRegister != null) {
        this.config = newConfig.toolRegister;
      }
    });

    const userConfig = getUserFgbgConfig();
    if (
      userConfig.toolRegister == null ||
      typeof userConfig.toolRegister !== "object"
    ) {
      const merged = { ...userConfig, toolRegister: DEFAULT_TOOL_REGISTER };
      writeFgbgUserConfig(merged);
      this.config = DEFAULT_TOOL_REGISTER;
    } else {
      this.config = userConfig.toolRegister;
    }
  }

  static getInstance(): ToolRegister {
    if (ToolRegister.instance === null) {
      ToolRegister.instance = new ToolRegister();
    }
    return ToolRegister.instance;
  }

  /** 解析后的工具名列表（不含未注册名称） */
  private resolveNames(list: unknown[]): string[] {
    return list.filter(
      (name): name is string =>
        typeof name === "string" && name in TOOL_REGISTRY,
    );
  }

  /**
   * 根据当前配置为给定 cwd 生成工具实例与说明文案。
   */
  getToolBundle(cwd: string): ToolBundle {
    const toolsNames = this.resolveNames(parseToolList(this.config.tools));
    const customNames = this.resolveNames(
      parseToolList(this.config.customTools),
    );
    const innerNames = this.resolveNames(parseToolList(this.config.innerTools));

    const tools = toolsNames.map((name) => TOOL_REGISTRY[name].factory(cwd));
    const customTools = customNames.map((name) =>
      TOOL_REGISTRY[name].factory(cwd),
    );
    const innerTools = innerNames.map((name) =>
      TOOL_REGISTRY[name].factory(cwd),
    );

    const allNames = [
      ...new Set([...toolsNames, ...customNames, ...innerNames]),
    ];
    const toolings = allNames.map((name) => TOOL_REGISTRY[name].description);

    // 动态工具注入：其他模块可在此时通过 event-bus 同步追加工具
    const dynamicCustomTools: unknown[] = [];
    eventBus.emitSync(TOPIC_TOOL_BEFORE_BUILD, dynamicCustomTools);
    if (dynamicCustomTools.length > 0) {
      customTools.push(...dynamicCustomTools);
    }

    return { tools, customTools, innerTools, toolings };
  }

  /** 返回当前配置下所有启用工具的说明文案（用于 system prompt）。 */
  getToolings(cwd: string): string[] {
    return this.getToolBundle(cwd).toolings;
  }

  /** 返回当前持久化的 toolRegister 配置（只读）。 */
  getConfig(): Readonly<ToolRegisterConfig> {
    return this.config;
  }
}
