import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutGraph, nodeAt } from '../src/components/graph-layout';
import {
  buildGraph, neighborhood, neighbors, nodeId, overview, type GraphSnapshot, type KnowledgeGraph,
} from '../src/domain/graph';
import { SqliteGraphRepository } from '../src/infrastructure/database/graph-repository';
import { SqliteKnowledgeRepository } from '../src/infrastructure/database/knowledge-repository';
import { freshDatabase, sequentialIds } from './helpers';

const snapshot: GraphSnapshot = {
  words: [
    { id: 'w1', lemma: 'exhausted', meaning: '精疲力尽', level: 5 },
    { id: 'w2', lemma: 'refreshing', meaning: '提神的', level: 0 },
  ],
  grammar: [{ id: 'g1', name: 'tense', weakness: 4 }, { id: 'g2', name: 'article', weakness: 2 }],
  sentences: [
    { id: 'm1', content: 'Yesterday I go to the park and I was very exhausted after it.', createdAt: '2026-09-21T10:00:00Z' },
    { id: 'm2', content: 'A refreshing drink.', createdAt: '2026-09-22T10:00:00Z' },
  ],
  evidence: [{ wordId: 'w1', messageId: 'm1' }, { wordId: 'w2', messageId: 'm2' }, { wordId: 'gone', messageId: 'm1' }],
  mistakes: [
    { id: 'x1', grammarId: 'g1', messageId: 'm1', original: 'I go', corrected: 'I went', explanation: '' },
    { id: 'x2', grammarId: 'g1', messageId: 'm1', original: 'I was', corrected: 'I felt', explanation: '' },
    { id: 'x3', grammarId: 'g2', messageId: 'm2', original: 'drink', corrected: 'a drink', explanation: '' },
  ],
};

test('the graph links words and grammar points to the sentences they came from', () => {
  const graph = buildGraph(snapshot);
  assert.equal(graph.nodes.length, 6);
  const tense = graph.nodes.find((n) => n.id === nodeId('grammar', 'g1'))!;
  assert.equal(tense.label, '时态');
  assert.equal(tense.weight, 1);
  assert.equal(graph.nodes.find((n) => n.id === nodeId('grammar', 'g2'))!.weight, 0.5);
  assert.equal(graph.nodes.find((n) => n.id === nodeId('word', 'w1'))!.weight, 1);
  assert.ok(graph.nodes.find((n) => n.kind === 'sentence')!.label.endsWith('…'));
  // Two tense mistakes in one sentence are one edge; evidence for a missing word is dropped.
  assert.equal(graph.edges.length, 4);
  assert.deepEqual(neighbors(graph, nodeId('sentence', 'm1')).map((n) => n.id).sort(), ['grammar:g1', 'word:w1']);
});

function star(concepts: number, sentences: number): KnowledgeGraph {
  const snap: GraphSnapshot = { words: [], grammar: [], sentences: [], evidence: [], mistakes: [] };
  for (let i = 0; i < concepts; i += 1) snap.words.push({ id: `w${i}`, lemma: `word${i}`, meaning: '', level: 0 });
  for (let i = 0; i < sentences; i += 1) {
    snap.sentences.push({ id: `m${i}`, content: `s${i}`, createdAt: '' });
    snap.evidence.push({ wordId: `w${i % concepts}`, messageId: `m${i}` });
  }
  snap.grammar.push({ id: 'g', name: 'tense', weakness: 9 });
  snap.mistakes.push({ id: 'x', grammarId: 'g', messageId: 'm0', original: '', corrected: '', explanation: '' });
  return buildGraph(snap);
}

test('the overview caps the node count, keeps grammar points and only connected sentences', () => {
  const small = buildGraph(snapshot);
  assert.equal(overview(small), small);
  const big = star(40, 60);
  const shown = overview(big, 20);
  assert.equal(shown.nodes.length, 20);
  assert.ok(shown.nodes.some((n) => n.id === 'grammar:g'));
  const ids = new Set(shown.nodes.map((n) => n.id));
  for (const node of shown.nodes.filter((n) => n.kind === 'sentence')) {
    assert.ok(neighbors(big, node.id).some((n) => ids.has(n.id)), `${node.id} is connected`);
  }
  assert.ok(shown.edges.every((e) => ids.has(e.source) && ids.has(e.target)));
});

