import { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import type { AppServices } from '../app/bootstrap';
import type { KeySource } from '../application/voice-access';
import { Button, Card, Notice, styles } from '../components/ui';
import {
  synthesisFormats, type RecognitionSettings, type SynthesisSettings, type VoiceEngine,
} from '../domain/voice';

type Note = { text: string; error: boolean } | null;

const keyLabel: Record<KeySource, string> = { own: '已单独保存', shared: '共用 AI 模型的 Key', missing: '未配置' };

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

// `wrap` lets many short options flow onto a second line instead of squeezing on narrow phones.
function Choice<T extends string>({ options, value, disabled, onChange, wrap = false }: {
  options: { value: T; label: string }[]; value: T; disabled: boolean; onChange: (value: T) => void; wrap?: boolean;
}) {
  return <View style={[styles.row, wrap && { flexWrap: 'wrap', gap: 8 }]}>
    {options.map((option) => <View key={option.value} style={wrap ? { minWidth: 76, flexGrow: 1 } : { flex: 1 }}>
      <Button label={option.label} secondary={value !== option.value} selected={value === option.value}
        disabled={disabled} onPress={() => onChange(option.value)} />
    </View>)}
  </View>;
}

const engines: { value: VoiceEngine; label: string }[] = [{ value: 'system', label: '系统' }, { value: 'online', label: '在线服务' }];

// Service address, model and key, shared by both online speech services.
function EndpointFields({ name, baseUrl, model, apiKey, keySource, disabled, onChange, onKey, children }: {
  name: string; baseUrl: string; model: string; apiKey: string; keySource: KeySource; disabled: boolean;
  onChange: (patch: { baseUrl?: string; model?: string }) => void; onKey: (key: string) => void; children?: React.ReactNode;
}) {
  return <>
    <Text style={styles.label}>服务地址</Text>
    <TextInput accessibilityLabel={`${name}服务地址`} style={styles.input} value={baseUrl} placeholder="https://example.com/v1"
      autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!disabled} onChangeText={(value) => onChange({ baseUrl: value })} />
    <Text style={styles.label}>模型名称</Text>
    <TextInput accessibilityLabel={`${name}模型名称`} style={styles.input} value={model} placeholder="服务商提供的模型 ID"
      autoCapitalize="none" autoCorrect={false} editable={!disabled} onChangeText={(value) => onChange({ model: value })} />
    {children}
    <Text style={styles.label}>API Key · {keyLabel[keySource]}</Text>
    <TextInput accessibilityLabel={`${name} API Key`} style={styles.input} value={apiKey} secureTextEntry autoCapitalize="none"
      autoCorrect={false} editable={!disabled} onChangeText={onKey}
      placeholder={keySource === 'own' ? '留空保留现有 Key' : '留空则共用 AI 模型的 Key（需同一主机）'} />
  </>;
}

function useCard<T>(initial: T) {
  const [form, setForm] = useState(initial);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  // Re-sync only when this section's saved values change: saving the other card reloads both,
  // and that must not discard edits still being made here.
  const saved = JSON.stringify(initial);
  useEffect(() => { setForm(JSON.parse(saved) as T); setApiKey(''); }, [saved]);
  async function run(task: () => Promise<string>, fallback: string) {
    setBusy(true);
    setNote(null);
    try {
      setNote({ text: await task(), error: false });
    } catch (cause) {
      setNote({ text: message(cause, fallback), error: true });
    } finally { setBusy(false); }
  }
  return { form, setForm, apiKey, setApiKey, busy, note, setNote, run };
}

function confirmDeleteKey(name: string, onConfirm: () => void) {
  Alert.alert(`删除${name}的 Key`, '删除后，同一主机上的 AI 模型 Key 会被共用；不在同一主机时需要重新填写。',
    [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: onConfirm }]);
}

export function RecognitionCard({ services, initial, keySource, modelBaseUrl, onSaved }: {
  services: AppServices; initial: RecognitionSettings; keySource: KeySource; modelBaseUrl: string; onSaved: () => void;
}) {
  const card = useCard(initial);
  const { form, setForm, busy } = card;
  const online = form.engine === 'online';

  return <Card>
    <Text style={styles.sectionTitle}>语音识别</Text>
    <Text style={styles.body}>在“陪练”页按“说”把你的英语转成文字。系统识别边说边出字；在线服务录完整段后上传转写，说完再点一次“停止”。</Text>
    <Choice options={engines} value={form.engine} disabled={busy}
      onChange={(engine) => setForm({ ...form, engine, baseUrl: engine === 'online' && !form.baseUrl ? modelBaseUrl : form.baseUrl })} />
    {online ? <EndpointFields name="语音识别" baseUrl={form.baseUrl} model={form.model} apiKey={card.apiKey} keySource={keySource}
      disabled={busy} onChange={(patch) => setForm({ ...form, ...patch })} onKey={card.setApiKey} /> : null}
    <Notice text={online
      ? '录音（每次最长 60 秒）会上传到这个服务，调用 POST /audio/transcriptions。'
      : '使用设备的系统语音识别服务；是否联网由系统决定。'} />
    <Button label={busy ? '正在保存…' : '保存语音识别设置'} disabled={busy} onPress={() => void card.run(async () => {
      await services.voiceSettings.saveRecognition(form, card.apiKey);
      onSaved();
      return '语音识别设置已保存。';
    }, '保存失败，请重试。')} />
    {online && keySource === 'own' ? <Button label="删除单独保存的 Key" secondary disabled={busy}
      onPress={() => confirmDeleteKey('语音识别', () => void card.run(async () => {
        await services.voiceSettings.clearKey('recognition');
        onSaved();
        return '已删除语音识别的 Key。';
      }, '删除失败，请重试。'))} /> : null}
    {card.note ? <Notice text={card.note.text} error={card.note.error} /> : null}
  </Card>;
}

