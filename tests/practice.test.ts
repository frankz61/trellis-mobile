import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noTargetsMessage, PracticeService } from '../src/application/practice-service';
import type { ModelGateway } from '../src/contracts/model';
import { nextWeakness, nextWordMastery } from '../src/domain/mastery';
import { judgeLocally, localDate, parseEvaluation, parseExercise } from '../src/domain/practice';
import { SqliteKnowledgeRepository } from '../src/infrastructure/database/knowledge-repository';
import { SqlitePracticeRepository } from '../src/infrastructure/database/practice-repository';
import { access, freshDatabase, sequentialIds } from './helpers';

test('mastery rules move one step at a time and schedule the next review', () => {
  const now = new Date('2026-09-21T00:00:00Z');
  const up = nextWordMastery({ level: 1, reviewCount: 0, dueAt: null }, true, now);
  assert.deepEqual(up, { level: 2, reviewCount: 1, dueAt: '2026-09-23T00:00:00.000Z' });
  const down = nextWordMastery({ level: 0, reviewCount: 3, dueAt: null }, false, now);
  assert.deepEqual(down, { level: 0, reviewCount: 4, dueAt: '2026-09-22T00:00:00.000Z' });
  assert.equal(nextWordMastery({ level: 5, reviewCount: 9, dueAt: null }, true, now).level, 5);
  assert.equal(nextWeakness(1, true), 0);
  assert.equal(nextWeakness(0, true), 0);
  assert.equal(nextWeakness(2, false), 3);
  assert.equal(localDate(new Date(2026, 8, 21, 23, 59)), '2026-09-21');
});

test('exercise and evaluation payloads are validated; cloze answers can be judged locally', () => {
  assert.deepEqual(parseExercise({ kind: 'CLOZE', prompt: 'I ____ tired.', answer: 'am' }), { kind: 'cloze', prompt: 'I ____ tired.', answer: 'am' });
  assert.equal(parseExercise({ kind: 'essay', prompt: 'x', answer: 'y' }), null);
  assert.equal(parseExercise({ kind: 'cloze', prompt: '', answer: 'y' }), null);
  assert.deepEqual(parseEvaluation({ correct: false, feedback: '注意时态' }), { correct: false, feedback: '注意时态' });
  assert.equal(parseEvaluation({ correct: 'yes' }), null);
  assert.equal(judgeLocally({ kind: 'cloze', answer: 'Went' }, ' went. '), true);
  assert.equal(judgeLocally({ kind: 'cloze', answer: 'went' }, 'go'), null, 'a mismatch is not a verdict yet');
  assert.equal(judgeLocally({ kind: 'sentence_make', answer: 'anything' }, 'anything'), null);
});

async function practiceFixture(replies: string[]) {
  const db = await freshDatabase();
  db.sqlite.exec(`INSERT INTO words VALUES ('w1', 'exhausted', '', '精疲力尽的'), ('w2', 'serene', '', '宁静的');
    INSERT INTO word_mastery (profile_id, word_id, level, review_count, due_at) VALUES ('p1', 'w1', 1, 0, '2026-09-20T00:00:00Z'), ('p1', 'w2', 4, 3, NULL);
    INSERT INTO grammar_points VALUES ('g1', 'tense'), ('g2', 'article');
    INSERT INTO grammar_mastery (profile_id, grammar_id, weakness_count, due_at) VALUES ('p1', 'g1', 3, NULL), ('p1', 'g2', 0, NULL)`);
  let calls = 0;
  const gateway: ModelGateway = {
    async *streamReply() {},
    async complete() { const reply = replies[Math.min(calls, replies.length - 1)] ?? ''; calls += 1; return reply; },
  };
  const service = new PracticeService({
    profileId: 'p1', practice: new SqlitePracticeRepository(db), knowledge: new SqliteKnowledgeRepository(db, sequentialIds('k')),
    access: access(gateway), createId: sequentialIds('x'), now: () => new Date('2026-09-21T09:00:00Z'), timezone: () => 'Asia/Shanghai',
  });
  return { db, service, calls: () => calls };
}

const clozeJson = JSON.stringify({ kind: 'cloze', prompt: 'After the match I was completely ____.', answer: 'exhausted' });
const sentenceJson = JSON.stringify({ kind: 'sentence_make', prompt: 'Make a sentence in past tense.', answer: 'I went home.' });

