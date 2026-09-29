import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppServices } from '../app/bootstrap';
import type { DailyPractice } from '../application/practice-service';
import type { LearningSummary } from '../domain/learning';
import { exerciseKindLabels } from '../domain/practice';
import { Button, Card, colors, Heading, Notice, Page, styles } from '../components/ui';
import type { ExerciseWithAttempt } from '../repositories/contracts';

function ExerciseCard({ exercise, answer, busy, onAnswer, onSubmit }: {
  exercise: ExerciseWithAttempt; answer: string; busy: boolean; onAnswer: (text: string) => void; onSubmit: () => void;
}) {
  const { attempt } = exercise;
  const judged = attempt && attempt.status !== 'pending';
  return <View style={local.exercise}>
    <Text style={local.exerciseMeta}>{exerciseKindLabels[exercise.kind]} · {exercise.targetType === 'word' ? '生词' : '语法'} · {exercise.targetLabel}</Text>
    <Text style={local.exercisePrompt}>{exercise.prompt}</Text>
    {attempt ? <Text style={styles.body}>你的回答：{attempt.answer}</Text> : <TextInput accessibilityLabel="练习答案" style={styles.input}
      value={answer} onChangeText={onAnswer} placeholder="写下你的答案" multiline editable={!busy} />}
    {judged ? <>
      <Text style={[local.verdict, attempt.status === 'incorrect' && { color: colors.error }]}>
        {attempt.status === 'correct' ? '答对了' : '再想想'}{attempt.judgedBy === 'model' ? ' · 模型评价' : ' · 本地判分'}
      </Text>
      {attempt.feedback ? <Text style={styles.body}>{attempt.feedback}</Text> : null}
      {attempt.status === 'incorrect' ? <Text style={styles.notice}>参考答案：{exercise.answer}</Text> : null}
    </> : <Button label={busy ? '正在评价…' : attempt ? '重新评价' : '提交'} secondary={Boolean(attempt)}
      disabled={busy || (!attempt && !answer.trim())} onPress={onSubmit} />}
  </View>;
}

