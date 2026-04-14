import { api, request, type ApiSuccess, type ApiError } from "./client";

export type ToolMode = "safety" | "guard" | "yolo" | "custom";

export interface AccessConfig {
  scope: "workspace" | "user-home" | "system";
  allowHiddenFiles: boolean;
  allowSymlinks: boolean;
}

export interface ApprovalConfig {
  enabled: boolean;
  requireApprovalFor: string[];
  timeoutMs: number;
}

export type UnapprovableStrategy = "skip" | "reject";

export interface ToolSecurityConfig {
  preset: ToolMode;
  enabledTools: string[];
  denyPaths: string | string[];
  access: AccessConfig;
  approval: ApprovalConfig;
  unapprovableStrategy: UnapprovableStrategy;
}

export interface ToolSecurityResponse {
  config: ToolSecurityConfig;
  availableTools: string[];
}

export interface ToolSecurityImportResponse {
  config: ToolSecurityConfig;
}

export const toolSecurityApi = {
  /** 获取工具安全配置 */
  getConfig: async (): Promise<ToolSecurityResponse> => {
    const res = await request<ToolSecurityResponse>(
      `${api.baseURL}/config/tool-security`,
    );
    if (!res.success) throw new Error((res as ApiError).error);
    return res;
  },

  /** 保存工具安全配置 */
  saveConfig: async (
    config: ToolSecurityConfig,
  ): Promise<ToolSecurityResponse> => {
    const res = await request<ToolSecurityResponse>(
      `${api.baseURL}/config/tool-security`,
      {
        method: "PATCH",
        body: JSON.stringify({ config }),
      },
    );
    if (!res.success) throw new Error((res as ApiError).error);
    return res;
  },

  /** 重置工具安全配置 */
  resetConfig: async (): Promise<ToolSecurityResponse> => {
    const res = await request<ToolSecurityResponse>(
      `${api.baseURL}/config/tool-security/reset`,
      {
        method: "POST",
      },
    );
    if (!res.success) throw new Error((res as ApiError).error);
    return res;
  },

  /** 从内置模式导入配置 */
  importFromPreset: async (
    preset: ToolMode,
  ): Promise<ToolSecurityImportResponse> => {
    const res = await request<ToolSecurityImportResponse>(
      `${api.baseURL}/config/tool-security/import/${preset}`,
      { method: "POST" },
    );
    if (!res.success) throw new Error((res as ApiError).error);
    return res;
  },
};
