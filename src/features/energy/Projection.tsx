import { StyleSheet, View } from 'react-native';
import type { Kcal } from '@/fitness/energy';
import { kcal, weight } from '@/fitness/format';
import { forecastBest, projectWeightChange, projectWorkouts } from '@/fitness/projection';
import type { Units } from '@/storage/profile';
import { Body, Display, Label, Mono } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';
import { CaloriesHow } from './Calories';

const range = (k: Kcal) => `${kcal(k.low)}–${kcal(k.high)}`;

/**
 * "Your next 30 and 60 days": what the plan can honestly do. Ranges, not
 * promises (FTC and ASA rules on weight-loss claims; App Store 1.4.1): workout
 * calories and their fat-energy after people eat some back, a weight band only
 * when there is an eating target, and a rep forecast only from the user's own
 * sets.
 */
export function ProjectionCard({
  perSession,
  perWeek,
  units,
  dailyDeficit = 0,
  forecast = null,
  targetChangeKg = null,
  title = 'Your next 30 and 60 days',
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
  title?: string;
}) {
  const days = [30, 60] as const;
  const work = days.map((d) => projectWorkouts(perSession, perWeek, d));
  const diet = dailyDeficit > 0 ? days.map((d, i) => projectWeightChange(dailyDeficit, d, work[i].total.kcal)) : null;
  return (
    <View style={styles.card} accessible accessibilityLabel={`${title}.`}>
      <Label>{title}</Label>
      <View style={styles.cols}>
        {days.map((d, i) => (
          <View key={d} style={{ flex: 1, gap: 2 }}>
            <Mono size={12} tone="muted">{`${d} days`}</Mono>
            <Display size={34}>{`${kcal(work[i].total.kcal)} kcal`}</Display>
            <Mono size={12} tone="muted">
              {`${range(work[i].total)} from ${work[i].sessions} workouts`}
            </Mono>
            <Body size={14}>{`≈ the energy in ${kcal(work[i].fatG.kcal)} g of body fat`}</Body>
            {diet && (
              <Body size={14} tone="vial">
                {targetChangeKg !== null && diet[i].kg >= targetChangeKg
                  ? `With your eating target: your goal (−${weight(targetChangeKg, units)}) is likely reached by then`
                  : `With your eating target: −${weight(diet[i].kg, units)} (${weight(diet[i].low, units, false)}–${weight(
                      targetChangeKg !== null ? Math.min(diet[i].high, targetChangeKg) : diet[i].high,
                      units,
                    )})`}
              </Body>
            )}
            {forecast && (
              <Body size={14} tone="good">
                {(() => {
                  const f = forecastBest(forecast.best, d);
                  return `${forecast.label}: likely ${f.low}–${f.high} in a set`;
                })()}
              </Body>
            )}
          </View>
        ))}
      </View>
      <Body tone="muted" size={13}>
        {`Your scale may not move while fat goes down: strength work swaps a little fat for muscle (about half a kilo of fat in 8 weeks in trials). People also eat back about a fifth of workout calories, which is already taken off here.${
          forecast ? '' : ' Reps usually climb fastest in the first weeks; after two weeks of sets Trueline forecasts yours.'
        }`}
      </Body>
      <CaloriesHow label="How this is worked out ›" />
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
});
