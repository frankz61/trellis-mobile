import type { ConversationMessage, ConversationSession, MessageStatus } from '../../domain/conversation';
import type { ConversationRepository } from '../../repositories/contracts';
import type { Database } from './database';

export class SqliteConversationRepository implements ConversationRepository {
  constructor(private readonly database: Database) {}

  latestSession(profileId: string) {
    return this.database.getFirstAsync<ConversationSession>(
      `SELECT id, profile_id AS profileId, title, created_at AS createdAt FROM sessions
       WHERE profile_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, profileId,
    );
  }

  async createSession(session: ConversationSession) {
    await this.database.runAsync(
      'INSERT INTO sessions (id, profile_id, title, created_at) VALUES (?, ?, ?, ?)',
      session.id, session.profileId, session.title, session.createdAt,
    );
  }

  messages(sessionId: string) {
    return this.database.getAllAsync<ConversationMessage>(
      `SELECT id, session_id AS sessionId, role, content, status, created_at AS createdAt
       FROM messages WHERE session_id = ? ORDER BY created_at, rowid`, sessionId,
    );
  }

  message(id: string) {
    return this.database.getFirstAsync<ConversationMessage>(
      `SELECT id, session_id AS sessionId, role, content, status, created_at AS createdAt FROM messages WHERE id = ?`, id,
    );
  }

  async appendMessage(message: ConversationMessage) {
    await this.database.runAsync(
      'INSERT INTO messages (id, session_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      message.id, message.sessionId, message.role, message.content, message.status, message.createdAt,
    );
  }

  async updateMessage(id: string, content: string, status: MessageStatus) {
    await this.database.runAsync('UPDATE messages SET content = ?, status = ? WHERE id = ?', content, status, id);
  }

  async interruptPending(sessionId: string) {
    await this.database.runAsync(
      "UPDATE messages SET status = 'interrupted' WHERE session_id = ? AND status = 'pending'", sessionId,
    );
  }
}
