import { Pressable, StyleSheet, View } from 'react-native';
import type { Exercise } from '@/engine/types';
import { EXERCISE_COPY } from '@/session/copy';
import { ExerciseGlyph } from './Diagrams';
import { Mono, Strong } from './primitives';
import { color, radius, space } from './theme';

const SUB: Record<Exercise, string> = { pushup: 'Counted reps', plank: 'Timed hold' };

/** Two big tiles, each with its own figure, so push-ups and plank never look alike. */
export function ExercisePicker({ value, onChange }: { value: Exercise; onChange: (e: Exercise) => void }) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Exercise">
      {(['pushup', 'plank'] as const).map((e) => {
        const on = value === e;
        return (
          <Pressable
            key={e}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${EXERCISE_COPY[e].label}, ${SUB[e].toLowerCase()}`}
            onPress={() => onChange(e)}
            style={({ pressed }) => [styles.tile, on && styles.tileOn, pressed && { opacity: 0.85 }]}
          >
            <ExerciseGlyph exercise={e} active={on} />
            <View style={{ gap: 2, flexShrink: 1 }}>
              <Strong size={15}>{EXERCISE_COPY[e].label}</Strong>
              <Mono size={12} tone={on ? 'vial' : 'muted'}>
                {SUB[e]}
              </Mono>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  tile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.line,
    backgroundColor: color.ground,
  },
  tileOn: { borderColor: color.vial, backgroundColor: color.raised },
});
