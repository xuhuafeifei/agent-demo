import { Type, type Static } from "@sinclair/typebox";
import { CHANNEL_TOOL_PARAM_DESC } from "./channel-tool-param-desc.js";

/** 与 system prompt ## Channel 对齐的当前渠道（模型必传，供服务端与运行时比对） */
export const channelCurrentChannelSchema = Type.Union(
  [Type.Literal("web"), Type.Literal("qq"), Type.Literal("weixin")],
  {
    description: CHANNEL_TOOL_PARAM_DESC.runtimeChannel,
  },
);

/** 与 system prompt ## Channel 对齐的当前租户（模型必传，供服务端与运行时比对） */
export const channelCurrentTenantIdSchema = Type.String({
  minLength: 1,
  description: CHANNEL_TOOL_PARAM_DESC.runtimeTenantId,
});

/** 提醒任务送达渠道；省略则使用进程运行时 channel */
export const reminderSendToChannelOptionalSchema = Type.Optional(
  Type.Union(
    [Type.Literal("qq"), Type.Literal("weixin"), Type.Literal("web")],
    {
      description: CHANNEL_TOOL_PARAM_DESC.sendToChannelReminder,
    },
  ),
);

/** 提醒任务送达租户；省略则使用进程运行时 tenantId */
export const channelSendToTenantIdOptionalSchema = Type.Optional(
  Type.String({
    minLength: 1,
    description: CHANNEL_TOOL_PARAM_DESC.sendToTenantReminder,
  }),
);

/** IM 送达平台；省略则使用进程运行时 channel（运行时为 web 时须在业务中显式指定 qq/weixin） */
export const imSendToChannelOptionalSchema = Type.Optional(
  Type.Union([Type.Literal("qq"), Type.Literal("weixin")], {
    description: CHANNEL_TOOL_PARAM_DESC.sendToChannelIMOptional,
  }),
);

/** createReminderTask 中与 Channel 相关的共用字段（current* 必传，send* 可省略） */
export const reminderTaskChannelParamProperties = {
  currentChannel: channelCurrentChannelSchema,
  currentTenantId: channelCurrentTenantIdSchema,
  sendToChannel: reminderSendToChannelOptionalSchema,
  sendToTenantId: channelSendToTenantIdOptionalSchema,
};

/** sendIMMessage 中与 Channel 相关的共用字段 */
export const imSendChannelParamProperties = {
  currentChannel: channelCurrentChannelSchema,
  currentTenantId: channelCurrentTenantIdSchema,
  sendToChannel: imSendToChannelOptionalSchema,
  sendToTenantId: channelSendToTenantIdOptionalSchema,
};

// 当前渠道和租户必传,工具内部需要校验
export const channelContextRequiredSchema = Type.Object({
  currentChannel: channelCurrentChannelSchema,
  currentTenantId: channelCurrentTenantIdSchema,
});
export type ChannelContextRequired = Static<typeof channelContextRequiredSchema>;
