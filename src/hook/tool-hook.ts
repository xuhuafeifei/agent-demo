import { readFgbgUserConfig } from "../config/index.js";
import { resolveToolSecurityConfig } from "../agent/tool/security/tool-security.resolve.js";
import { BUILTIN_TOOL_NAMES } from "../agent/tool/builtin-tools.js";
import { createToolBundle } from "../agent/tool/tool-bundle.js";
import { BaseHook } from "./base-hook.js";
import { TOOL_HOOK_KIND, type AgentHookEvent } from "./events.js";

/**
 * 默认工具装配 Hook：
 * - light：主链路不预装工具，event.tools 已为空；此处不追加工具，避免误清空主链路为 heavy 装配的内容。
 * - heavy：在 event 已有内置工具基础上追加用户配置工具（排除内置名避免重复）。
 */
export class ToolHook extends BaseHook<AgentHookEvent> {
  readonly name = "tool";

  priority(): number {
    return 50;
  }

  async onEvent(event: AgentHookEvent): Promise<void> {
    if (event.kind !== TOOL_HOOK_KIND) return;

    const config = readFgbgUserConfig();
    const securityConfig = resolveToolSecurityConfig(config.toolSecurity);

    if (event.lane === "light") {
      // 与 run 约定：light 不在主链路预装内置，此处勿置空 tools，以免与「主链路先装内置」的演进冲突。
      // 若将来主链路对全 lane 预装，需在此显式清空以维持 light 零工具会话。
      return;
    }

    const userBundle = createToolBundle(
      event.cwd,
      event.tenantId,
      event.channel,
      event.agentId,
      securityConfig.enabledTools, // heavy 模式，获取用户设置的工具
    );
    event.tools = [...event.tools, ...userBundle.tools];
    event.toolings = [...event.toolings, ...userBundle.toolings];
  }
}
