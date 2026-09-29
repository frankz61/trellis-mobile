import type { PropsWithChildren } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export const colors = {
  background: '#F6F7F2', surface: '#FFFFFF', ink: '#193D34', muted: '#697970',
  green: '#246B50', pale: '#EAF1E7', border: '#DCE5D9', error: '#A13434',
};

export function Page({ children }: PropsWithChildren) {
  return <ScrollView style={styles.page} contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
}

export function Heading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <View style={styles.heading}>
    <Text style={styles.eyebrow}>{eyebrow}</Text>
    <Text style={styles.title} accessibilityRole="header">{title}</Text>
    <Text style={styles.body}>{subtitle}</Text>
  </View>;
}

export function Card({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

export function Button({ label, onPress, secondary = false, disabled = false, selected }: {
  label: string; onPress: () => void; secondary?: boolean; disabled?: boolean; selected?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || pressed) && styles.dimmed]}>
    <Text style={[styles.buttonLabel, secondary && styles.secondaryLabel]}>{label}</Text>
  </Pressable>;
}

export function Notice({ text, error = false }: { text: string; error?: boolean }) {
  return <Text accessibilityLiveRegion="polite" style={[styles.notice, error && { color: colors.error }]}>{text}</Text>;
}

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  pageContent: { padding: 24, gap: 18, paddingBottom: 32, maxWidth: 640, width: '100%', alignSelf: 'center' },
  heading: { gap: 10, marginVertical: 12 },
  eyebrow: { fontSize: 11, letterSpacing: 2.5, color: colors.green, fontWeight: '700' },
  title: { fontSize: 30, fontWeight: '700', color: colors.ink, lineHeight: 40 },
  body: { fontSize: 15, lineHeight: 24, color: colors.muted },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 22, padding: 22, gap: 14 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  button: { minHeight: 50, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green },
  secondary: { backgroundColor: colors.pale },
  buttonLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  secondaryLabel: { color: colors.green },
  dimmed: { opacity: 0.55 },
  notice: { fontSize: 13, lineHeight: 21, color: colors.muted },
  row: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, fontSize: 15, color: colors.ink, backgroundColor: colors.background, minHeight: 50 },
});