export function SynthesisCard({ services, initial, keySource, modelBaseUrl, onSaved }: {
  services: AppServices; initial: SynthesisSettings; keySource: KeySource; modelBaseUrl: string; onSaved: () => void;
}) {
  const card = useCard(initial);
  const { form, setForm, busy } = card;
  const [speaking, setSpeaking] = useState(false);
  const online = form.engine === 'online';
  // Preview goes through the saved configuration; only the rate is taken from the unsaved form.
  const unsaved = JSON.stringify({ ...form, speechRate: 0 }) !== JSON.stringify({ ...initial, speechRate: 0 }) || Boolean(card.apiKey);

  useEffect(() => () => { void services.speech.stop().catch(() => undefined); }, [services]);

  async function preview() {
    setSpeaking(true);
    card.setNote(null);
    try {
      await services.speech.speak('A little practice every day makes a difference.', form.speechRate);
    } catch (cause) {
      card.setNote({ text: message(cause, '朗读失败。'), error: true });
    } finally { setSpeaking(false); }
  }

  return <Card>
    <Text style={styles.sectionTitle}>英语朗读</Text>
    <Text style={styles.body}>朗读“陪练”里教练的回复。系统声音由设备的语音引擎提供；在线服务按句生成音频再播放。</Text>
    <Choice options={engines} value={form.engine} disabled={busy}
      onChange={(engine) => setForm({ ...form, engine, baseUrl: engine === 'online' && !form.baseUrl ? modelBaseUrl : form.baseUrl })} />
    {online ? <EndpointFields name="朗读" baseUrl={form.baseUrl} model={form.model} apiKey={card.apiKey} keySource={keySource}
      disabled={busy} onChange={(patch) => setForm({ ...form, ...patch })} onKey={card.setApiKey}>
      <Text style={styles.label}>声音</Text>
      <TextInput accessibilityLabel="朗读声音" style={styles.input} value={form.voice} placeholder="例如 alloy、asteria"
        autoCapitalize="none" autoCorrect={false} editable={!busy} onChangeText={(voice) => setForm({ ...form, voice })} />
      <Text style={styles.label}>音频格式</Text>
      <Choice options={synthesisFormats.map((value) => ({ value, label: value }))} value={form.format} disabled={busy} wrap
        onChange={(format) => setForm({ ...form, format })} />
    </EndpointFields> : null}
    <Text style={styles.label}>语速</Text>
    <Choice options={[0.7, 0.85, 1].map((rate) => ({ value: String(rate), label: `${rate}×` }))} value={String(form.speechRate)}
      disabled={busy} onChange={(rate) => setForm({ ...form, speechRate: Number(rate) })} />
    <Notice text={online
      ? '回复文字会发送到这个服务，调用 POST /audio/speech；较长的回复按每段最多 2000 字符分段朗读。'
      : '使用设备上的英语声音；是否联网由语音引擎决定。'} />
    <Button label={busy ? '正在保存…' : '保存朗读设置'} disabled={busy} onPress={() => void card.run(async () => {
      await services.voiceSettings.saveSynthesis(form, card.apiKey);
      onSaved();
      return '朗读设置已保存。';
    }, '保存失败，请重试。')} />
    <Button label={speaking ? '停止朗读' : '试听一句英语'} secondary disabled={busy}
      onPress={() => {
        if (speaking) void services.speech.stop().catch(() => card.setNote({ text: '停止朗读失败。', error: true }));
        else void preview();
      }} />
    {unsaved ? <Notice text="试听使用已保存的朗读设置（语速除外），修改后请先保存。" /> : null}
    {online && keySource === 'own' ? <Button label="删除单独保存的 Key" secondary disabled={busy}
      onPress={() => confirmDeleteKey('朗读', () => void card.run(async () => {
        await services.voiceSettings.clearKey('synthesis');
        onSaved();
        return '已删除朗读的 Key。';
      }, '删除失败，请重试。'))} /> : null}
    {card.note ? <Notice text={card.note.text} error={card.note.error} /> : null}
  </Card>;
}
