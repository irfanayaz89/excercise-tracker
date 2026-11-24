import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useScreenTimeTick } from '@/screentime/store';
import { formatClock, formatMin, nextLock } from '@/screentime/summary';
import { deviceZone } from '@/screentime/time';
import { Body, Label, Mono, Strong } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';

/**
 * Home's screen time card: used vs. limit, earned minutes left, the next lock
 * time, and a red banner when protection is off. Hidden where the phone can't
 * block apps (Expo Go, web, iPhone builds without Screen Time).
 */
export function ScreenTimeCard({ guard }: { guard: (fn: () => void) => () => void }) {
  const st = useScreenTimeTick();
  if (st.availability === 'unsupported' && !st.meta.setUp) return null;

  if (!st.meta.setUp) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={guard(() => router.push('/screen-time/setup'))}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      >
        <Label tone="vial">Screen time</Label>
        <Strong size={18}>Earn your scroll</Strong>
        <Body tone="muted" size={14}>
          Block the apps that eat your day, and open them again with push-ups, crunches or a plank. Set up in a minute ›
        </Body>
      </Pressable>
    );
  }

  const d = st.decision;
  const now = st.now;
  const lost = st.meta.permissionLost || st.availability === 'needs-permission';
  const limit = st.rules.dailyLimitMin;
  const next = nextLock(deviceZone, st.rules, now);
  const status = lost
    ? null
    : d.blocked
      ? d.reason === 'focus' && d.focus
        ? `Workout focus until ${formatClock(deviceZone, d.focus.until, now)}`
        : d.reason === 'lock' && d.lock
          ? `Locked: ${d.lock.name} until ${formatClock(deviceZone, d.lock.until, now)}`
          : "Today's time is used up"
      : d.usingEarned
        ? `Open on earned time: ${formatMin(d.earnedLeftMin)} left`
        : d.unlockedUntil
          ? `Unlocked until ${formatClock(deviceZone, d.unlockedUntil, now)}`
          : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Screen time"
      onPress={guard(() => router.push(lost ? '/screen-time/setup' : '/screen-time'))}
      style={({ pressed }) => [styles.card, lost && styles.cardLost, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.head}>
        <Label tone={lost ? 'fault' : 'vial'}>Screen time</Label>
        {status && (
          <Mono size={12} tone={d.blocked ? 'fault' : 'good'}>
            {d.blocked ? 'Blocked' : 'Open'}
          </Mono>
        )}
      </View>
      {lost ? (
        <Body tone="fault" size={14}>
          Screen Time access is off, so your apps aren&apos;t blocked. Tap to turn it back on.
        </Body>
      ) : (
        <>
          {status && <Strong size={16}>{status}</Strong>}
          <View style={styles.stats}>
            <Stat label="Used today" value={limit === null ? formatMin(st.today.usedMin) : `${formatMin(Math.min(st.today.usedMin, limit))} / ${formatMin(limit)}`} />
            <Stat label="Earned left" value={formatMin(d.earnedLeftMin)} />
          </View>
          {next && (
            <Mono size={12} tone="muted">
              {next.running
                ? `${next.name} until ${formatClock(deviceZone, next.end, now)}`
                : `${next.name} at ${formatClock(deviceZone, next.start, now)}`}
            </Mono>
          )}
        </>
      )}
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Mono size={11} tone="muted">
        {label}
      </Mono>
      <Strong size={17}>{value}</Strong>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.lineSoft },
  cardLost: { borderColor: color.fault, backgroundColor: color.faultSoft },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stats: { flexDirection: 'row', gap: space.lg, marginTop: space.xs },
});
