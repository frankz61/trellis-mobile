import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AppServices } from '../app/bootstrap';
import { grammarLabel } from '../domain/knowledge';
import type { MistakeEntry, VocabularyEntry } from '../domain/learning';
import { maxLevel } from '../domain/mastery';
import { Card, colors, Heading, Notice, Page, styles } from '../components/ui';

export function LibraryScreen({ services }: { services: AppServices }) {
  const [data, setData] = useState<{ words: VocabularyEntry[]; mistakes: MistakeEntry[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([services.learning.vocabulary(), services.learning.mistakes()]).then(([words, mistakes]) => {
      if (active) setData({ words, mistakes });
    }).catch(() => { if (active) setError('暂时无法读取积累，请稍后重试。'); });
    return () => { active = false; };
  }, [services]);
  return <Page>
    <Heading eyebrow="WORDS THAT STAY" title="让学过的，留下来。" subtitle="生词与错因，连接每一次真实的表达。" />
    {error ? <Notice text={error} error /> : null}
    <Card>
      <Text style={styles.sectionTitle}>我的生词</Text>
      {!data ? <Notice text="正在读取…" /> : data.words.length === 0
        ? <Text style={styles.body}>还没有收录单词。和教练聊天时用到的生词会记录在这里。</Text>
        : data.words.map((word) => <View key={word.id} style={local.entry}>
          <View style={local.entryHead}>
            <Text style={local.lemma}>{word.lemma}</Text>
            <Text style={local.level} accessibilityLabel={`掌握度 ${word.level} / ${maxLevel}`}>{'●'.repeat(word.level)}{'○'.repeat(maxLevel - word.level)}</Text>
          </View>
          <Text style={styles.body}>{word.meaning}</Text>
        </View>)}
    </Card>
    <Card>
      <Text style={styles.sectionTitle}>我的错因</Text>
      {!data ? <Notice text="正在读取…" /> : data.mistakes.length === 0
        ? <Text style={styles.body}>还没有错因记录。每一次纠错都将保留原句、修改建议与解释。</Text>
        : data.mistakes.map((mistake) => <View key={mistake.id} style={local.entry}>
          <Text style={local.tag}>{grammarLabel(mistake.type)}</Text>
          <Text style={[styles.body, local.original]}>{mistake.original}</Text>
          <Text style={local.corrected}>→ {mistake.corrected}</Text>
          {mistake.explanation ? <Text style={styles.notice}>{mistake.explanation}</Text> : null}
        </View>)}
    </Card>
    <Notice text="记录来自模型对你发言的分析，可能有误判；后续版本会支持删除条目。" />
  </Page>;
}

const local = StyleSheet.create({
  entry: { gap: 4, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  entryHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lemma: { fontSize: 17, fontWeight: '700', color: colors.ink },
  level: { fontSize: 12, color: colors.green, letterSpacing: 2 },
  tag: { fontSize: 12, color: colors.green, fontWeight: '700' },
  original: { textDecorationLine: 'line-through', color: colors.muted },
  corrected: { fontSize: 15, lineHeight: 24, color: colors.ink, fontWeight: '600' },
});
