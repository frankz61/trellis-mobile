export interface MigrationDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
}

export const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        base_url TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        speech_rate REAL NOT NULL DEFAULT 0.85 CHECK (speech_rate BETWEEN 0.5 AND 1.5),
        credential_ref TEXT
      );
      INSERT INTO settings (id) VALUES (1);
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY NOT NULL,
        profile_id TEXT NOT NULL REFERENCES profiles(id),
        title TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'complete', 'interrupted', 'failed')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX messages_session_created ON messages(session_id, created_at);
      CREATE TABLE words (
        id TEXT PRIMARY KEY NOT NULL,
        lemma TEXT NOT NULL,
        pos TEXT NOT NULL DEFAULT '',
        meaning TEXT NOT NULL,
        UNIQUE (lemma, pos)
      );
      CREATE TABLE grammar_points (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL UNIQUE
      );
      CREATE TABLE word_relations (
        source_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('synonym', 'antonym', 'collocation')),
        provenance TEXT NOT NULL,
        PRIMARY KEY (source_id, target_id, type),
        CHECK (source_id <> target_id)
      );
      CREATE INDEX word_relations_target ON word_relations(target_id);
      CREATE TABLE word_evidence (
        id TEXT PRIMARY KEY NOT NULL,
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        UNIQUE (word_id, message_id)
      );
      CREATE TABLE mistakes (
        id TEXT PRIMARY KEY NOT NULL,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        item_key TEXT NOT NULL,
        original TEXT NOT NULL,
        corrected TEXT NOT NULL,
        type TEXT NOT NULL,
        explanation TEXT NOT NULL,
        UNIQUE (message_id, item_key)
      );
      CREATE TABLE mistake_grammar_links (
        mistake_id TEXT NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
        grammar_id TEXT NOT NULL REFERENCES grammar_points(id),
        PRIMARY KEY (mistake_id, grammar_id)
      );
      CREATE TABLE word_mastery (
        profile_id TEXT NOT NULL REFERENCES profiles(id),
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        level INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 5),
        review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
        due_at TEXT,
        PRIMARY KEY (profile_id, word_id)
      );
      CREATE TABLE grammar_mastery (
        profile_id TEXT NOT NULL REFERENCES profiles(id),
        grammar_id TEXT NOT NULL REFERENCES grammar_points(id),
        weakness_count INTEGER NOT NULL DEFAULT 0 CHECK (weakness_count >= 0),
        due_at TEXT,
        PRIMARY KEY (profile_id, grammar_id)
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('extract', 'generate', 'evaluate')),
        dedupe_key TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX tasks_pending ON tasks(status, next_run_at);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE daily_plans (
        id TEXT PRIMARY KEY NOT NULL,
        profile_id TEXT NOT NULL REFERENCES profiles(id),
        local_date TEXT NOT NULL,
        timezone TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version >= 1),
        created_at TEXT NOT NULL,
        UNIQUE (profile_id, local_date, version)
      );
      CREATE TABLE exercises (
        id TEXT PRIMARY KEY NOT NULL,
        plan_id TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('cloze', 'sentence_make', 'mini_dialogue')),
        prompt TEXT NOT NULL,
        answer TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK (target_type IN ('word', 'grammar')),
        target_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (plan_id, position)
      );
      CREATE TABLE review_attempts (
        id TEXT PRIMARY KEY NOT NULL,
        exercise_id TEXT NOT NULL UNIQUE REFERENCES exercises(id) ON DELETE CASCADE,
        answer TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'correct', 'incorrect')),
        feedback TEXT NOT NULL DEFAULT '',
        judged_by TEXT CHECK (judged_by IN ('local', 'model')),
        mastery_applied INTEGER NOT NULL DEFAULT 0 CHECK (mastery_applied IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      ALTER TABLE word_mastery ADD COLUMN updated_at TEXT;
      ALTER TABLE grammar_mastery ADD COLUMN updated_at TEXT;
    `,
  },
  {
    // Online speech services and model temperature. Keys stay in secure storage; only references live here.
    version: 3,
    sql: `
      ALTER TABLE settings ADD COLUMN temperature REAL CHECK (temperature IS NULL OR temperature BETWEEN 0 AND 2);
      ALTER TABLE settings ADD COLUMN recognition_engine TEXT NOT NULL DEFAULT 'system'
        CHECK (recognition_engine IN ('system', 'online'));
      ALTER TABLE settings ADD COLUMN stt_base_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE settings ADD COLUMN stt_model TEXT NOT NULL DEFAULT '';
      ALTER TABLE settings ADD COLUMN stt_credential_ref TEXT;
      ALTER TABLE settings ADD COLUMN synthesis_engine TEXT NOT NULL DEFAULT 'system'
        CHECK (synthesis_engine IN ('system', 'online'));
      ALTER TABLE settings ADD COLUMN tts_base_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE settings ADD COLUMN tts_model TEXT NOT NULL DEFAULT '';
      ALTER TABLE settings ADD COLUMN tts_voice TEXT NOT NULL DEFAULT '';
      ALTER TABLE settings ADD COLUMN tts_format TEXT NOT NULL DEFAULT 'mp3'
        CHECK (tts_format IN ('mp3', 'aac', 'opus', 'wav', 'flac'));
      ALTER TABLE settings ADD COLUMN tts_credential_ref TEXT;
    `,
  },
] as const;

export const schemaVersion = migrations[migrations.length - 1].version;

// Startup only: no other consumers receive this connection until migration finishes.
export async function migrate(database: MigrationDatabase): Promise<void> {
  await database.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  await database.execAsync('BEGIN IMMEDIATE');
  try {
    const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const current = row?.user_version ?? 0;
    if (current > schemaVersion) throw new Error('数据库由更新版本创建，请升级 App 后再打开。');
    for (const migration of migrations) {
      if (migration.version <= current) continue;
      await database.execAsync(migration.sql);
      await database.execAsync(`PRAGMA user_version = ${migration.version}`);
    }
    await database.execAsync('COMMIT');
  } catch (error) {
    await database.execAsync('ROLLBACK');
    throw error;
  }
}
