import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors, Notice } from '../components/ui';
import { TodayScreen } from '../screens/TodayScreen';
import { PracticeScreen } from '../screens/PracticeScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { bootstrap, type AppServices } from './bootstrap';

const tabs = [
  { id: 'today', label: '今天', icon: 'sunny-outline' },
  { id: 'practice', label: '陪练', icon: 'chatbubbles-outline' },
  { id: 'library', label: '积累', icon: 'leaf-outline' },
  { id: 'settings', label: '我的', icon: 'person-outline' },
] as const;
type Tab = (typeof tabs)[number]['id'];

function Application() {
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('today');

  useEffect(() => {
    let active = true;
    setError('');
    bootstrap().then((value) => { if (active) setServices(value); }).catch(() => {
      if (active) setError('学习空间暂时无法打开。请重试；现有数据不会被清空。');
    });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab === 'today') return false;
      setTab('today');
      return true;
    });
    return () => listener.remove();
  }, [tab]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void services?.speech.stop().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [services]);

  // Extraction tasks left over from an earlier launch are finished quietly in the background.
  useEffect(() => {
    if (!services) return;
    const controller = new AbortController();
    void services.knowledge.runPending(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [services]);

  if (!services) return <View style={local.loading}>
    <Text style={local.brand}>Trellis</Text>
    {error ? <><Notice text={error} error /><Button label="重新打开" onPress={() => setAttempt((value) => value + 1)} /></>
      : <><ActivityIndicator color={colors.green} /><Notice text="正在打开你的学习空间…" /></>}
  </View>;

  // Edge-to-edge (Android 15+) disables adjustResize, so Android also needs explicit padding.
  return <KeyboardAvoidingView style={local.root} behavior="padding">
    <View style={local.header}>
      <View style={local.logo}><Ionicons name="leaf" size={20} color={colors.green} /><Text style={local.brand}>Trellis</Text></View>
      <Text style={local.badge}>本地学习空间</Text>
    </View>
    <View style={local.content}>
      {tab === 'today' && <TodayScreen services={services} openSettings={() => setTab('settings')} openLibrary={() => setTab('library')} openPractice={() => setTab('practice')} />}
      {tab === 'practice' && <PracticeScreen services={services} openSettings={() => setTab('settings')} />}
      {tab === 'library' && <LibraryScreen services={services} />}
      {tab === 'settings' && <SettingsScreen services={services} />}
    </View>
    <View style={local.tabs} accessibilityRole="tablist">
      {tabs.map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.label}
        accessibilityState={{ selected: tab === item.id }} onPress={() => setTab(item.id)} style={local.tab}>
        <View style={[local.tabIcon, tab === item.id && { backgroundColor: colors.pale }]}>
          <Ionicons name={item.icon} size={22} color={tab === item.id ? colors.green : colors.muted} />
        </View>
        <Text style={[local.tabLabel, tab === item.id && { color: colors.green, fontWeight: '700' }]}>{item.label}</Text>
      </Pressable>)}
    </View>
  </KeyboardAvoidingView>;
}

export default function TrellisApp() {
  return <SafeAreaProvider>
    <SafeAreaView style={local.root}>
      <StatusBar style="dark" />
      <Application />
    </SafeAreaView>
  </SafeAreaProvider>;
}

const local = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 24 },
  header: { paddingHorizontal: 24, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brand: { color: colors.ink, fontWeight: '700', fontSize: 23, letterSpacing: -0.7 },
  badge: { color: colors.green, fontSize: 11, backgroundColor: colors.pale, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 10 },
  content: { flex: 1 },
  tabs: { flexDirection: 'row', backgroundColor: colors.surface, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  tab: { flex: 1, alignItems: 'center', gap: 4, minHeight: 52 },
  tabIcon: { paddingHorizontal: 18, paddingVertical: 5, borderRadius: 20 },
  tabLabel: { fontSize: 11, color: colors.muted },
});
