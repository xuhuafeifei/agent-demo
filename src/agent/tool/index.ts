import { ToolRegister } from "./tool-register.js";

export type { ToolBundle } from "./tool-register.js";

/** 根据当前配置返回工具说明文案（用于 system prompt），需传入 cwd。 */
export function getAgentToolings(cwd: string): string[] {
  return ToolRegister.getInstance().getToolings(cwd);
}

/** 根据 fgbg.json toolSecurity 配置为给定 cwd 生成工具实例和说明文案。 */
export function createAgentToolBundle(cwd: string) {
  const bundle = ToolRegister.getInstance().getToolBundle(cwd);
  return {
    tools: bundle.tools,
    toolings: bundle.toolings,
    preset: bundle.preset,
  };
}
