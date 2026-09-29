import type { SQLiteDatabase } from 'expo-sqlite';
import type { ModelSettings } from '../../domain/settings';
import type { LearningRepository, SettingsRepository } from '../../repositories/contracts';
import type { MistakeEntry, VocabularyEntry } from '../../domain/learning';

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async load(): Promise<ModelSettings> {
    const row = await this.database.getFirstAsync<ModelSettings>(
      `SELECT base_url AS baseUrl, model, speech_rate AS speechRate,
              credential_ref AS credentialRef FROM settings WHERE id = 1`,
    );
    if (!row) throw new Error('本地设置缺失，请重新启动应用。');
    return row;
  }

  async save(settings: ModelSettings): Promise<void> {
    await this.database.runAsync(
      `UPDATE settings SET base_url = ?, model = ?, speech_rate = ?, credential_ref = ? WHERE id = 1`,
      settings.baseUrl, settings.model, settings.speechRate, settings.credentialRef,
    );
  }
}

export class SqliteLearningRepository implements LearningRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async summary() {
    const result = await this.database.getFirstAsync<{
      sessions: number; words: number; mistakes: number; pendingTasks: number;
    }>(`SELECT
      (SELECT COUNT(*) FROM sessions) AS sessions,
      (SELECT COUNT(DISTINCT word_id) FROM word_evidence) AS words,
      (SELECT COUNT(*) FROM mistakes) AS mistakes,
      (SELECT COUNT(*) FROM tasks WHERE status IN ('pending', 'running')) AS pendingTasks`);
    return result ?? { sessions: 0, words: 0, mistakes: 0, pendingTasks: 0 };
  }

  vocabulary(): Promise<VocabularyEntry[]> {
    return this.database.getAllAsync<VocabularyEntry>(
      `SELECT w.id, w.lemma, w.meaning, COALESCE(m.level, 0) AS level FROM words w
       LEFT JOIN word_mastery m ON m.word_id = w.id
       WHERE EXISTS (SELECT 1 FROM word_evidence e WHERE e.word_id = w.id)
       ORDER BY w.lemma LIMIT 100`,
    );
  }

  mistakes(): Promise<MistakeEntry[]> {
    return this.database.getAllAsync<MistakeEntry>(
      'SELECT id, original, corrected, type, explanation FROM mistakes ORDER BY rowid DESC LIMIT 100',
    );
  }
}
