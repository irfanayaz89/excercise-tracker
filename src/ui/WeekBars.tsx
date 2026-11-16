import { StyleSheet, View } from 'react-native';
import { Mono } from './primitives';
import { color, space } from './theme';

const DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Seven day bars, oldest first, today highlighted. */
export function WeekBars({ days, values, label, height = 70 }: { days: Date[]; values: number[]; label: string; height?: number }) {
  const peak = Math.max(1, ...values);
  return (
    <View style={[styles.week, { height }]} accessible accessibilityLabel={label}>
      {values.map((v, i) => {
        const isToday = i === values.length - 1;
        return (
          <View key={i} style={styles.col}>
            <View style={styles.track}>
              <View
                style={[styles.bar, { height: `${Math.max(v > 0 ? 8 : 0, (v / peak) * 100)}%`, backgroundColor: isToday ? color.vial : color.chalk2 }]}
              />
            </View>
            <Mono size={11} tone={isToday ? 'vial' : 'faint'}>
              {DAY[days[i].getDay()]}
            </Mono>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row', gap: space.sm },
  col: { flex: 1, alignItems: 'center', gap: 4 },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end', borderRadius: 3, backgroundColor: color.surface, overflow: 'hidden' },
  bar: { width: '100%', borderRadius: 3 },
});