test('a daily plan is generated once from due targets, reused, and versioned on regeneration', async () => {
  const f = await practiceFixture([sentenceJson, clozeJson]);
  const before = await f.service.today();
  assert.equal(before.plan, null);
  assert.equal(before.hasTargets, true);

  const first = await f.service.generate(new AbortController().signal);
  assert.equal(first.plan?.version, 1);
  assert.equal(first.plan?.localDate, '2026-09-21');
  assert.equal(first.plan?.timezone, 'Asia/Shanghai');
  assert.deepEqual(first.exercises.map((e) => `${e.targetType}:${e.targetLabel}:${e.kind}`), ['grammar:时态:sentence_make', 'word:exhausted:cloze']);
  assert.equal(f.calls(), 2, 'one model call per target; the level-4 word and the healed grammar point are not due');

  const reopened = await f.service.today();
  assert.equal(reopened.plan?.id, first.plan?.id, 'reopening the page never regenerates');
  assert.equal(f.calls(), 2);

  const second = await f.service.generate(new AbortController().signal);
  assert.equal(second.plan?.version, 2);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM exercises').get()?.n, 4, 'earlier versions stay as history');
});

test('generation skips items the model cannot produce and refuses an empty plan', async () => {
  const partial = await practiceFixture(['garbage', clozeJson]);
  const plan = await partial.service.generate(new AbortController().signal);
  assert.equal(plan.exercises.length, 1);

  const none = await practiceFixture(['garbage']);
  await assert.rejects(none.service.generate(new AbortController().signal), /没有生成出可用的题目/);
  assert.equal(none.db.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_plans').get()?.n, 0);

  const idle = await practiceFixture([clozeJson]);
  idle.db.sqlite.exec("UPDATE grammar_mastery SET weakness_count = 0; UPDATE word_mastery SET level = 5");
  assert.equal((await idle.service.today()).hasTargets, false);
  await assert.rejects(idle.service.generate(new AbortController().signal), new RegExp(noTargetsMessage));
});

test('answers are judged locally when exact, otherwise by the model, and mastery moves exactly once', async () => {
  const f = await practiceFixture([sentenceJson, clozeJson, JSON.stringify({ correct: false, feedback: '要用过去时' })]);
  const plan = await f.service.generate(new AbortController().signal);
  const [grammarItem, wordItem] = plan.exercises;

  const local = await f.service.answer(wordItem!.id, ' Exhausted. ', new AbortController().signal);
  assert.equal(local.attempt?.status, 'correct');
  assert.equal(local.attempt?.judgedBy, 'local');
  assert.equal(f.calls(), 2, 'no model call for an exact cloze match');
  assert.deepEqual({ ...f.db.sqlite.prepare("SELECT level, review_count FROM word_mastery WHERE word_id = 'w1'").get() }, { level: 2, review_count: 1 });

  const repeated = await f.service.answer(wordItem!.id, 'different', new AbortController().signal);
  assert.equal(repeated.attempt?.answer, 'Exhausted.', 'a second submission is ignored');
  assert.equal(f.db.sqlite.prepare("SELECT level FROM word_mastery WHERE word_id = 'w1'").get()?.level, 2);

  const byModel = await f.service.answer(grammarItem!.id, 'I go home.', new AbortController().signal);
  assert.equal(byModel.attempt?.status, 'incorrect');
  assert.equal(byModel.attempt?.judgedBy, 'model');
  assert.equal(byModel.attempt?.feedback, '要用过去时');
  assert.equal(f.db.sqlite.prepare("SELECT weakness_count FROM grammar_mastery WHERE grammar_id = 'g1'").get()?.weakness_count, 4);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM review_attempts WHERE mastery_applied = 1').get()?.n, 2);
});

test('a failed evaluation keeps the attempt pending and can be retried without re-entering the answer', async () => {
  const f = await practiceFixture([sentenceJson, clozeJson, 'not json', JSON.stringify({ correct: true, feedback: '很好' })]);
  const plan = await f.service.generate(new AbortController().signal);
  const item = plan.exercises[0]!;
  await assert.rejects(f.service.answer(item.id, 'I went home.', new AbortController().signal), /无法解析/);
  const pending = (await f.service.today()).exercises[0]!.attempt;
  assert.equal(pending?.status, 'pending');
  assert.equal(pending?.answer, 'I went home.');
  assert.equal(f.db.sqlite.prepare("SELECT weakness_count FROM grammar_mastery WHERE grammar_id = 'g1'").get()?.weakness_count, 3, 'no mastery change yet');

  const retried = await f.service.answer(item.id, '', new AbortController().signal);
  assert.equal(retried.attempt?.status, 'correct');
  assert.equal(f.db.sqlite.prepare("SELECT weakness_count FROM grammar_mastery WHERE grammar_id = 'g1'").get()?.weakness_count, 2);
});
