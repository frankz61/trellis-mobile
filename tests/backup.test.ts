import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BackupService } from '../src/application/backup-service';
import { backupFileName, parseBackup } from '../src/domain/backup';
import { SqliteBackupRepository } from '../src/infrastructure/database/backup-repository';
import { schemaVersion } from '../src/infrastructure/database/migrations';
import { freshDatabase, type TestDatabase } from './helpers';

function seed(db: TestDatabase) {
  db.sqlite.exec(`
    INSERT INTO sessions VALUES ('s1', 'p1', 'Hello', '2026-09-21T01:00:00Z');
    INSERT INTO messages VALUES ('m1', 's1', 'user', 'I go to park', 'complete', '2026-09-21T01:00:01Z'),
                                ('m2', 's1', 'assistant', 'Nice!', 'complete', '2026-09-21T01:00:02Z');
    INSERT INTO words VALUES ('w1', 'park', '', '公园');
    INSERT INTO word_evidence VALUES ('e1', 'w1', 'm1');
    INSERT INTO word_mastery (profile_id, word_id, level, review_count, due_at, updated_at) VALUES ('p1', 'w1', 2, 1, NULL, NULL);
    INSERT INTO grammar_points VALUES ('g1', 'tense');
    INSERT INTO mistakes VALUES ('k1', 'm1', 'tense:i go', 'I go', 'I went', 'tense', '过去时');
    INSERT INTO mistake_grammar_links VALUES ('k1', 'g1');
    INSERT INTO grammar_mastery (profile_id, grammar_id, weakness_count, due_at, updated_at) VALUES ('p1', 'g1', 1, NULL, NULL);
    INSERT INTO daily_plans VALUES ('d1', 'p1', '2026-09-21', 'Asia/Shanghai', 1, '2026-09-21T02:00:00Z');
    INSERT INTO exercises VALUES ('x1', 'd1', 0, 'cloze', 'I ____ to the park.', 'went', 'grammar', 'g1', '2026-09-21T02:00:00Z');
    INSERT INTO review_attempts VALUES ('a1', 'x1', 'went', 'correct', '答对了', 'local', 1, '2026-09-21T02:01:00Z', '2026-09-21T02:01:00Z');
    INSERT INTO tasks (id, kind, dedupe_key, payload, status, created_at, updated_at) VALUES ('t1', 'extract', 'extract:m1', '{}', 'succeeded', 'now', 'now');
    UPDATE settings SET base_url = 'https://example.com/v1', credential_ref = 'trellis.model.secret-ref';
  `);
}

function service(db: TestDatabase, profileId: string, files: { saved?: string[]; picked?: string | null } = {}) {
  return new BackupService({
    profileId, repository: new SqliteBackupRepository(db), schemaVersion, appVersion: '0.1.0', now: () => new Date('2026-09-21T03:04:05Z'),
    files: {
      async save(name, json) { files.saved?.push(json); return name; },
      async pick() { return files.picked ?? null; },
    },
  });
}

test('an export carries learning data only and never the settings row or credentials', async () => {
  const db = await freshDatabase();
  seed(db);
  const saved: string[] = [];
  const name = await service(db, 'p1', { saved }).exportToFile();
  assert.match(name ?? '', /^trellis-backup-\d{8}-\d{4}\.json$/);
  assert.equal(name, backupFileName(new Date('2026-09-21T03:04:05Z')));
  const json = saved[0]!;
  assert.ok(!json.includes('secret-ref') && !json.includes('example.com') && !json.includes('settings'), 'no settings or key references');
  const pkg = parseBackup(JSON.parse(json), schemaVersion);
  assert.equal(pkg.schemaVersion, schemaVersion);
  assert.equal(pkg.tables.messages.length, 2);
  assert.equal(pkg.tables.review_attempts.length, 1);
  assert.deepEqual(pkg.tables.words[0], { id: 'w1', lemma: 'park', pos: '', meaning: '公园' });
});

test('a restore on another device replaces local data and re-points it at the local profile', async () => {
  const source = await freshDatabase();
  seed(source);
  const saved: string[] = [];
  await service(source, 'p1', { saved }).exportToFile();

  const target = await freshDatabase('p-other');
  target.sqlite.exec(`INSERT INTO sessions VALUES ('old', 'p-other', 'stale', 'now');
    INSERT INTO tasks (id, kind, dedupe_key, payload, status, created_at, updated_at) VALUES ('t9', 'extract', 'extract:old', '{}', 'pending', 'now', 'now')`);
  const summary = await service(target, 'p-other', { picked: saved[0] }).restoreFromFile();
  assert.deepEqual(summary, { exportedAt: '2026-09-21T03:04:05.000Z', sessions: 1, words: 1, mistakes: 1 });
  assert.deepEqual({ ...target.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get() }, { n: 1 });
  assert.equal(target.sqlite.prepare('SELECT profile_id FROM sessions').get()?.profile_id, 'p-other');
  assert.equal(target.sqlite.prepare('SELECT profile_id FROM word_mastery').get()?.profile_id, 'p-other');
  assert.equal(target.sqlite.prepare('SELECT COUNT(*) AS n FROM profiles').get()?.n, 1, 'the local profile row is kept');
  assert.equal(target.sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get()?.n, 0, 'stale tasks are dropped');
  assert.equal(target.sqlite.prepare('SELECT status FROM review_attempts').get()?.status, 'correct');
  assert.equal(target.sqlite.prepare("SELECT base_url FROM settings").get()?.base_url, '', 'settings untouched');
});

test('invalid, newer or broken backups are rejected and leave existing data alone', async () => {
  const db = await freshDatabase();
  seed(db);
  const svc = service(db, 'p1');
  await assert.rejects(svc.restore('not json'), /有效的 JSON/);
  await assert.rejects(svc.restore(JSON.stringify({ format: 'other' })), /不是 Trellis/);
  await assert.rejects(svc.restore(JSON.stringify({ format: 'trellis-backup', version: 1, schemaVersion: schemaVersion + 1, tables: {} })), /升级 App/);
  // A row violating a constraint (message without its session) rolls the whole restore back.
  const broken = { format: 'trellis-backup', version: 1, schemaVersion, tables: { messages: [{ id: 'z', session_id: 'missing', role: 'user', content: 'x', status: 'complete', created_at: 'now' }] } };
  await assert.rejects(svc.restore(JSON.stringify(broken)));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n, 2, 'original messages survive');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()?.n, 1);
  assert.equal(await svc.restoreFromFile(), null, 'cancelling the picker restores nothing');
});