test('a neighbourhood expands breadth-first from the focus up to the depth and limit', () => {
  const graph = buildGraph(snapshot);
  const around = neighborhood(graph, nodeId('word', 'w1'), 2);
  assert.deepEqual(around.nodes.map((n) => n.id).sort(), ['grammar:g1', 'sentence:m1', 'word:w1']);
  assert.equal(neighborhood(graph, nodeId('word', 'w1'), 1).nodes.length, 2);
  assert.deepEqual(neighborhood(graph, 'word:missing'), { nodes: [], edges: [] });
  // word0 appears in 15 of the 60 sentences; the limit stops the expansion.
  const hub = star(4, 60);
  assert.equal(neighbors(hub, 'word:w0').length, 15);
  assert.equal(neighborhood(hub, 'word:w0', 1, 10).nodes.length, 10);
});

test('layout is deterministic and keeps every node inside the margins', () => {
  const graph = star(12, 20);
  const first = layoutGraph(graph, 340, 374);
  const second = layoutGraph(graph, 340, 374);
  assert.deepEqual([...first.entries()], [...second.entries()]);
  for (const p of first.values()) {
    assert.ok(p.x >= 31.9 && p.x <= 308.1 && p.y >= 31.9 && p.y <= 342.1, JSON.stringify(p));
  }
  assert.equal(layoutGraph({ nodes: [], edges: [] }, 300, 300).size, 0);
  assert.deepEqual(layoutGraph({ nodes: [buildGraph(snapshot).nodes[0]!], edges: [] }, 300, 200).get('grammar:g1'), { x: 150, y: 100 });
});

test('the snapshot reads one learner’s extracted knowledge from SQLite', async () => {
  const db = await freshDatabase('p1');
  db.sqlite.exec(`INSERT INTO profiles VALUES ('p2', 'Other', 'now');
    INSERT INTO sessions VALUES ('s1', 'p1', 't', 'now'); INSERT INTO sessions VALUES ('s2', 'p2', 't', 'now');
    INSERT INTO messages VALUES ('m1', 's1', 'user', 'Yesterday I go to park.', 'complete', '2026-09-21');
    INSERT INTO messages VALUES ('m2', 's1', 'assistant', 'Sounds fun!', 'complete', '2026-09-21');
    INSERT INTO messages VALUES ('m3', 's2', 'user', 'Other learner.', 'complete', '2026-09-21')`);
  const knowledge = new SqliteKnowledgeRepository(db, sequentialIds('k'));
  await knowledge.applyExtraction('p1', 'm1', {
    words: [{ lemma: 'park', meaning: '公园' }],
    mistakes: [{ original: 'I go', corrected: 'I went', type: 'tense', explanation: '过去时' }],
  }, '2026-09-21T10:00:00Z');
  await knowledge.applyExtraction('p2', 'm3', { words: [{ lemma: 'other', meaning: '其他' }], mistakes: [] }, '2026-09-21T10:00:00Z');

  const snap = await new SqliteGraphRepository(db).snapshot('p1');
  assert.deepEqual(snap.words.map((w) => w.lemma), ['park']);
  assert.deepEqual(snap.grammar.map((g) => [g.name, g.weakness]), [['tense', 1]]);
  // Only sentences that carry knowledge appear; the coach's reply and the other learner's do not.
  assert.deepEqual(snap.sentences.map((s) => s.id), ['m1']);
  assert.equal(snap.evidence.length, 1);
  assert.deepEqual(snap.mistakes.map((m) => [m.original, m.corrected, m.messageId]), [['I go', 'I went', 'm1']]);
  const graph = buildGraph(snap);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);
});

test('a tap selects the nearest node within reach, or nothing', () => {
  const positions = new Map([['a', { x: 100, y: 100 }], ['b', { x: 130, y: 100 }]]);
  const reach = () => 24;
  assert.equal(nodeAt(positions, 104, 102, reach), 'a');
  assert.equal(nodeAt(positions, 120, 100, reach), 'b');
  assert.equal(nodeAt(positions, 200, 200, reach), null);
});
