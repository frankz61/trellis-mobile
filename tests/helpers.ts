import { DatabaseSync } from 'node:sqlite';
import { ModelAccess } from '../src/application/model-access';
import type { ModelGateway } from '../src/contracts/model';
import { defaultSettings, type ModelSettings } from '../src/domain/settings';
import type { BindValue, Database } from '../src/infrastructure/database/database';
import { migrate } from '../src/infrastructure/database/migrations';

export type TestDatabase = Database & { execAsync(sql: string): Promise<void>; sqlite: DatabaseSync };

// node:sqlite stand-in for expo-sqlite; rows come back with a null prototype.
export function adapter(sqlite: DatabaseSync): TestDatabase {
  return {
    sqlite,
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...params: BindValue[]) { return sqlite.prepare(sql).run(...params); },
    async getAllAsync<T>(sql: string, ...params: BindValue[]) { return sqlite.prepare(sql).all(...params) as T[]; },
    async getFirstAsync<T>(sql: string, ...params: BindValue[]) { return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null; },
    async withTransactionAsync(task) {
      sqlite.exec('BEGIN');
      try { await task(); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}

export async function freshDatabase(profileId = 'p1'): Promise<TestDatabase> {
  const db = adapter(new DatabaseSync(':memory:'));
  await migrate(db);
  db.sqlite.exec(`INSERT INTO profiles VALUES ('${profileId}', 'Learner', '2026-09-21T00:00:00Z')`);
  return db;
}

export const configuredSettings: ModelSettings = { ...defaultSettings, baseUrl: 'https://example.com/v1', model: 'm', credentialRef: 'ref' };

export function access(gateway: ModelGateway, settings: ModelSettings = configuredSettings): ModelAccess {
  return new ModelAccess(
    { async load() { return settings; }, async save() {} },
    { async get(ref) { return ref === 'ref' ? 'secret' : null; }, async set() {}, async remove() {} },
    () => gateway,
  );
}

export function sequentialIds(prefix = 'id'): () => string {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

export function plain<T extends object>(rows: T[]): T[] {
  return rows.map((row) => ({ ...row }));
}
