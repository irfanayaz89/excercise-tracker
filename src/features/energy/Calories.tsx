import { router } from 'expo-router';
import { Pressable } from 'react-native';
import type { Exercise } from '@/engine/types';
import { setKcal, type ExerciseBody } from '@/fitness/energy';
import { kcalText } from '@/fitness/format';
import { useProfile } from '@/storage/profile';
import { Body, LinkText, Strong } from '@/ui/primitives';
import { type } from '@/ui/theme';

/** Weight, height and sex for the calorie maths, once the user has given them. */
export function useEnergyBody(): ExerciseBody | null {
  const [profile] = useProfile();
  return profile ? { weightKg: profile.weightKg, heightCm: profile.heightCm, sex: profile.sex } : null;
}

/** "How calories are worked out ›": the method, its sources and how far off it can be. */
export function CaloriesHow({ label = 'How calories are worked out ›' }: { label?: string }) {
  return (
    <Pressable accessibilityRole="link" hitSlop={8} onPress={() => router.push('/calories')} style={{ alignSelf: 'flex-start' }}>
      <LinkText>{label}</LinkText>
    </Pressable>
  );
}

/** Before any weight is known: one line that says why to add it. */
export function AddWeightForCalories() {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => router.push({ pathname: '/welcome', params: { redo: '1' } })}
      style={{ alignSelf: 'flex-start' }}
    >
      <LinkText>Add your weight to see calories ›</LinkText>
    </Pressable>
  );
}

/** What one finished set burned, above resting. */
export function SetCalories({
  exercise,
  activeMs,
  holdMs,
  reps,
  avgRepMs = null,
}: {
  exercise: Exercise;
  activeMs: number;
  holdMs: number;
  reps: number;
  avgRepMs?: number | null;
}) {
  const body = useEnergyBody();
  if (!body) return <AddWeightForCalories />;
  const k = setKcal({ exercise, activeMs, holdMs, totalReps: reps, avgRepMs }, body);
  if (k.kcal <= 0) return null;
  return (
    <>
      <Body
        size={type.detail}
        tone="muted"
        accessibilityLabel={`About ${Math.max(1, Math.round(k.kcal))} calories burned above resting, likely between ${Math.round(k.low)} and ${Math.round(k.high)}`}
      >
        <Strong size={type.detail}>{kcalText(k)}</Strong> burned above resting.
      </Body>
      <CaloriesHow />
    </>
  );
}
