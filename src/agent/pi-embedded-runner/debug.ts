type AssistantMessageEvent = {
  type?: string;
  delta?: string;
  partial?: { content?: unknown[] };
};

// debug function
export function debugAssistantMessageEvent(
  assistantEvent: AssistantMessageEvent,
): void {
  const debugPayload: {
    assistantMessageEvent: {
      type?: string;
      delta?: string;
      partial?: AssistantMessageEvent["partial"];
    };
  } = {
    assistantMessageEvent: {
      type: assistantEvent.type,
      ...(typeof (assistantEvent as { delta?: string }).delta === "string"
        ? { delta: (assistantEvent as { delta: string }).delta }
        : {}),
      ...(assistantEvent.partial != null
        ? { partial: assistantEvent.partial }
        : {}),
    },
  };
  console.log(JSON.stringify(debugPayload));
}
