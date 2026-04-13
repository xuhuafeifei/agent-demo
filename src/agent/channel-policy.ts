import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export const SUPPORTED_CHANNELS = ["web", "qq", "weixin"] as const;

export type AgentChannel = (typeof SUPPORTED_CHANNELS)[number];

type ChannelPolicy = {
  defaultThinkingLevel: ThinkingLevel;
  allowMarkdown: boolean;
  emitContextSnapshot: boolean;
};

export const CHANNEL_POLICY: Record<AgentChannel, ChannelPolicy> = {
  web: {
    defaultThinkingLevel: "medium" as ThinkingLevel,
    allowMarkdown: true,
    emitContextSnapshot: true,
  },
  qq: {
    defaultThinkingLevel: "off" as ThinkingLevel,
    allowMarkdown: false,
    emitContextSnapshot: false,
  },
  weixin: {
    defaultThinkingLevel: "off" as ThinkingLevel,
    allowMarkdown: false,
    emitContextSnapshot: false,
  },
};

export function isAgentChannel(value: unknown): value is AgentChannel {
  return (
    typeof value === "string" &&
    (SUPPORTED_CHANNELS as readonly string[]).includes(value)
  );
}

export function getChannelPolicy(channel: AgentChannel): ChannelPolicy {
  return CHANNEL_POLICY[channel];
}

export function getChannelFormattingInstruction(channel: AgentChannel): string {
  const policy = getChannelPolicy(channel);
  if (policy.allowMarkdown) {
    return `Current channel is ${channel}.`;
  }
  return `Current channel is ${channel}.`;
}
