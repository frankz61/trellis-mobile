import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grammarRestDays, nextGrammarReview } from '../src/domain/mastery';
import { SqliteKnowledgeRepository } from '../src/infrastructure/database/knowledge-repository';
import { SqlitePracticeRepository } from '../src/infrastructure/database/practice-repository';
import { freshDatabase, sequentialIds } from './helpers';

const day = 24 * 60 * 60 * 1000;

test('a grammar review rests the point after a correct answer and brings it back tomorrow after a wrong one', () => {
  const now = new Date('2026-10-08T09:00:00Z');
  assert.deepEqual(nextGrammarReview(3, true, now), { weakness: 2, dueAt: new Date(now.getTime() + grammarRestDays.correct * day).toISOString() });
  assert.deepEqual(nextGrammarReview(3, false, now), { weakness: 4, dueAt: new Date(now.getTime() + grammarRestDays.incorrect * day).toISOString() });
  assert.equal(nextGrammarReview(0, true, now).weakness, 0);
});

test('practised grammar points leave the daily set until they are due, and a new mistake makes them due again', async () => {
  const db = await freshDatabase();
  db.sqlite.exec(`INSERT INTO sessions VALUES ('s1', 'p1', 't', 'now');
    INSERT INTO messages VALUES ('m1', 's1', 'user', 'a', 'complete', '2026-10-08T08:00:00Z');
    INSERT INTO messages VALUES ('m2', 's1', 'user', 'b', 'complete', '2026-10-09T08:00:00Z')`);
  const knowledge = new SqliteKnowledgeRepository(db, sequentialIds('k'));
  const practice = new SqlitePracticeRepository(db);
  await knowledge.applyExtraction('p1', 'm1', {
    words: [],
    mistakes: [
      // Two tense slips, so one correct answer leaves it weak but resting.
      { original: 'I go', corrected: 'I went', type: 'tense', explanation: '' },
      { original: 'she buy', corrected: 'she bought', type: 'tense', explanation: '' },
      { original: 'a apple', corrected: 'an apple', type: 'article', explanation: '' },
    ],
  }, '2026-10-08T08:00:00.000Z');
  const due = async (at: string) => (await knowledge.dueTargets('p1', at, { words: 2, grammar: 3 }))
    .filter((t) => t.type === 'grammar').map((t) => t.context.name).sort();
  assert.deepEqual(await due('2026-10-08T09:00:00.000Z'), ['articles (a / an / the)', 'verb tense']);

  // Answer a tense exercise correctly: tense rests for three days, article stays due.
  const tense = (await knowledge.dueTargets('p1', '2026-10-08T09:00:00.000Z', { words: 2, grammar: 3 })).find((t) => t.context.name === 'verb tense')!;
  await practice.createPlan({ id: 'plan', profileId: 'p1', localDate: '2026-10-08', timezone: 'UTC', version: 1, createdAt: '2026-10-08T09:00:00.000Z' },
    [{ id: 'e1', kind: 'cloze', prompt: 'I ____ (go) home yesterday.', answer: 'went', target: tense }]);
  await practice.createAttempt({ id: 'a1', exerciseId: 'e1', answer: 'went', status: 'pending', feedback: '', judgedBy: null }, '2026-10-08T09:00:00.000Z');
  await practice.judgeAttempt('a1', 'correct', '', 'local', '2026-10-08T09:00:00.000Z',
    { profileId: 'p1', targetType: 'grammar', targetId: tense.id, correct: true });
  assert.deepEqual(await due('2026-10-08T10:00:00.000Z'), ['articles (a / an / the)']);
  assert.deepEqual(await due('2026-10-11T09:00:00.000Z'), ['articles (a / an / the)', 'verb tense']);

  // A fresh tense mistake in conversation brings it back at once.
  await knowledge.applyExtraction('p1', 'm2', {
    words: [], mistakes: [{ original: 'he go', corrected: 'he went', type: 'tense', explanation: '' }],
  }, '2026-10-09T08:00:00.000Z');
  assert.deepEqual(await due('2026-10-09T08:00:00.000Z'), ['articles (a / an / the)', 'verb tense']);
});
