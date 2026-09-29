import type { MessageRole } from './learning';

export type MessageStatus = 'pending' | 'complete' | 'interrupted' | 'failed';

export interface ConversationSession {
  id: string;
  profileId: string;
  title: string;
  createdAt: string;
}

export interface ConversationMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  createdAt: string;
}

export const maxUserMessageLength = 2000;

export function sessionTitle(firstMessage: string): string {
  const line = firstMessage.trim().split(/\r?\n/)[0] ?? '';
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}
