import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings, type Experience } from '@/storage/settings';
import { Body, Display, Label, Mono, Strong } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';

const CHOICES: { value: Experience; eyebrow: string; title: string; points: string[] }[] = [
  {
    value: 'guided',
    eyebrow: 'New to this',
    title: 'Guide me',
    points: ['Step-by-step setup with pictures', 'Full spoken instructions', 'Form tips after every set'],
  },
  {
    value: 'quick',
    eyebrow: 'I know the drill',
    title: 'Keep it quick',
    points: ['One tap to start', 'Short cues, clean screens', 'Just the numbers'],
  },
];

/** First launch: one question that shapes how much the app explains. */
export default function Welcome() {
  const insets = useSafeAreaInsets();
  const [, update] = useSettings();

  const pick = (experience: Experience) => {
    update({ experience });
    router.replace('/');
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space.huge, paddingBottom: insets.bottom + space.xxl }]}
    >
      <View style={styles.wordmark}>
        <View style={styles.markLine} />
        <Display size={24} style={{ letterSpacing: 5 }}>
          TRUELINE
        </Display>
      </View>

      <View style={{ gap: space.md }}>
        <Display size={44}>How much help do you want?</Display>
        <Body tone="muted">
          Your phone watches you from the floor, counts every push-up and checks your form. Pick how much it explains along the way.
        </Body>
      </View>

      <View style={{ gap: space.md }}>
        {CHOICES.map((c) => (
          <Pressable
            key={c.value}
            accessibilityRole="button"
            accessibilityLabel={`${c.title}. ${c.points.join('. ')}`}
            onPress={() => pick(c.value)}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <Label tone="vial">{c.eyebrow}</Label>
            <Display size={34}>{c.title}</Display>
            <View style={{ gap: 6 }}>
              {c.points.map((p) => (
                <View key={p} style={styles.point}>
                  <View style={styles.tick} />
                  <Strong size={15} tone="chalk">
                    {p}
                  </Strong>
                </View>
              ))}
            </View>
          </Pressable>
        ))}
      </View>

      <Mono tone="faint" style={{ textAlign: 'center' }}>
        You can change this anytime in Settings.
      </Mono>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  markLine: { width: 22, height: 4, borderRadius: 2, backgroundColor: color.vial },
  card: {
    gap: space.md,
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.line,
  },
  cardPressed: { borderColor: color.vial, backgroundColor: color.raised, transform: [{ scale: 0.99 }] },
  point: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tick: { width: 14, height: 4, borderRadius: 2, backgroundColor: color.vial },
});