export function TodayScreen({ services, openSettings, openLibrary, openPractice }: {
  services: AppServices; openSettings: () => void; openLibrary: () => void; openPractice: () => void;
}) {
  const [summary, setSummary] = useState<LearningSummary | null>(null);
  const [configured, setConfigured] = useState(false);
  const [practice, setPractice] = useState<DailyPractice | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [practiceError, setPracticeError] = useState('');
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([services.learning.summary(), services.settings.load(), services.practice.today()]).then(([data, config, plan]) => {
      if (!active) return;
      setSummary(data);
      setConfigured(config.hasApiKey);
      setPractice(plan);
    }).catch(() => { if (active) setError('读取学习空间失败，请重新打开应用。'); });
    return () => { active = false; request.current?.abort(); };
  }, [services]);

  async function run(label: string, task: (signal: AbortSignal) => Promise<DailyPractice | ExerciseWithAttempt>) {
    const controller = new AbortController();
    request.current = controller;
    setBusy(label);
    setPracticeError('');
    try {
      const result = await task(controller.signal);
      if (controller.signal.aborted) return;
      if ('exercises' in result) {
        setPractice(result);
      } else {
        setPractice((current) => current && { ...current, exercises: current.exercises.map((e) => (e.id === result.id ? result : e)) });
      }
      const refreshed = await services.learning.summary();
      if (!controller.signal.aborted) setSummary(refreshed);
    } catch (cause) {
      if (!controller.signal.aborted) setPracticeError(cause instanceof Error ? cause.message : '操作失败，请稍后重试。');
    } finally {
      if (request.current === controller) request.current = null;
      setBusy(null);
    }
  }

  const generating = busy === 'generate';
  return <Page>
    <Heading eyebrow="GROW YOUR ENGLISH" title="一点点，也在生长。" subtitle="把每一次表达，变成下一次进步。" />
    <View style={local.hero}>
      <Text style={local.heroTag}>你的英语学习空间</Text>
      <Text style={local.heroTitle}>{configured ? '准备好，开始积累。' : '从认识你的教练开始'}</Text>
      <Text style={local.heroBody}>{configured
        ? '模型已连接。去“陪练”用英语聊几句，生词和错因会记录下来，成为今天的练习。'
        : '先连接你使用的 AI 模型。学习记录留在手机里，陪练时按需发送相关上下文。'}</Text>
      {configured
        ? <><Button label="开始陪练" onPress={openPractice} secondary /><Button label="查看模型设置" onPress={openSettings} secondary /></>
        : <Button label="配置我的 AI 教练" onPress={openSettings} secondary />}
    </View>
    <Text style={styles.sectionTitle}>我的积累</Text>
    <View style={styles.row}>
      {[['单词', summary?.words], ['错因', summary?.mistakes], ['对话', summary?.sessions]].map(([label, value]) =>
        <View key={label} style={local.stat}>
          <Text style={local.number}>{value ?? '—'}</Text><Text style={styles.notice}>{label}</Text>
        </View>)}
    </View>
    {error ? <Notice text={error} error /> : null}
    <Card>
      <Text style={styles.sectionTitle}>今天的练习</Text>
      {practice === null ? <Notice text="正在读取…" /> : practice.plan === null ? <>
        <Text style={styles.body}>{practice.hasTargets
          ? '根据你最近的生词和薄弱点出几道题；题目由模型生成，今天内重复打开不会再次出题。'
          : '还没有需要复习的内容。先去“陪练”聊几句，记录下生词和错因，这里才会有针对你的练习。'}</Text>
        {practice.hasTargets
          ? <Button label={generating ? '正在出题…' : '生成今天的练习'} disabled={!configured || Boolean(busy)}
            onPress={() => void run('generate', (signal) => services.practice.generate(signal))} />
          : <Button label="去陪练" onPress={openPractice} secondary />}
      </> : <>
        {practice.exercises.map((exercise) => <ExerciseCard key={exercise.id} exercise={exercise} answer={answers[exercise.id] ?? ''}
          busy={busy === exercise.id} onAnswer={(text) => setAnswers({ ...answers, [exercise.id]: text })}
          onSubmit={() => void run(exercise.id, (signal) => services.practice.answer(exercise.id, answers[exercise.id] ?? '', signal))} />)}
        <Notice text="填空题答案完全一致时在本机判分，其余由模型评价；掌握度按本地规则更新，每题只计一次。" />
        <Button label={generating ? '正在出题…' : '重新生成（保留已完成的题）'} secondary disabled={Boolean(busy)}
          onPress={() => void run('generate', (signal) => services.practice.generate(signal))} />
      </>}
      {practiceError ? <Notice text={practiceError} error /> : null}
      <Button label="看看我的积累" onPress={openLibrary} secondary />
    </Card>
  </Page>;
}

const local = StyleSheet.create({
  hero: { borderRadius: 26, padding: 24, gap: 18, backgroundColor: colors.ink },
  heroTag: { fontSize: 12, color: '#BDD2BD', letterSpacing: 1 },
  heroTitle: { fontSize: 25, lineHeight: 35, color: '#FFFFFF', fontWeight: '700' },
  heroBody: { color: '#D5E4D9', fontSize: 14, lineHeight: 23 },
  stat: { flex: 1, paddingVertical: 20, alignItems: 'center', gap: 6, backgroundColor: colors.pale, borderRadius: 18 },
  number: { fontSize: 28, color: colors.ink, fontWeight: '600' },
  exercise: { gap: 10, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.border },
  exerciseMeta: { fontSize: 12, color: colors.green, fontWeight: '700', letterSpacing: 0.5 },
  exercisePrompt: { fontSize: 16, lineHeight: 25, color: colors.ink },
  verdict: { fontSize: 14, fontWeight: '700', color: colors.green },
});
