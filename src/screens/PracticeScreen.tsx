import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppServices } from '../app/bootstrap';
import { Button, Card, colors, Notice, styles } from '../components/ui';
import { maxUserMessageLength, type ConversationMessage } from '../domain/conversation';

const statusLabel: Partial<Record<ConversationMessage['status'], string>> = {
  interrupted: '回复已中断',
  failed: '回复失败',
};

function Bubble({ message, speaking, onSpeak }: { message: ConversationMessage; speaking: boolean; onSpeak?: () => void }) {
  const mine = message.role === 'user';
  const placeholder = message.content ? null : message.status === 'pending' ? '…' : '（没有收到回复内容）';
  return <View style={[local.bubbleRow, mine && local.bubbleRowMine]}>
    <View style={[local.bubble, mine ? local.bubbleMine : local.bubbleCoach]} accessibilityLabel={mine ? '我说' : '教练说'}>
      <Text style={[local.bubbleText, mine && local.bubbleTextMine, placeholder && !mine && local.bubblePlaceholder]}>{placeholder ?? message.content}</Text>
      {statusLabel[message.status] ? <Text style={local.bubbleStatus}>{statusLabel[message.status]}</Text> : null}
      {onSpeak && message.content && message.status !== 'pending' ? <Pressable accessibilityRole="button" accessibilityLabel={speaking ? '停止朗读' : '朗读这句'}
        onPress={onSpeak} style={local.speak}><Text style={local.speakLabel}>{speaking ? '■ 停止' : '▶ 朗读'}</Text></Pressable> : null}
    </View>
  </View>;
}

