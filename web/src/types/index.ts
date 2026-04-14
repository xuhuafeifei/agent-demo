/**
 * 共享类型定义
 *
 * 此文件包含整个前端项目使用的核心类型
 */

import type { ReactNode } from "react";

// ============================================================================
// 核心消息类型
// ============================================================================

export interface Message {
  id: string;
  role: "user" | "assistant" | "thinking";
  content: string;
  timestamp: number;
}

export type ToolCallStatus = "running" | "completed" | "failed" | "expired";

export interface ToolCall {
  id: string;
  toolCallId: string;
  kind: string;
  title: string;
  input: string;
  result?: string;
  status: ToolCallStatus;
  detail: string;
  timestamp: number;
}

export interface ContextEvent {
  id: string;
  kind: "snapshot" | "used";
  reason?: string;
  contextText?: string;
  contextWindow?: number;
  totalTokens?: number;
  model?: string;
  timestamp: number;
}

// ============================================================================
// SSE 事件类型
// ============================================================================

export type SSEEventType =
  | "streamStart"
  | "agent_message_chunk"
  | "agent_thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "assistant_break"
  | "context_snapshot"
  | "context_used"
  | "error"
  | "streamEnd"
  | "permission_request";

/**
 * 工具审批请求（SSE payload / 与后端字段对齐）
 */
export interface PermissionRequest {
  toolUseId: string;
  toolName: string;
  args: Record<string, unknown>;
  timestamp: number;
}

export type PermissionRequestStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired";

/**
 * 对话时间线中的审批条目（含 UI 状态）
 */
export interface PermissionTimelineItem {
  id: string;
  toolUseId: string;
  toolName: string;
  args: Record<string, unknown>;
  timestamp: number;
  status: PermissionRequestStatus;
}

/**
 * 消息列表合并项（消息 / 工具调用 / 审批）
 */
export type WrappedMessage =
  | { type: "message"; data: Message; timestamp: number }
  | { type: "tool_call"; data: ToolCall; timestamp: number }
  | {
      type: "permission_request";
      data: PermissionTimelineItem;
      timestamp: number;
    };

// ============================================================================
// 供应商与模型
// ============================================================================

export interface ProviderEntry {
  id: string;
  name: string;
  icon: string | ReactNode;
  enabled: boolean;
  featureCount: number | null;
  isBuiltin: boolean;
  hasApiKey: boolean;
}

export interface ModelOption {
  id: string;
  name: string;
}

// ============================================================================
// Toast 通知
// ============================================================================

export interface ToastMessage {
  id: number;
  type: "success" | "error" | "warning" | "info";
  content: string;
  duration?: number;
}

// ============================================================================
// 表单状态类型 (附录 A)
// ============================================================================

export interface DetailFormState {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: string | number;
  tokenRatio: string | number;
}

export interface LoggingFormState {
  cacheTimeSecond: number;
  level: string;
  logDir: string;
  consoleLevel: string;
  consoleStyle: string;
  allowModule: string[];
}

export interface ChannelsFormState {
  qqbotEnabled: boolean;
  qqbotAppId: string;
  qqbotClientSecret: string;
  /** 与 GET /config/fgbg 的 hasCredentials 对齐：磁盘上是否已有 QQ 密钥 */
  qqbotHasCredentials: boolean;
  qqbotTargetOpenid: string;
  qqbotAccounts: string;
}

export interface MemoryHeartbeatFormState {
  mode: "local" | "remote";
  model: string;
  endpoint: string;
  apiKey: string;
  chunkMaxChars: number;
  embeddingDimensions: number;
  downloadEnabled: boolean;
  downloadUrl: string;
  downloadTimeout: number;
  heartbeatEnabled: boolean;
  intervalMs: number;
  concurrency: number;
  allowedScripts: string;
}

// ============================================================================
// UI 组件类型 (附录 A)
// ============================================================================

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export interface ModelComboboxProps {
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}

export interface ProviderListItemProps {
  provider: ProviderEntry;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

// ============================================================================
// Diff 相关类型 (ContextSnapshotDock)
// ============================================================================

export interface DiffLine {
  type: "add" | "del" | "same";
  line: string;
}

// ============================================================================
// Schema 配置类型
// ============================================================================

export type SchemaFieldType =
  | "text"
  | "number"
  | "boolean"
  | "select"
  | "array"
  | "url"
  | "sensitive"
  | "json";

export interface SchemaField {
  path: string;
  label: string;
  type: SchemaFieldType;
  required?: boolean;
  min?: number;
  max?: number;
  options?: readonly string[];
  readOnly?: boolean;
}

export interface SettingsSection {
  key: string;
  title: string;
  fields: SchemaField[];
}

// ============================================================================
// Settings Tab 类型
// ============================================================================

export interface TabItem {
  key?: string;
  id?: string;
  label: string;
  icon?: ReactNode;
}

export interface ProviderModelConfig {
  providerId: string;
  models: Array<{ id: string; name: string }>;
}
