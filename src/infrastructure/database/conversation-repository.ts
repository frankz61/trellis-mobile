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

  replyBefore(id: string) {
    return this.database.getFirstAsync<ConversationMessage>(
      `SELECT m.id, m.session_id AS sessionId, m.role, m.content, m.status, m.created_at AS createdAt
       FROM messages m JOIN messages current ON current.id = ? AND m.session_id = current.session_id
       WHERE m.role = 'assistant' AND m.content <> '' AND m.status IN ('complete', 'interrupted')
         AND (m.created_at, m.rowid) < (current.created_at, current.rowid)
       ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1`, id,
    );
  }

  replyAfter(id: string) {
    return this.database.getFirstAsync<ConversationMessage>(
      `SELECT m.id, m.session_id AS sessionId, m.role, m.content, m.status, m.created_at AS createdAt
       FROM messages m JOIN messages current ON current.id = ? AND m.session_id = current.session_id
       WHERE m.role = 'assistant' AND m.content <> '' AND m.status = 'complete'
         AND (m.created_at, m.rowid) > (current.created_at, current.rowid)
         AND NOT EXISTS (SELECT 1 FROM messages u WHERE u.session_id = m.session_id AND u.role = 'user'
           AND (u.created_at, u.rowid) > (current.created_at, current.rowid) AND (u.created_at, u.rowid) < (m.created_at, m.rowid))
       ORDER BY m.created_at, m.rowid LIMIT 1`, id,
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
