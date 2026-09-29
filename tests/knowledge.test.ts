import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { KnowledgeService, maxTaskAttempts } from '../src/application/knowledge-service';
import { ModelRequestError, type ModelGateway } from '../src/contracts/model';
import { mistakeKey, parseExtraction } from '../src/domain/knowledge';
import { parseModelJson } from '../src/domain/model-json';
import { SqliteConversationRepository } from '../src/infrastructure/database/conversation-repository';
import { SqliteKnowledgeRepository } from '../src/infrastructure/database/knowledge-repository';
import { migrate, migrations, schemaVersion } from '../src/infrastructure/database/migrations';
import { SqliteTaskRepository } from '../src/infrastructure/database/task-repository';
import { access, adapter, freshDatabase, plain, sequentialIds } from './helpers';

test('v1 databases upgrade to v2 without losing rows', async () => {
  const db = adapter(new DatabaseSync(':memory:'));
  // Build the released v1 schema exactly as shipped, then add data before upgrading.
  db.sqlite.exec(migrations[0].sql);
  db.sqlite.exec('PRAGMA user_version = 1');
  db.sqlite.exec("INSERT INTO profiles VALUES ('p1', 'Learner', 'now'); INSERT INTO words VALUES ('w1', 'big', '', '大');");
  db.sqlite.exec("INSERT INTO word_mastery (profile_id, word_id, level, review_count, due_at) VALUES ('p1', 'w1', 2, 1, NULL)");
  await migrate(db);
  assert.equal(db.sqlite.prepare('PRAGMA user_version').get()?.user_version, schemaVersion);
  assert.ok(schemaVersion >= 2);
  assert.deepEqual({ ...db.sqlite.prepare('SELECT level, review_count, updated_at FROM word_mastery').get() }, { level: 2, review_count: 1, updated_at: null });
  db.sqlite.exec("INSERT INTO daily_plans VALUES ('d1', 'p1', '2026-09-21', 'Asia/Shanghai', 1, 'now')");
  assert.throws(() => db.sqlite.exec("INSERT INTO daily_plans VALUES ('d2', 'p1', '2026-09-21', 'Asia/Shanghai', 1, 'now')"), /UNIQUE/);
});

test('model JSON is unwrapped from fences and validated field by field', () => {
  const text = 'Here you go:\n```json\n{"mistakes":[{"orig":"I go","fix":"I went","type":"TENSE","explanation":"过去时"},{"orig":"x","fix":"x","type":"tense"},{"orig":"bad","fix":"worse","type":"made_up"}],"words":[{"lemma":" Exhausted ","meaning_cn":"精疲力尽"},{"lemma":"exhausted","meaning_cn":"dup"},{"lemma":"123","meaning_cn":"no"}]}\n```';
  const extraction = parseExtraction(parseModelJson(text));
  assert.deepEqual(extraction, {
    mistakes: [{ original: 'I go', corrected: 'I went', type: 'tense', explanation: '过去时' }],
    words: [{ lemma: 'exhausted', meaning: '精疲力尽' }],
  });
  assert.equal(mistakeKey(extraction!.mistakes[0]!), 'tense:i go');
  assert.equal(parseExtraction(parseModelJson('not json')), null);
  assert.equal(parseExtraction({ nothing: true }), null);
  assert.deepEqual(parseExtraction({ mistakes: [], words: [] }), { mistakes: [], words: [] });
});

async function knowledgeFixture(replies: (string | Error)[]) {
  const db = await freshDatabase();
  db.sqlite.exec(`INSERT INTO sessions VALUES ('s1', 'p1', 't', 'now');
    INSERT INTO messages VALUES ('m1', 's1', 'user', 'Yesterday I go to park, it was very exhausted.', 'complete', 'now');
    INSERT INTO messages VALUES ('m2', 's1', 'user', 'Second message', 'complete', 'now')`);
  let calls = 0;
  const gateway: ModelGateway = {
    async *streamReply() {},
    async complete() {
      const reply = replies[Math.min(calls, replies.length - 1)];
      calls += 1;
      if (reply instanceof Error) throw reply;
      return reply ?? '';
    },
  };
  const knowledge = new SqliteKnowledgeRepository(db, sequentialIds('k'));
  const service = new KnowledgeService({
    profileId: 'p1', tasks: new SqliteTaskRepository(db), knowledge, conversation: new SqliteConversationRepository(db),
    access: access(gateway), createId: sequentialIds('t'), now: () => '2026-09-21T10:00:00.000Z',
  });
  return { db, service, knowledge, calls: () => calls };
}

const extractionJson = JSON.stringify({
  mistakes: [{ orig: 'I go', fix: 'I went', type: 'tense', explanation: '过去的事用过去时' }, { orig: 'to park', fix: 'to the park', type: 'article', explanation: '' }],
  words: [{ lemma: 'exhausted', meaning_cn: '精疲力尽的' }],
});

