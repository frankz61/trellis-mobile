import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';
import type { AppServices } from '../app/bootstrap';
import { layoutGraph, nodeAt } from '../components/graph-layout';
import { Button, Card, colors, Notice, styles } from '../components/ui';
import {
  buildGraph, neighborhood, neighbors, overview, type GraphNode, type GraphSnapshot,
} from '../domain/graph';
import { maxLevel } from '../domain/mastery';

const newWord = '#D9A441';

// Linear blend of two #RRGGBB colours.
function mix(from: string, to: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * t)
    .toString(16).padStart(2, '0')).join('')}`;
}

function radius(node: GraphNode): number {
  if (node.kind === 'grammar') return 10 + 10 * node.weight;
  return node.kind === 'word' ? 8 : 5;
}

function fill(node: GraphNode): string {
  if (node.kind === 'grammar') return mix('#E7B7B0', colors.error, node.weight);
  return node.kind === 'word' ? mix(newWord, colors.green, node.weight) : colors.muted;
}

function Legend() {
  const item = (color: string, label: string) => <View style={local.legendItem}>
    <View style={[local.dot, { backgroundColor: color }]} /><Text style={styles.notice}>{label}</Text>
  </View>;
  return <View style={local.legend}>
    {item(colors.error, '语法薄弱点（越大越弱）')}
    {item(newWord, '新词')}
    {item(colors.green, '已掌握')}
    {item(colors.muted, '你说过的句子')}
  </View>;
}

function Chip({ node, onPress }: { node: GraphNode; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`查看 ${node.label}`} onPress={onPress} style={local.chip}>
    <View style={[local.dot, { backgroundColor: fill(node) }]} />
    <Text style={local.chipLabel} numberOfLines={1}>{node.label}</Text>
  </Pressable>;
}

function Details({ snapshot, node, related, select }: {
  snapshot: GraphSnapshot; node: GraphNode; related: GraphNode[]; select: (id: string) => void;
}) {
  const chips = (kind: GraphNode['kind']) => related.filter((n) => n.kind === kind)
    .map((n) => <Chip key={n.id} node={n} onPress={() => select(n.id)} />);
  if (node.kind === 'word') {
    const word = snapshot.words.find((w) => w.id === node.ref)!;
    return <>
      <Text style={local.detailTitle}>{word.lemma}</Text>
      <Text style={styles.body}>{word.meaning}</Text>
      <Text style={styles.notice}>掌握度 {'●'.repeat(word.level)}{'○'.repeat(maxLevel - word.level)} · 出现在 {related.length} 个句子里</Text>
      <View style={local.chips}>{chips('sentence')}</View>
    </>;
  }
  if (node.kind === 'grammar') {
    const grammar = snapshot.grammar.find((g) => g.id === node.ref)!;
    const mistakes = snapshot.mistakes.filter((m) => m.grammarId === node.ref);
    return <>
      <Text style={local.detailTitle}>{node.label}</Text>
      <Text style={styles.notice}>薄弱次数 {grammar.weakness} · {mistakes.length} 处纠错</Text>
      {mistakes.map((m) => <View key={m.id} style={local.mistake}>
        <Text style={[styles.body, local.original]}>{m.original}</Text>
        <Text style={local.corrected}>→ {m.corrected}</Text>
        {m.explanation ? <Text style={styles.notice}>{m.explanation}</Text> : null}
      </View>)}
    </>;
  }
  const sentence = snapshot.sentences.find((s) => s.id === node.ref)!;
  const mistakes = snapshot.mistakes.filter((m) => m.messageId === node.ref);
  return <>
    <Text style={styles.body}>“{sentence.content}”</Text>
    <Text style={styles.notice}>{sentence.createdAt.slice(0, 10)}</Text>
    {related.some((n) => n.kind === 'word') ? <><Text style={styles.label}>用到的词</Text><View style={local.chips}>{chips('word')}</View></> : null}
    {related.some((n) => n.kind === 'grammar') ? <><Text style={styles.label}>涉及的薄弱点</Text><View style={local.chips}>{chips('grammar')}</View></> : null}
    {mistakes.map((m) => <View key={m.id} style={local.mistake}>
      <Text style={[styles.body, local.original]}>{m.original}</Text>
      <Text style={local.corrected}>→ {m.corrected}</Text>
    </View>)}
  </>;
}

export function KnowledgeGraphView({ services }: { services: AppServices }) {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    services.graph.snapshot(services.profileId).then((value) => { if (active) setSnapshot(value); })
      .catch(() => { if (active) setError('暂时无法读取知识图谱，请稍后重试。'); });
    return () => { active = false; };
  }, [services]);

  const full = useMemo(() => (snapshot ? buildGraph(snapshot) : null), [snapshot]);
  const shown = useMemo(() => (full ? (focus ? neighborhood(full, focus) : overview(full)) : null), [full, focus]);
  const height = Math.round(width * 1.1);
  const positions = useMemo(() => (shown && width ? layoutGraph(shown, width, height) : null), [shown, width, height]);
  const selectedNode = shown?.nodes.find((node) => node.id === selected) ?? null;
  const related = useMemo(() => (full && selected ? neighbors(full, selected) : []), [full, selected]);
  const highlighted = new Set([selected, ...related.map((n) => n.id)]);

  const byId = useMemo(() => new Map(shown?.nodes.map((node) => [node.id, node]) ?? []), [shown]);

  // Selecting a node that the current view does not contain re-centres the view on it.
  function select(id: string) {
    if (shown && !shown.nodes.some((node) => node.id === id)) setFocus(id);
    setSelected(id);
  }

  if (error) return <Notice text={error} error />;
  if (!snapshot || !full || !shown) return <Notice text="正在读取知识图谱…" />;
  if (!full.nodes.length) {
    return <Card>
      <Text style={styles.sectionTitle}>知识图谱</Text>
      <Text style={styles.body}>还没有可以连成图谱的记录。和教练聊几句，整理出的生词和错因会连到你说过的句子上。</Text>
    </Card>;
  }

  return <>
    <Card>
      <Text style={styles.sectionTitle}>{focus ? `以“${full.nodes.find((n) => n.id === focus)?.label}”为中心` : '知识图谱'}</Text>
      <Legend />
      {/* Taps are resolved here rather than on SVG elements, whose hit-testing is unreliable on Android. */}
      <Pressable onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width))} style={local.canvas}
        onPress={(event) => {
          if (!positions) return;
          const hit = nodeAt(positions, event.nativeEvent.locationX, event.nativeEvent.locationY,
            (id) => Math.max(radius(byId.get(id)!) + 10, 24));
          if (hit) select(hit); else setSelected(null);
        }}>
        {positions ? <Svg width={width} height={height} accessibilityLabel="知识图谱" pointerEvents="none">
          {shown.edges.map((edge) => {
            const a = positions.get(edge.source)!;
            const b = positions.get(edge.target)!;
            const lit = selected !== null && (edge.source === selected || edge.target === selected);
            return <Line key={`${edge.source}|${edge.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={edge.kind === 'mistake' ? colors.error : colors.green}
              strokeOpacity={lit ? 0.8 : selected ? 0.12 : 0.3} strokeWidth={lit ? 2 : 1} />;
          })}
          {shown.nodes.map((node) => {
            const p = positions.get(node.id)!;
            const r = radius(node);
            const dimmed = selected !== null && !highlighted.has(node.id);
            const labelled = node.kind !== 'sentence' || node.id === selected;
            return <G key={node.id} opacity={dimmed ? 0.35 : 1}>
              <Circle cx={p.x} cy={p.y} r={r} fill={fill(node)} stroke={node.id === selected ? colors.ink : colors.surface}
                strokeWidth={node.id === selected ? 3 : 1.5} />
              {labelled ? <SvgText x={p.x} y={p.y + r + 13} fontSize={node.kind === 'grammar' ? 13 : 12}
                fontWeight={node.kind === 'grammar' ? 'bold' : 'normal'} fill={colors.ink} textAnchor="middle">{node.label}</SvgText> : null}
            </G>;
          })}
        </Svg> : null}
      </Pressable>
      {!focus && shown.nodes.length < full.nodes.length
        ? <Notice text={`内容较多，总览只显示了 ${shown.nodes.length} / ${full.nodes.length} 个节点；点一个节点再“以它为中心”可看到其余部分。`} /> : null}
      {selectedNode ? null : <Notice text="点一个节点查看详情。" />}
      {focus ? <Button label="回到总览" secondary onPress={() => { setFocus(null); setSelected(null); }} /> : null}
    </Card>
    {selectedNode ? <Card>
      <Details snapshot={snapshot} node={selectedNode} related={related} select={select} />
      {selectedNode.id !== focus ? <Button label="以它为中心展开" secondary onPress={() => setFocus(selectedNode.id)} /> : null}
    </Card> : null}
  </>;
}

const local = StyleSheet.create({
  canvas: { width: '100%', borderRadius: 16, backgroundColor: colors.background, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.pale },
  chipLabel: { color: colors.ink, fontSize: 14, flexShrink: 1 },
  detailTitle: { fontSize: 20, fontWeight: '700', color: colors.ink },
  mistake: { gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  original: { textDecorationLine: 'line-through', color: colors.muted },
  corrected: { fontSize: 15, lineHeight: 24, color: colors.ink, fontWeight: '600' },
});
