/**
 * TypeBox `description` 单源：与运行时校验一致，改文案只改此处。
 * 对应 system prompt ## Channel / Channel rules。
 */
export const CHANNEL_TOOL_PARAM_DESC = {
  /** createReminderTask：断言字段 currentChannel */
  runtimeChannel:
    "Current runtime channel from system prompt ## Channel. Must exactly match the process runtime channel.",
  /** createReminderTask：断言字段 currentTenantId */
  runtimeTenantId:
    "Current runtime tenantId from system prompt ## Channel. Must exactly match the process runtime tenantId.",
  /**
   * listTaskSchedules / runTaskByName / deleteTaskByName：参数 tenantId
   */
  tenantIdForSessionTools:
    "Tenant ID for permission checks, routing, and data isolation. Must match the tenantId in system prompt ## Channel.",
  /**
   * createAgentTask：参数 tenantId（允许用户指定其它租户时仍以 Channel 为默认说明）
   */
  tenantIdForAgentTask:
    "Tenant ID for routing and permission checks. Use the tenantId from system prompt ## Channel unless the user specifies another tenant.",
  /** createReminderTask：送达渠道，省略时服务端用运行时 channel */
  sendToChannelReminder:
    "Target channel for reminder delivery. Omit to default to the runtime channel (system prompt ## Channel).",
  /** createReminderTask：送达租户，省略时服务端用运行时 tenantId */
  sendToTenantReminder:
    "Target tenantId for reminder routing. Omit to default to the runtime tenantId (system prompt ## Channel).",
  /** sendIMMessage：送达平台，省略时服务端用运行时 channel（web 场景须显式指定 qq 或 weixin） */
  sendToChannelIMOptional:
    "Target IM platform (qq or weixin). Omit to default to the runtime channel from system prompt ## Channel. If the runtime channel is web, you must specify qq or weixin explicitly.",
} as const;
