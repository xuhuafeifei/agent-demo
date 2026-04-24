import { readFgbgUserConfig } from "../config/index.js";
import { resolveToolSecurityConfig } from "../agent/tool/security/tool-security.resolve.js";
import { BUILTIN_TOOL_NAMES } from "../agent/tool/builtin-tools.js";
import { createToolBundle } from "../agent/tool/tool-bundle.js";
import { BaseHook } from "./base-hook.js";
import { TOOL_HOOK_KIND, type AgentHookEvent } from "./events.js";

/**
 * 默认工具装配 Hook：
 * - light：不追加 `enabledTools`；仅保留主链路在 run 中预装的「系统必带」基础工具包。
 * - heavy：在系统必带工具之上，追加 `enabledTools`（读/写/bash 等由安全配置决定；与必带去重，避免同工具注册两次）。
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
      // 与 run 约定：light 不叠加用户 enabledTools；主链路仍带系统必带四项（见 builtin-tools）。
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
