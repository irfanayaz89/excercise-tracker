import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISES } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';
import { useScreenTimeTick } from '@/screentime/store';
import { formatMin } from '@/screentime/summary';
import type { Rate } from '@/screentime/types';
import { useSettings } from '@/storage/settings';
import { ExerciseGlyph } from '@/ui/Diagrams';
import { Body, Button, Display, Label, Mono, Strong } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';

const ORDER: Exercise[] = ['pushup', 'crunch', 'plank', 'sidePlank'];

const rateText = (r: Rate) =>
  r.per10s !== undefined ? `${r.per10s} min for every 10 s in good form` : `${r.perCleanRep} min per clean rep`;

/** "Earn time": opened from a blocked app's screen or the Screen Time screen. Pick an exercise and do a set (plan §6). */
export default function EarnScreen() {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const st = useScreenTimeTick();
  const [settings] = useSettings();
  const e = st.rules.earning;
  const capLeft = Math.max(0, e.dailyCapMin - st.today.earnedMin);
  const order = [...settings.focus, ...ORDER.filter((x) => !settings.focus.includes(x))];
  const off = !st.meta.setUp || !e.enabled;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.huge }]}
    >
      <View style={styles.header}>
        <Label tone="vial">Earn time</Label>
        <Pressable accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12}>
          <Label tone="chalk">Close</Label>
        </Pressable>
      </View>

      <View style={{ gap: space.sm }}>
        <Display size={44}>{off ? 'Earning is off' : capLeft > 0 ? 'Move to unlock' : 'Done for today'}</Display>
        <Body tone="muted">
          {off
            ? 'Turn on earning in Screen time to get minutes for your sets.'
            : capLeft > 0
              ? `Every finished set adds minutes to today. You can still earn ${formatMin(capLeft)} today. Earned time ends at midnight.`
              : `You've earned today's ${formatMin(e.dailyCapMin)}. Sets still count for your history.`}
        </Body>
      </View>

      <View style={styles.stats}>
        <Stat label="Earned left" value={formatMin(st.decision.earnedLeftMin)} />
        <Stat label="Earned today" value={`${formatMin(st.today.earnedMin)} / ${formatMin(e.dailyCapMin)}`} />
      </View>

      <View style={{ gap: space.md }}>
        {order.map((x) => (
          <Pressable
            key={x}
            accessibilityRole="button"
            accessibilityLabel={`${EXERCISES[x].label}: ${rateText(e.rates[x])}`}
            onPress={guard(() => router.push({ pathname: '/exercise/[id]', params: { id: x } }))}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
          >
            <ExerciseGlyph exercise={x} active size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Strong size={17}>{EXERCISES[x].label}</Strong>
              <Mono size={12} tone="muted">
                {rateText(e.rates[x])}
              </Mono>
            </View>
            <Label tone="vial">Start ›</Label>
          </Pressable>
        ))}
      </View>

      <Body tone="faint" size={13}>
        Only counted reps and time in good form earn minutes. Flagged reps earn half. Demo sets earn nothing.
      </Body>
      {off && <Button variant="ghost" label="Screen time settings" onPress={() => router.replace('/screen-time')} />}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Mono size={11} tone="muted">
        {label}
      </Mono>
      <Strong size={18}>{value}</Strong>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stats: { flexDirection: 'row', gap: space.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.lineSoft,
  },
});
