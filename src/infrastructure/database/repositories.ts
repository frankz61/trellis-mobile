import type { SQLiteDatabase } from 'expo-sqlite';
import type { Database } from './database';
import type { ModelSettings } from '../../domain/settings';
import type { SynthesisFormat, VoiceEngine, VoiceSettings } from '../../domain/voice';
import type { LearningRepository, SettingsRepository, VoiceSettingsRepository } from '../../repositories/contracts';
import type { MistakeEntry, VocabularyEntry } from '../../domain/learning';

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly database: Database) {}

  async load(): Promise<ModelSettings> {
    const row = await this.database.getFirstAsync<ModelSettings>(
      `SELECT base_url AS baseUrl, model, temperature, credential_ref AS credentialRef FROM settings WHERE id = 1`,
    );
    if (!row) throw new Error('本地设置缺失，请重新启动应用。');
    return { ...row };
  }

  async save(settings: ModelSettings): Promise<void> {
    await this.database.runAsync(
      `UPDATE settings SET base_url = ?, model = ?, temperature = ?, credential_ref = ? WHERE id = 1`,
      settings.baseUrl, settings.model, settings.temperature, settings.credentialRef,
    );
  }
}

interface VoiceRow {
  recognitionEngine: VoiceEngine; sttBaseUrl: string; sttModel: string; sttCredentialRef: string | null;
  synthesisEngine: VoiceEngine; ttsBaseUrl: string; ttsModel: string; ttsVoice: string; ttsFormat: SynthesisFormat;
  speechRate: number; ttsCredentialRef: string | null;
}

// Same single settings row as the model configuration, different columns.
export class SqliteVoiceSettingsRepository implements VoiceSettingsRepository {
  constructor(private readonly database: Database) {}

  async load(): Promise<VoiceSettings> {
    const row = await this.database.getFirstAsync<VoiceRow>(
      `SELECT recognition_engine AS recognitionEngine, stt_base_url AS sttBaseUrl, stt_model AS sttModel,
              stt_credential_ref AS sttCredentialRef, synthesis_engine AS synthesisEngine, tts_base_url AS ttsBaseUrl,
              tts_model AS ttsModel, tts_voice AS ttsVoice, tts_format AS ttsFormat, speech_rate AS speechRate,
              tts_credential_ref AS ttsCredentialRef
       FROM settings WHERE id = 1`,
    );
    if (!row) throw new Error('本地设置缺失，请重新启动应用。');
    return {
      recognition: { engine: row.recognitionEngine, baseUrl: row.sttBaseUrl, model: row.sttModel, credentialRef: row.sttCredentialRef },
      synthesis: {
        engine: row.synthesisEngine, baseUrl: row.ttsBaseUrl, model: row.ttsModel, voice: row.ttsVoice,
        format: row.ttsFormat, speechRate: row.speechRate, credentialRef: row.ttsCredentialRef,
      },
    };
  }

  async save({ recognition: r, synthesis: s }: VoiceSettings): Promise<void> {
    await this.database.runAsync(
      `UPDATE settings SET recognition_engine = ?, stt_base_url = ?, stt_model = ?, stt_credential_ref = ?,
              synthesis_engine = ?, tts_base_url = ?, tts_model = ?, tts_voice = ?, tts_format = ?, speech_rate = ?,
              tts_credential_ref = ?
       WHERE id = 1`,
      r.engine, r.baseUrl, r.model, r.credentialRef,
      s.engine, s.baseUrl, s.model, s.voice, s.format, s.speechRate, s.credentialRef,
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
