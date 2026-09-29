import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, TextInput } from 'react-native';
import type { AppServices } from '../app/bootstrap';
import type { VoiceSettingsView } from '../application/voice-settings-service';
import { defaultSettings, type ModelSettings } from '../domain/settings';
import { Button, Card, Heading, Notice, Page, styles } from '../components/ui';
import { RecognitionCard, SynthesisCard } from './VoiceSettingsCards';

export function SettingsScreen({ services }: { services: AppServices }) {
  const [settings, setSettings] = useState<ModelSettings>(defaultSettings);
  const [temperature, setTemperature] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState<VoiceSettingsView | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [backupNote, setBackupNote] = useState('');
  const [backupError, setBackupError] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);

  // Voice key status depends on the model key (sharing), so it is reloaded after either changes.
  const reloadVoice = useCallback(() => services.voiceSettings.load().then(setVoice).catch(() => {
    setMessage('读取语音设置失败，请重新打开应用。'); setError(true);
  }), [services]);

  useEffect(() => {
    let active = true;
    services.settings.load().then((loaded) => {
      if (!active) return;
      setSettings(loaded.settings);
      setTemperature(loaded.settings.temperature === null ? '' : String(loaded.settings.temperature));
      setHasApiKey(loaded.hasApiKey);
      setReady(true);
    }).catch(() => {
      if (active) { setMessage('读取设置失败，请重新打开应用。'); setError(true); }
    });
    void reloadVoice();
    return () => { active = false; };
  }, [services, reloadVoice]);

  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const saved = await services.settings.save(
        { ...settings, temperature: temperature.trim() ? Number(temperature.trim()) : null }, apiKey,
      );
      setSettings(saved);
      setApiKey('');
      setHasApiKey(true);
      setError(false);
      setMessage('配置已保存到本机。尚未测试模型连接。');
      void reloadVoice();
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally { setBusy(false); }
  }

  async function clearKey() {
    setBusy(true);
    try {
      await services.settings.clearApiKey();
      setHasApiKey(false);
      setApiKey('');
      setSettings((current) => ({ ...current, credentialRef: null }));
      setError(false);
      setMessage('已删除本机保存的 API Key。');
      void reloadVoice();
    } catch {
      setError(true);
      setMessage('删除失败，请重试。');
    } finally { setBusy(false); }
  }

  async function exportBackup() {
    setBackupBusy(true);
    setBackupNote('');
    try {
      const name = await services.backup.exportToFile();
      setBackupError(false);
      setBackupNote(name ? `已导出到你选择的文件夹：${name}。备份不包含 API Key。` : '已取消导出。');
    } catch (cause) {
      setBackupError(true);
      setBackupNote(cause instanceof Error ? cause.message : '导出失败。');
    } finally { setBackupBusy(false); }
  }

  async function restoreBackup() {
    setBackupBusy(true);
    setBackupNote('');
    try {
      const summary = await services.backup.restoreFromFile();
      setBackupError(false);
      setBackupNote(summary
        ? `已恢复 ${summary.exportedAt ? summary.exportedAt.slice(0, 10) + ' 的备份' : '备份'}：${summary.sessions} 个会话、${summary.words} 个单词、${summary.mistakes} 条错因。切换页面即可看到。`
        : '已取消恢复。');
    } catch (cause) {
      setBackupError(true);
      setBackupNote(cause instanceof Error ? cause.message : '恢复失败，现有数据未改动。');
    } finally { setBackupBusy(false); }
  }

  return <Page>
    <Heading eyebrow="MADE FOR YOU" title="我的学习方式" subtitle="连接你的模型，找到舒服的节奏。" />
    <Card>
      <Text style={styles.sectionTitle}>AI 模型</Text>
      <Text style={styles.label}>服务地址</Text>
      <TextInput accessibilityLabel="模型服务地址" style={styles.input} value={settings.baseUrl}
        placeholder="https://example.com/v1" autoCapitalize="none" autoCorrect={false} keyboardType="url"
        editable={ready && !busy} onChangeText={(baseUrl) => setSettings({ ...settings, baseUrl })} />
      <Text style={styles.label}>模型名称</Text>
      <TextInput accessibilityLabel="模型名称" style={styles.input} value={settings.model}
        placeholder="服务商提供的模型 ID" autoCapitalize="none" autoCorrect={false}
        editable={ready && !busy} onChangeText={(model) => setSettings({ ...settings, model })} />
      <Text style={styles.label}>温度（可选）</Text>
      <TextInput accessibilityLabel="模型温度" style={styles.input} value={temperature}
        placeholder="留空使用服务默认值，例如 0.3" keyboardType="decimal-pad"
        editable={ready && !busy} onChangeText={setTemperature} />
      <Text style={styles.label}>API Key · {hasApiKey ? '已保存' : '未配置'}</Text>
      <TextInput accessibilityLabel="API Key" style={styles.input} value={apiKey}
        placeholder={hasApiKey ? '留空保留现有 Key' : '填写你自己的 API Key'} secureTextEntry autoCapitalize="none" autoCorrect={false}
        editable={ready && !busy} onChangeText={setApiKey} />
      <Notice text="Key 保存在系统安全存储中。对话、整理生词和出题时，会把所需文本发给你配置的服务商。" />
      <Button label={busy ? '正在保存…' : '保存配置'} onPress={() => void save()} disabled={!ready || busy} />
      {hasApiKey ? <Button label="删除已保存的 Key" secondary disabled={busy} onPress={() => Alert.alert(
        '删除 API Key', '学习记录会保留，下次连接模型需要重新填写 Key。',
        [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void clearKey() }],
      )} /> : null}
    </Card>
    {message ? <Notice text={message} error={error} /> : null}
    {voice ? <>
      <RecognitionCard services={services} initial={voice.settings.recognition} keySource={voice.keys.recognition}
        modelBaseUrl={settings.baseUrl} onSaved={() => void reloadVoice()} />
      <SynthesisCard services={services} initial={voice.settings.synthesis} keySource={voice.keys.synthesis}
        modelBaseUrl={settings.baseUrl} onSaved={() => void reloadVoice()} />
    </> : null}
    <Card>
      <Text style={styles.sectionTitle}>数据备份</Text>
      <Text style={styles.body}>把对话、生词、错因和练习记录导出为一个 JSON 文件，保存到你选择的文件夹；恢复会用备份替换本机现有学习数据。</Text>
      <Button label={backupBusy ? '请稍候…' : '导出备份'} secondary disabled={backupBusy} onPress={() => void exportBackup()} />
      <Button label="从备份恢复" secondary disabled={backupBusy} onPress={() => Alert.alert(
        '从备份恢复', '本机现有的对话、生词、错因和练习记录会被备份内容替换，模型配置和 Key 不受影响。',
        [{ text: '取消', style: 'cancel' }, { text: '选择文件并恢复', style: 'destructive', onPress: () => void restoreBackup() }],
      )} />
      {backupNote ? <Notice text={backupNote} error={backupError} /> : null}
    </Card>
    <Notice text={'Trellis · 0.1.0 · 本地学习空间\n由 frankz61 维护'} />
  </Page>;
}
