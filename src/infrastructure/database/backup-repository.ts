import { backupTables, type BackupRow, type BackupTable } from '../../domain/backup';
import type { BackupRepository } from '../../repositories/contracts';
import type { BindValue, Database } from './database';

// Column lists are fixed here so exports stay explicit and restores never trust keys from the file.
const columns: Record<BackupTable, readonly string[]> = {
  profiles: ['id', 'name', 'created_at'],
  sessions: ['id', 'profile_id', 'title', 'created_at'],
  messages: ['id', 'session_id', 'role', 'content', 'status', 'created_at'],
  words: ['id', 'lemma', 'pos', 'meaning'],
  grammar_points: ['id', 'name'],
  word_relations: ['source_id', 'target_id', 'type', 'provenance'],
  word_evidence: ['id', 'word_id', 'message_id'],
  mistakes: ['id', 'message_id', 'item_key', 'original', 'corrected', 'type', 'explanation'],
  mistake_grammar_links: ['mistake_id', 'grammar_id'],
  word_mastery: ['profile_id', 'word_id', 'level', 'review_count', 'due_at', 'updated_at'],
  grammar_mastery: ['profile_id', 'grammar_id', 'weakness_count', 'due_at', 'updated_at'],
  daily_plans: ['id', 'profile_id', 'local_date', 'timezone', 'version', 'created_at'],
  exercises: ['id', 'plan_id', 'position', 'kind', 'prompt', 'answer', 'target_type', 'target_id', 'created_at'],
  review_attempts: ['id', 'exercise_id', 'answer', 'status', 'feedback', 'judged_by', 'mastery_applied', 'created_at', 'updated_at'],
};

function bind(value: unknown): BindValue {
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

export class SqliteBackupRepository implements BackupRepository {
  constructor(private readonly database: Database) {}

  async dump() {
    const tables = {} as Record<BackupTable, BackupRow[]>;
    for (const name of backupTables) {
      const rows = await this.database.getAllAsync<BackupRow>(`SELECT ${columns[name].join(', ')} FROM ${name} ORDER BY rowid`);
      // node/expo rows may carry a null prototype; copy them into plain JSON-friendly objects.
      tables[name] = rows.map((row) => Object.fromEntries(columns[name].map((column) => [column, row[column] ?? null])));
    }
    return tables;
  }

  // Everything is replaced inside one transaction: a bad row rolls the whole restore back.
  // The learner's own profile row is kept; imported rows are re-pointed at it.
  async replace(tables: Record<BackupTable, BackupRow[]>, profileId: string) {
    const counts = {} as Record<BackupTable, number>;
    await this.database.withTransactionAsync(async () => {
      for (const name of [...backupTables].reverse()) {
        if (name !== 'profiles') await this.database.runAsync(`DELETE FROM ${name}`);
      }
      await this.database.runAsync('DELETE FROM tasks');
      for (const name of backupTables) {
        counts[name] = 0;
        if (name === 'profiles') continue;
        const cols = columns[name];
        const sql = `INSERT INTO ${name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
        for (const row of tables[name]) {
          const values = cols.map((column) => (column === 'profile_id' ? profileId : bind(row[column])));
          await this.database.runAsync(sql, ...values);
          counts[name] += 1;
        }
      }
    });
    return counts;
  }
}
