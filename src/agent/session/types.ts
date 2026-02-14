export type SessionMessage = {
  role?: string;
  content?: unknown;
  timestamp?: number;
};

export type SessionSnapshot = {
  sessionId: string;
  updatedAt: number;
  messages: SessionMessage[];
};

