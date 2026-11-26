import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISE_IDS, EXERCISES } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';
import { useScreenTimeTick } from '@/screentime/store';
import { MILESTONES_PE } from '@/screentime/rules';
import { formatMin, rateText, tierText } from '@/screentime/summary';
import { useSettings } from '@/storage/settings';
import { ExerciseGlyph } from '@/ui/Diagrams';
import { Body, Button, Display, Label, LinkText, Mono, Stat, Strong } from '@/ui/primitives';
import { color, radius, space, type } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';

const ORDER: Exercise[] = EXERCISE_IDS;

/** "Earn time": opened from a blocked app's screen or the Screen Time screen. Pick an exercise and do a set (plan §6). */
export default function EarnScreen() {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const st = useScreenTimeTick();
  const [settings, updateSettings] = useSettings();
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
        <Display size={type.pageHero}>{off ? 'Earning is off' : capLeft > 0 ? 'Move to unlock' : 'Done for today'}</Display>
        <Body tone="muted">
          {off
            ? 'Turn on earning in Screen time to get minutes for your sets.'
            : capLeft > 0
              ? `Every set earns minutes, plus ${formatMin(e.milestoneMin)} each time a set reaches 10 and 20 push-up equivalents, and a bonus for your first set of the day. After ${formatMin(e.fullRateMin)} earned, sets earn half. You can still earn ${formatMin(capLeft)} today. Earned time ends at midnight.`
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
            onPress={guard(() => {
              // Straight towards a set: the short guide (phone placement) leads into it.
              updateSettings({ exercise: x });
              router.push({ pathname: '/guide', params: { ex: x } });
            })}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
          >
            <ExerciseGlyph exercise={x} active size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Strong size={type.callout}>{EXERCISES[x].label}</Strong>
              <Mono size={type.small} tone="muted">
                {rateText(e.rates[x])}
              </Mono>
              {e.milestoneMin > 0 && (
                <Mono size={type.small} tone="vial">
                  {tierText(e.rates[x], e.milestoneMin, EXERCISES[x].unit, MILESTONES_PE)}
                </Mono>
              )}
            </View>
            <LinkText>Start ›</LinkText>
          </Pressable>
        ))}
      </View>

      <Body tone="muted" size={type.caption}>
        Only counted reps and time in good form earn minutes. Flagged reps earn half. Demo sets earn nothing.
      </Body>
      {off && <Button variant="ghost" label="Screen time settings" onPress={() => router.replace('/screen-time')} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: space.md,
    rowGap: space.xs,
    alignItems: 'center',
  },
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
