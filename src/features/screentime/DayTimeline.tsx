import { StyleSheet, View } from 'react-native';
import { deviceZone } from '@/screentime/time';
import { windowsToday } from '@/screentime/summary';
import type { ScreenTimeRules } from '@/screentime/types';
import { Mono } from '@/ui/primitives';
import { color, radius } from '@/ui/theme';

/** Today from midnight to midnight: lock times as blocks, and a tick for now. */
export function DayTimeline({ rules, now }: { rules: ScreenTimeRules; now: number }) {
  const { dayStart, dayEnd, windows } = windowsToday(deviceZone, rules, now);
  const span = dayEnd - dayStart;
  const at = (t: number) => `${((t - dayStart) / span) * 100}%` as const;
  return (
    <View
      accessible
      accessibilityLabel={
        windows.length ? `Lock times today: ${windows.map((w) => w.name).join(', ')}` : 'No lock times today'
      }
    >
      <View style={styles.track}>
        {windows.map((w, i) => (
          <View
            key={`${w.id}-${i}`}
            style={[
              styles.block,
              { left: at(w.start), width: `${((w.end - w.start) / span) * 100}%`, backgroundColor: w.earnable ? color.cue : color.fault },
            ]}
          />
        ))}
        <View style={[styles.now, { left: at(Math.min(Math.max(now, dayStart), dayEnd)) }]} />
      </View>
      <View style={styles.scale}>
        {['00', '06', '12', '18', '24'].map((h) => (
          <Mono key={h} size={10} tone="faint">
            {h}
          </Mono>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 14, borderRadius: radius.sm, backgroundColor: color.lineSoft, overflow: 'hidden' },
  block: { position: 'absolute', top: 0, bottom: 0, opacity: 0.85 },
  now: { position: 'absolute', top: -2, bottom: -2, width: 2, marginLeft: -1, backgroundColor: color.chalk },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
});
