import type { GraphNodeKind, KnowledgeGraph } from '../domain/graph';

export interface Point { x: number; y: number }

// Grammar points start near the middle, words around them, sentences on the outside; the force
// simulation then pulls connected nodes together. Starting positions depend only on ids, so the
// same graph always gets the same picture.
const ring: Record<GraphNodeKind, number> = { grammar: 0.25, word: 0.6, sentence: 0.95 };

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

// Fruchterman–Reingold with a weak pull to the centre so unconnected parts stay on screen.
// O(n² · iterations); fine for the few dozen nodes the view shows.
export function layoutGraph(graph: KnowledgeGraph, width: number, height: number, margin = 32, iterations = 300): Map<string, Point> {
  const positions = new Map<string, Point>();
  const n = graph.nodes.length;
  if (!n) return positions;
  const cx = width / 2;
  const cy = height / 2;
  if (n === 1) return positions.set(graph.nodes[0]!.id, { x: cx, y: cy });

  const radius = Math.min(width, height) / 2 - margin;
  for (const node of graph.nodes) {
    const angle = hash(node.id) * Math.PI * 2;
    const r = radius * ring[node.kind] * (0.85 + 0.3 * hash(`${node.id}#r`));
    positions.set(node.id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }

  const k = 0.9 * Math.sqrt((width * height) / n);
  // Pull towards the centre, scaled so it balances repulsion at about the drawing radius.
  const gravity = (0.5 * k) / radius;
  const ids = graph.nodes.map((node) => node.id);
  let temperature = Math.min(width, height) / 8;
  const cooling = temperature / (iterations + 1);
  for (let step = 0; step < iterations; step += 1) {
    const shift = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = positions.get(ids[i]!)!;
        const b = positions.get(ids[j]!)!;
        const dx = a.x - b.x || 0.01;
        const dy = a.y - b.y || 0.01;
        const distance = Math.max(0.01, Math.hypot(dx, dy));
        const force = (k * k) / distance;
        const sa = shift.get(ids[i]!)!;
        const sb = shift.get(ids[j]!)!;
        sa.x += (dx / distance) * force; sa.y += (dy / distance) * force;
        sb.x -= (dx / distance) * force; sb.y -= (dy / distance) * force;
      }
    }
    for (const edge of graph.edges) {
      const a = positions.get(edge.source)!;
      const b = positions.get(edge.target)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const force = (distance * distance) / k;
      const sa = shift.get(edge.source)!;
      const sb = shift.get(edge.target)!;
      sa.x -= (dx / distance) * force; sa.y -= (dy / distance) * force;
      sb.x += (dx / distance) * force; sb.y += (dy / distance) * force;
    }
    for (const id of ids) {
      const p = positions.get(id)!;
      const s = shift.get(id)!;
      s.x += (cx - p.x) * gravity;
      s.y += (cy - p.y) * gravity;
      const length = Math.max(0.01, Math.hypot(s.x, s.y));
      const move = Math.min(length, temperature);
      p.x += (s.x / length) * move;
      p.y += (s.y / length) * move;
    }
    temperature = Math.max(0.5, temperature - cooling);
  }

  // Fit the result into the drawing area.
  const xs = [...positions.values()].map((p) => p.x);
  const ys = [...positions.values()].map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scaleX = maxX - minX > 1 ? (width - 2 * margin) / (maxX - minX) : 0;
  const scaleY = maxY - minY > 1 ? (height - 2 * margin) / (maxY - minY) : 0;
  for (const p of positions.values()) {
    p.x = scaleX ? margin + (p.x - minX) * scaleX : cx;
    p.y = scaleY ? margin + (p.y - minY) * scaleY : cy;
  }
  return positions;
}

// The node under a tap: the nearest centre within `reach`, so small dots stay easy to hit.
export function nodeAt(positions: Map<string, Point>, x: number, y: number, reach: (id: string) => number): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const [id, p] of positions) {
    const distance = Math.hypot(p.x - x, p.y - y);
    if (distance <= reach(id) && distance < bestDistance) { best = id; bestDistance = distance; }
  }
  return best;
}
