import { StyleSheet, View } from 'react-native';
import type { Kcal } from '@/fitness/energy';
import { kcal, weight } from '@/fitness/format';
import { forecastBest, projectWeightChange, projectWorkouts } from '@/fitness/projection';
import type { Units } from '@/storage/profile';
import { Body, Display, Label, Mono } from '@/ui/primitives';
import { color, radius, space, type } from '@/ui/theme';
import { CaloriesHow } from './Calories';

/**
 * "In 30 and 60 days": one number per column, the one that matters for the
 * goal (weight with an eating target, best set with a rep forecast, otherwise
 * workout calories), with its likely range underneath. Ranges, not promises
 * (FTC and ASA rules on weight-loss claims; App Store 1.4.1). Fat equivalents,
 * eating back, and why the scale lags are on the "How it's worked out" screen.
 */
export function ProjectionCard({
  perSession,
  perWeek,
  units,
  dailyDeficit = 0,
  forecast = null,
  targetChangeKg = null,
}: {
  perSession: Kcal;
  perWeek: number;
  units: Units;
  /** Eating gap a day, for a lose-fat goal with a calorie target. */
  dailyDeficit?: number;
  /** A rep forecast from the user's own best set (at least two weeks of sets). */
  forecast?: { label: string; best: number } | null;
  /** Kilograms left to the target weight: the band never goes past it. */
  targetChangeKg?: number | null;
}) {
  const cols = ([30, 60] as const).map((d) => {
    const work = projectWorkouts(perSession, perWeek, d);
    const note = `${work.sessions} workouts`;
    if (dailyDeficit > 0) {
      const w = projectWeightChange(dailyDeficit, d, work.total.kcal);
      if (targetChangeKg !== null && w.kg >= targetChangeKg) return { d, big: 'Goal', sub: 'likely reached by then', note };
      const high = targetChangeKg !== null ? Math.min(w.high, targetChangeKg) : w.high;
      return { d, big: `−${weight(w.kg, units)}`, sub: `likely ${weight(w.low, units, false)}–${weight(high, units)}`, note };
    }
    if (forecast) {
      const f = forecastBest(forecast.best, d);
      return { d, big: `${f.low}–${f.high}`, sub: `${forecast.label.toLowerCase()} in one set`, note };
    }
    return { d, big: `${kcal(work.total.kcal)} kcal`, sub: `likely ${kcal(work.total.low)}–${kcal(work.total.high)}`, note };
  });
  return (
    <View style={styles.card}>
      <Label>In 30 and 60 days</Label>
      <View style={styles.cols}>
        {cols.map((c) => (
          <View
            key={c.d}
            style={styles.col}
            accessible
            accessibilityLabel={`In ${c.d} days: ${c.big.replace('−', 'minus ')}, ${c.sub}, from ${c.note}`}
          >
            <Mono size={type.small} tone="muted">{`${c.d} days`}</Mono>
            <Display size={type.displayM}>{c.big}</Display>
            <Body size={type.caption} tone="muted">
              {c.sub}
            </Body>
            <Mono size={type.small} tone="muted">
              {c.note}
            </Mono>
          </View>
        ))}
      </View>
      <View style={styles.foot}>
        <Body size={type.caption} tone="muted">
          Estimates, not promises.
        </Body>
        <CaloriesHow label="How it's worked out ›" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.lineSoft,
  },
  cols: { flexDirection: 'row', gap: space.lg },
  col: { flex: 1, gap: 2 },
  foot: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.md,
    rowGap: space.xs,
  },
});