test('extraction writes words, evidence, mistakes and weakness once per message', async () => {
  const f = await knowledgeFixture([extractionJson]);
  await f.service.enqueueExtraction('m1');
  await f.service.enqueueExtraction('m1');
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get()?.n, 1, 'dedupe key blocks a second task');
  const outcomes: unknown[] = [];
  const first = await f.service.runPending(new AbortController().signal, (o) => outcomes.push(o));
  assert.deepEqual(first, { succeeded: 1, failed: 0 });
  assert.deepEqual(outcomes, [{ messageId: 'm1', words: 1, mistakes: 2 }]);

  const counts = () => f.db.sqlite.prepare(`SELECT (SELECT COUNT(*) FROM words) w, (SELECT COUNT(*) FROM word_evidence) e,
    (SELECT COUNT(*) FROM mistakes) m, (SELECT COUNT(*) FROM grammar_points) g,
    (SELECT SUM(weakness_count) FROM grammar_mastery) weak, (SELECT level FROM word_mastery) level`).get();
  assert.deepEqual({ ...counts() }, { w: 1, e: 1, m: 2, g: 2, weak: 2, level: 1 });

  // Applying the same extraction again (e.g. after a retried task) changes nothing.
  const again = await f.knowledge.applyExtraction('p1', 'm1', parseExtraction(JSON.parse(extractionJson))!, '2026-09-21T11:00:00.000Z');
  assert.deepEqual(again, { words: 0, mistakes: 0 });
  assert.deepEqual({ ...counts() }, { w: 1, e: 1, m: 2, g: 2, weak: 2, level: 1 });

  // The same mistake in a later message is new evidence and raises weakness again.
  await f.knowledge.applyExtraction('p1', 'm2', parseExtraction(JSON.parse(extractionJson))!, '2026-09-21T12:00:00.000Z');
  assert.deepEqual({ ...counts() }, { w: 1, e: 2, m: 4, g: 2, weak: 4, level: 1 });

  const weak = await f.knowledge.weakPoints('p1');
  assert.deepEqual(weak.grammar.map((g) => `${g.name}:${g.count}`), ['article:2', 'tense:2']);
  assert.deepEqual(weak.words.map((w) => w.lemma), ['exhausted']);
  const targets = await f.knowledge.dueTargets('p1', '2026-09-23T00:00:00.000Z', { words: 2, grammar: 3 });
  assert.deepEqual(targets.map((t) => `${t.type}:${t.label}`), ['grammar:冠词', 'grammar:时态', 'word:exhausted']);
  assert.equal((await f.knowledge.dueTargets('p1', '2026-09-21T10:30:00.000Z', { words: 2, grammar: 3 })).filter((t) => t.type === 'word').length, 1, 'a new word is due the same day');
  assert.deepEqual((await f.knowledge.dueTargets('p1', '2026-09-21T09:00:00.000Z', { words: 2, grammar: 3 })).filter((t) => t.type === 'word'), [], 'but not before it was met');
});

test('unparseable or failing extractions back off and give up after the attempt limit', async () => {
  const f = await knowledgeFixture(['no json here', new ModelRequestError('down', 'http', 503), 'still nothing']);
  await f.service.enqueueExtraction('m1');
  const first = await f.service.runPending(new AbortController().signal);
  assert.deepEqual(first, { succeeded: 0, failed: 1 });
  let task = f.db.sqlite.prepare('SELECT status, attempts, next_run_at FROM tasks').get()!;
  assert.equal(task.status, 'pending');
  assert.equal(task.attempts, 1);
  assert.ok(task.next_run_at, 'a retry time is scheduled');
  assert.deepEqual(await f.service.runPending(new AbortController().signal), { succeeded: 0, failed: 0 }, 'not retried before its backoff');

  f.db.sqlite.prepare('UPDATE tasks SET next_run_at = NULL').run();
  await f.service.runPending(new AbortController().signal);
  f.db.sqlite.prepare('UPDATE tasks SET next_run_at = NULL').run();
  await f.service.runPending(new AbortController().signal);
  task = f.db.sqlite.prepare('SELECT status, attempts FROM tasks').get()!;
  assert.deepEqual({ ...task }, { status: 'failed', attempts: maxTaskAttempts });
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM mistakes').get()?.n, 0, 'nothing was written from bad output');
  assert.equal(f.calls(), 3);
});

test('running tasks left behind by a crash are recovered and a missing message completes cleanly', async () => {
  const f = await knowledgeFixture([extractionJson]);
  await f.service.enqueueExtraction('gone');
  f.db.sqlite.prepare("UPDATE tasks SET status = 'running'").run();
  assert.deepEqual(await f.service.runPending(new AbortController().signal), { succeeded: 0, failed: 0 }, 'running tasks are not claimed twice');
  assert.equal(await f.service.recover(), 1);
  assert.deepEqual(await f.service.runPending(new AbortController().signal), { succeeded: 1, failed: 0 });
  assert.equal(f.calls(), 0, 'no model call for a message that no longer exists');
  assert.equal(plain(f.db.sqlite.prepare('SELECT status FROM tasks').all() as { status: string }[])[0]?.status, 'succeeded');
});
