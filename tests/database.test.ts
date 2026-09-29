import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { migrate, schemaVersion, type MigrationDatabase } from '../src/infrastructure/database/migrations';

function adapter(sqlite: DatabaseSync): MigrationDatabase {
  return {
    async execAsync(sql) { sqlite.exec(sql); },
    async getFirstAsync<T>(sql: string) { return (sqlite.prepare(sql).get() as T | undefined) ?? null; },
  };
}

test('fresh schema initializes and re-opening preserves records', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    await migrate(adapter(db));
    db.exec("INSERT INTO profiles VALUES ('p1', 'Learner', '2026-09-17T00:00:00Z')");
    await migrate(adapter(db));
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, schemaVersion);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profiles').get()?.n, 1);
    assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
  } finally { db.close(); }
});

test('unknown future schema is rejected without deleting data', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    await migrate(adapter(db));
    db.exec('PRAGMA user_version = 999');
    await assert.rejects(migrate(adapter(db)), /升级/);
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 999);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM settings').get()?.n, 1);
  } finally { db.close(); }
});

test('failed migration rolls back its tables and version', async () => {
  const db = new DatabaseSync(':memory:');
  const normal = adapter(db);
  try {
    await assert.rejects(migrate({
      ...normal,
      async execAsync(sql) {
        await normal.execAsync(sql);
        if (sql.includes('CREATE TABLE tasks')) throw new Error('injected storage failure');
      },
    }), /injected/);
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get()?.n, 0);
    await migrate(normal);
  } finally { db.close(); }
});

test('graph rejects dangling or duplicate edges; tasks reject duplicate work', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    await migrate(adapter(db));
    db.exec("INSERT INTO words VALUES ('w1', 'big', '', '大'), ('w2', 'large', '', '大')");
    const insert = db.prepare('INSERT INTO word_relations VALUES (?, ?, ?, ?)');
    insert.run('w1', 'w2', 'synonym', 'test-dictionary');
    assert.throws(() => insert.run('w1', 'w2', 'synonym', 'test-dictionary'), /UNIQUE/);
    assert.throws(() => insert.run('w1', 'missing', 'synonym', 'test-dictionary'), /FOREIGN KEY/);
    const task = db.prepare("INSERT INTO tasks (id, kind, dedupe_key, payload, created_at, updated_at) VALUES (?, 'extract', 'message-1', '{}', 'now', 'now')");
    task.run('t1');
    assert.throws(() => task.run('t2'), /UNIQUE/);
  } finally { db.close(); }
});
