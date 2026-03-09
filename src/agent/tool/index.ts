import { ToolRegister } from "./tool-register.js";

export type { ToolBundle } from "./tool-register.js";

/** 根据当前 toolRegister 配置返回工具说明文案（用于 system prompt），需传入 cwd。 */
export function getAgentToolings(cwd: string): string[] {
  return ToolRegister.getInstance().getToolings(cwd);
}

/** 根据 fgbg.json toolRegister 配置为给定 cwd 生成 tools / customTools / toolings；innerTools 合并进 customTools 传给 session。 */
export function createAgentToolBundle(cwd: string) {
  const bundle = ToolRegister.getInstance().getToolBundle(cwd);
  return {
    tools: bundle.tools,
    customTools: [...bundle.customTools, ...bundle.innerTools],
    toolings: bundle.toolings,
  };
}