export function PracticeScreen({ services, openSettings }: { services: AppServices; openSettings: () => void }) {
  const [messages, setMessages] = useState<ConversationMessage[] | null>(null);
  const [configured, setConfigured] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [extraction, setExtraction] = useState('');
  const [rate, setRate] = useState(0.85);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const controller = useRef<AbortController | null>(null);
  const recognizing = useRef<AbortController | null>(null);
  const extracting = useRef<AbortController | null>(null);
  const list = useRef<ScrollView>(null);

  useEffect(() => {
    let active = true;
    Promise.all([services.conversation.restore(), services.settings.load()]).then(([history, config]) => {
      if (!active) return;
      setMessages(history);
      setRate(config.settings.speechRate);
      setConfigured(config.hasApiKey && Boolean(config.settings.baseUrl && config.settings.model));
    }).catch(() => { if (active) setError('无法读取对话记录，请重新打开应用。'); });
    return () => {
      active = false;
      // Leaving the screen ends the request; the partial reply is kept and marked as interrupted.
      controller.current?.abort();
      extracting.current?.abort();
      recognizing.current?.abort();
      void services.speech.stop().catch(() => undefined);
    };
  }, [services]);

  // Scroll after layout, not on state change: a long history is not measured yet when the effect runs,
  // and the keyboard shrinks the list without changing its content. The extra frame lets the native
  // side commit the new content size first; scrolling inside the callback itself is a no-op on Fabric.
  const scrollToLatest = () => { requestAnimationFrame(() => list.current?.scrollToEnd({ animated: false })); };

  // Knowledge extraction runs after the reply, as a persisted task, so a crash or an
  // abort here only delays it: the task is retried on the next launch.
  async function extract() {
    const request = new AbortController();
    extracting.current = request;
    setExtraction('正在整理这轮对话的生词与错因…');
    let words = 0;
    let mistakes = 0;
    let recorded = false;
    try {
      const result = await services.knowledge.runPending(request.signal, (outcome) => {
        recorded = true; words += outcome.words; mistakes += outcome.mistakes;
      });
      if (request.signal.aborted) return;
      if (recorded) {
        setExtraction(words || mistakes ? `已记录 ${words} 个生词、${mistakes} 处纠错，可在“积累”查看。` : '这轮对话没有需要记录的生词或错因。');
      } else if (result.failed) {
        setExtraction('这轮的生词与错因暂时没能整理，稍后会自动重试。');
      } else {
        setExtraction('');
      }
    } finally {
      if (extracting.current === request) extracting.current = null;
    }
  }

  async function speak(message: ConversationMessage) {
    if (speakingId === message.id) {
      await services.speech.stop().catch(() => undefined);
      setSpeakingId(null);
      return;
    }
    setVoiceNote('');
    setSpeakingId(message.id);
    try {
      await services.speech.speak(message.content, rate);
    } catch (cause) {
      setVoiceNote(cause instanceof Error ? cause.message : '朗读失败。');
    } finally {
      setSpeakingId((current) => (current === message.id ? null : current));
    }
  }

  // One utterance per tap: the coach is silenced first so its voice is not transcribed as the learner's.
  async function listen() {
    if (listening) { recognizing.current?.abort(); return; }
    setVoiceNote('');
    await services.speech.stop().catch(() => undefined);
    setSpeakingId(null);
    const capability = await services.recognition.capability('en-US');
    if (!capability.available) { setVoiceNote(capability.reason ?? '语音识别不可用。'); return; }
    const request = new AbortController();
    recognizing.current = request;
    setListening(true);
    const before = draft.trim();
    const join = (text: string) => (before ? `${before} ${text}` : text);
    try {
      const text = await services.recognition.recognize('en-US', request.signal, (partial) => setDraft(join(partial)));
      setDraft(join(text));
      if (!capability.onDevice) setVoiceNote('识别由系统语音服务完成，可能经过网络。');
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) setVoiceNote(cause instanceof Error ? cause.message : '语音识别失败。');
    } finally {
      if (recognizing.current === request) recognizing.current = null;
      setListening(false);
    }
  }

  async function send() {
    const text = draft;
    const request = new AbortController();
    controller.current = request;
    let persisted = false;
    setDraft('');
    setError('');
    setExtraction('');
    setSending(true);
    let completed = false;
    try {
      const result = await services.conversation.send(text, request.signal, (next) => { persisted = true; setMessages(next); });
      completed = result.at(-1)?.status === 'complete';
    } catch (cause) {
      if (!persisted) setDraft(text);
      setError(cause instanceof Error ? cause.message : '发送失败，请稍后重试。');
    } finally {
      if (controller.current === request) controller.current = null;
      setSending(false);
    }
    if (completed) void extract();
  }

  const empty = messages !== null && messages.length === 0;
  return <View style={local.root}>
    <ScrollView ref={list} style={local.list} contentContainerStyle={local.listContent} keyboardShouldPersistTaps="handled"
      onContentSizeChange={scrollToLatest} onLayout={scrollToLatest}>
      {empty ? <>
        <Text style={local.title}>开口，从一个想法开始。</Text>
        <Card>
          <Text style={styles.sectionTitle}>和 AI 教练聊聊</Text>
          <Text style={styles.body}>聊一聊今天的生活，练一段面试回答。教练会用英语自然回应，并在需要时示范更地道的表达。</Text>
          <Notice text="对话会发送给你在“我的”页面配置的模型服务。每轮回复后，会再请求一次模型整理你这句话里的生词与错因，记录到“积累”，并用于安排“今天”的练习。" />
        </Card>
      </> : null}
      {messages === null ? <Notice text="正在读取对话…" /> : messages.map((message) => <Bubble key={message.id} message={message} speaking={speakingId === message.id}
        onSpeak={message.role === 'assistant' ? () => void speak(message) : undefined} />)}
      {extraction ? <Notice text={extraction} /> : null}
      {voiceNote ? <Notice text={voiceNote} /> : null}
      {error ? <Notice text={error} error /> : null}
      {!configured && messages !== null ? <Card>
        <Text style={styles.body}>连接模型后即可开始对话。</Text>
        <Button label="设置模型与 API Key" onPress={openSettings} secondary />
      </Card> : null}
    </ScrollView>
    <View style={local.composer}>
      <Button label={listening ? '停止' : '说'} secondary={!listening} disabled={!configured || sending || messages === null}
        onPress={() => void listen()} />
      <TextInput accessibilityLabel="消息输入" style={[styles.input, local.input]} value={draft} onChangeText={setDraft}
        placeholder={listening ? '正在听你说英语…' : '用英语说点什么…'} multiline maxLength={maxUserMessageLength}
        editable={configured && !sending && !listening && messages !== null} />
      {sending
        ? <Button label="停止" secondary onPress={() => controller.current?.abort()} />
        : <Button label="发送" onPress={() => void send()} disabled={!configured || messages === null || listening || !draft.trim()} />}
    </View>
  </View>;
}

const local = StyleSheet.create({
  root: { flex: 1 },
  list: { flex: 1 },
  listContent: { padding: 24, gap: 14, paddingBottom: 16, maxWidth: 640, width: '100%', alignSelf: 'center' },
  title: { fontSize: 26, fontWeight: '700', color: colors.ink, lineHeight: 36, marginBottom: 4 },
  bubbleRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '86%', borderRadius: 18, paddingVertical: 12, paddingHorizontal: 16, gap: 6 },
  bubbleCoach: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderTopLeftRadius: 6 },
  bubbleMine: { backgroundColor: colors.green, borderTopRightRadius: 6 },
  bubbleText: { fontSize: 15, lineHeight: 23, color: colors.ink },
  bubbleTextMine: { color: '#FFFFFF' },
  bubblePlaceholder: { color: colors.muted },
  speak: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.pale },
  speakLabel: { fontSize: 12, color: colors.green, fontWeight: '700' },
  bubbleStatus: { fontSize: 12, color: colors.error },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, maxHeight: 132, paddingTop: 14 },
});
