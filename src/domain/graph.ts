import { grammarLabel } from './knowledge';
import { maxLevel } from './mastery';

// Raw rows behind the learner's knowledge graph, as stored in SQLite.
export interface GraphSnapshot {
  words: { id: string; lemma: string; meaning: string; level: number }[];
  grammar: { id: string; name: string; weakness: number }[];
  sentences: { id: string; content: string; createdAt: string }[];
  // A word was used or learned in this message.
  evidence: { wordId: string; messageId: string }[];
  // A mistake in this message belongs to this grammar point.
  mistakes: { id: string; grammarId: string; messageId: string; original: string; corrected: string; explanation: string }[];
}

export type GraphNodeKind = 'word' | 'grammar' | 'sentence';

export interface GraphNode {
  // Namespaced (`word:…`, `grammar:…`, `sentence:…`) so ids from different tables never collide.
  id: string;
  kind: GraphNodeKind;
  // Database id of the word, grammar point or message.
  ref: string;
  label: string;
  // 0..1: mastery for words, relative weakness for grammar points, 0 for sentences.
  weight: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: 'appears' | 'mistake';
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Enough to stay legible on a phone screen.
export const maxVisibleNodes = 36;

export const nodeId = (kind: GraphNodeKind, ref: string) => `${kind}:${ref}`;

function sentenceLabel(content: string): string {
  const text = content.replace(/\s+/g, ' ').trim();
  return text.length > 24 ? `${text.slice(0, 23)}…` : text;
}

export function buildGraph(snapshot: GraphSnapshot): KnowledgeGraph {
  const strongest = Math.max(1, ...snapshot.grammar.map((g) => g.weakness));
  const nodes: GraphNode[] = [
    ...snapshot.grammar.map((g) => ({
      id: nodeId('grammar', g.id), kind: 'grammar' as const, ref: g.id, label: grammarLabel(g.name), weight: g.weakness / strongest,
    })),
    ...snapshot.words.map((w) => ({
      id: nodeId('word', w.id), kind: 'word' as const, ref: w.id, label: w.lemma, weight: w.level / maxLevel,
    })),
    ...snapshot.sentences.map((s) => ({
      id: nodeId('sentence', s.id), kind: 'sentence' as const, ref: s.id, label: sentenceLabel(s.content), weight: 0,
    })),
  ];
  const known = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  const add = (edge: GraphEdge) => {
    const key = `${edge.source}|${edge.target}`;
    if (!known.has(edge.source) || !known.has(edge.target) || seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };
  for (const e of snapshot.evidence) add({ source: nodeId('word', e.wordId), target: nodeId('sentence', e.messageId), kind: 'appears' });
  // Several mistakes of one kind in one sentence are a single edge.
  for (const m of snapshot.mistakes) add({ source: nodeId('grammar', m.grammarId), target: nodeId('sentence', m.messageId), kind: 'mistake' });
  return { nodes, edges };
}

export function neighbors(graph: KnowledgeGraph, id: string): GraphNode[] {
  const ids = new Set(graph.edges.flatMap((e) => (e.source === id ? [e.target] : e.target === id ? [e.source] : [])));
  return graph.nodes.filter((node) => ids.has(node.id));
}

function induced(graph: KnowledgeGraph, keep: Set<string>): KnowledgeGraph {
  return {
    nodes: graph.nodes.filter((node) => keep.has(node.id)),
    edges: graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}

function degree(graph: KnowledgeGraph): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of graph.edges) {
    counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
    counts.set(e.target, (counts.get(e.target) ?? 0) + 1);
  }
  return counts;
}

// The whole graph when it fits; otherwise grammar points first (weakest first), then the most
// connected words, then the sentences that link what is already shown.
export function overview(graph: KnowledgeGraph, limit = maxVisibleNodes): KnowledgeGraph {
  if (graph.nodes.length <= limit) return graph;
  const counts = degree(graph);
  const rank = (kind: GraphNodeKind, by: (node: GraphNode) => number) => graph.nodes
    .filter((node) => node.kind === kind)
    .sort((a, b) => by(b) - by(a) || a.label.localeCompare(b.label));
  const keep = new Set<string>();
  const concepts = [...rank('grammar', (n) => n.weight), ...rank('word', (n) => counts.get(n.id) ?? 0)];
  for (const node of concepts.slice(0, Math.ceil(limit * 0.6))) keep.add(node.id);
  const linking = rank('sentence', (n) => neighbors(graph, n.id).filter((m) => keep.has(m.id)).length);
  for (const node of linking) {
    if (keep.size >= limit) break;
    if (neighbors(graph, node.id).some((m) => keep.has(m.id))) keep.add(node.id);
  }
  return induced(graph, keep);
}

// Breadth-first around one node, so a focused view shows its sentences and what else they touch.
export function neighborhood(graph: KnowledgeGraph, focus: string, depth = 2, limit = maxVisibleNodes): KnowledgeGraph {
  if (!graph.nodes.some((node) => node.id === focus)) return { nodes: [], edges: [] };
  const keep = new Set([focus]);
  let frontier = [focus];
  for (let level = 0; level < depth && frontier.length; level += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const node of neighbors(graph, id)) {
        if (keep.size >= limit) break;
        if (!keep.has(node.id)) { keep.add(node.id); next.push(node.id); }
      }
    }
    frontier = next;
  }
  return induced(graph, keep);
}
