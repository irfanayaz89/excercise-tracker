import { router, useLocalSearchParams } from 'expo-router';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCameraPermission } from 'react-native-vision-camera';
import { EXERCISE_IDS } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';
import { SAFETY_LABELS } from '@/features/onboarding/safety';
import {
  cmToFtIn,
  ftInToCm,
  kgToLb,
  lbToKg,
  lowestHealthyKg,
  relativeFatMass,
  maintenance,
  PACES,
  strengthFuel,
  weightPlan,
  workoutKcal,
  type Activity,
  type Pace,
  type Sex,
} from '@/fitness/energy';
import { dayMonth, kcal, paceLabel, weight, WHY_LABELS } from '@/fitness/format';
import { ProjectionCard } from '@/features/energy/Projection';
import { planWorkoutKcalPerDay } from '@/fitness/goal';
import { rotationCopy } from '@/session/copy';
import { useScreenTime } from '@/screentime/store';
import { bodyOf, defaultProfile, LIMITS, startProfile, useProfile, WHYS, type Aim, type Profile } from '@/storage/profile';
import { SAFETY_FLAGS, useSettings, type SafetyFlag } from '@/storage/settings';
import { NumberField } from '@/ui/NumberField';
import { Body, Button, Chip, Display, Label, LinkText, Strong } from '@/ui/primitives';
import { ExerciseGlyph } from '@/ui/Diagrams';
import { color, font, radius, space, type } from '@/ui/theme';

type StepId = 'intro' | 'aim' | 'you' | 'goal' | 'plan' | 'access' | 'rotation';

/** The exercises shown first on Home for each aim. */
const FOCUS: Record<Aim, Exercise[]> = {
  'lose-fat': ['pushup', 'plank', 'crunch', 'pullup', 'sidePlank'],
  'get-stronger': ['pushup', 'pullup', 'plank'],
  'stay-active': [...EXERCISE_IDS],
  'less-screen': ['pushup', 'plank', 'crunch', 'pullup', 'sidePlank'],
};

/**
 * First launch (and "Redo setup" in Settings): what you want, a few numbers
 * about you, a goal, and a plan with honest numbers. Then the camera. Four
 * short screens; everything stays on the phone.
 */
export default function Welcome() {
  const insets = useSafeAreaInsets();
  const { redo } = useLocalSearchParams<{ redo?: string }>();
  const [settings, updateSettings] = useSettings();
  const [saved, setProfile] = useProfile();
  const screenTime = useScreenTime();
  // A saved profile is the starting point whenever there is one (redo, or settings lost while the profile survived).
  const [p, setP] = useState<Profile>(() => (saved ? { ...saved } : defaultProfile()));
  const [safety, setSafety] = useState<SafetyFlag[]>(settings.safety);
  const set = (patch: Partial<Profile>) => setP((d) => ({ ...d, ...patch }));

  const steps = useMemo<StepId[]>(
    () =>
      (['intro', 'aim', 'you', 'goal', 'plan', 'access', 'rotation'] as StepId[]).filter(
        (s) => (s !== 'intro' || !redo) && (s !== 'rotation' || (Platform.OS === 'ios' && settings.orientation === 'landscape')),
      ),
    [redo, settings.orientation],
  );
  const [at, setAt] = useState<StepId>(steps[0]);
  const index = steps.indexOf(at);
  const next = () => {
    if (index === steps.length - 1) finish();
    else setAt(steps[index + 1]);
  };
  /** Skip the questions: no goal, just count reps. */
  const [skipped, setSkipped] = useState(false);
  const back = () => {
    // Skipped straight to the camera: Back returns to the intro, and the questions count again.
    if (skipped && at === 'access') {
      setSkipped(false);
      setAt(steps[0]);
      return;
    }
    if (index > 0) setAt(steps[index - 1]);
    else if (redo && router.canGoBack()) router.back();
  };

  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => scroll.current?.scrollTo({ y: 0, animated: false }), [at]);

  const finish = () => {
    if (!skipped) setProfile(startProfile(p, saved));
    // A heart condition or recent injury starts gently.
    const gentle = safety.includes('heart') || safety.includes('injury');
    const first = skipped ? settings.exercise : FOCUS[p.aim][0];
    updateSettings({
      experience: settings.experience ?? 'guided',
      difficulty: gentle ? 'easy' : redo ? settings.difficulty : 'medium',
      focus: skipped ? [] : FOCUS[p.aim],
      exercise: first,
      safety,
    });
    if (redo && router.canGoBack()) {
      router.back();
      return;
    }
    // First launch: straight into the first set (the first counted set decides whether people come back),
    // or for "less phone time", into Screen time setup.
    router.replace('/');
    if (!skipped && p.aim === 'less-screen' && screenTime.availability !== 'unsupported' && !screenTime.meta.setUp)
      router.push('/screen-time/setup');
    else router.push({ pathname: '/exercise/[id]', params: { id: first } });
  };

  const questions: StepId[] = steps.filter((s) => s !== 'intro' && s !== 'access' && s !== 'rotation');
  const qIndex = questions.indexOf(at);
  const content = renderStep(at, {
    p,
    set,
    next,
    safety,
    setSafety,
    skip: () => {
      setSkipped(true);
      setAt('access');
    },
  });

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <View style={[styles.top, { paddingTop: insets.top + space.lg }]}>
        <View style={styles.header}>
          {index > 0 || redo ? (
            <Pressable accessibilityRole="button" onPress={back} hitSlop={12}>
              <Label tone="chalk">‹ Back</Label>
            </Pressable>
          ) : (
            <View style={styles.wordmark}>
              <View style={styles.markLine} />
              <Display size={type.wordmark} style={{ letterSpacing: 4 }}>
                TRUELINE
              </Display>
            </View>
          )}
          {qIndex >= 0 && (
            <Label tone="muted">
              {qIndex + 1} of {questions.length}
            </Label>
          )}
        </View>
        {qIndex >= 0 && (
          <View style={styles.progress} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {questions.map((s, i) => (
              <View key={s} style={[styles.dot, i <= qIndex && { backgroundColor: color.vial }]} />
            ))}
          </View>
        )}
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + space.xl }]}
        >
          {content}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

interface StepProps {
  p: Profile;
  set: (patch: Partial<Profile>) => void;
  next: () => void;
  skip: () => void;
  safety: SafetyFlag[];
  setSafety: (s: SafetyFlag[]) => void;
}

function renderStep(at: StepId, props: StepProps): ReactNode {
  switch (at) {
    case 'intro':
      return <IntroStep {...props} />;
    case 'aim':
      return <AimStep {...props} />;
    case 'you':
      return <YouStep {...props} />;
    case 'goal':
      return <GoalStep {...props} />;
    case 'plan':
      return <PlanStep {...props} />;
    case 'access':
      return <AccessStep {...props} />;
    case 'rotation':
      return <RotationStep {...props} />;
  }
}

// ─── Steps ──────────────────────────────────────────────────────────────────

function IntroStep({ next, skip }: StepProps) {
  return (
    <>
      <View style={{ gap: space.md, marginTop: space.xl }}>
        <Display size={type.pageHero}>Pick a goal. Your camera counts the reps.</Display>
        <Body tone="muted">
          A few quick questions give you a plan with real numbers: what to eat, when you will get there and what your workouts burn. Video
          never leaves your phone.
        </Body>
      </View>
      <View style={styles.glyphRow}>
        {EXERCISE_IDS.map((e) => (
          <ExerciseGlyph key={e} exercise={e} size={64} />
        ))}
      </View>
      <View style={{ gap: space.md }}>
        <Button label="Set my goal" size="lg" onPress={next} />
        <Button label="Skip, just count reps" variant="ghost" onPress={skip} />
      </View>
    </>
  );
}

const AIMS: { value: Aim; title: string; detail: string }[] = [
  { value: 'lose-fat', title: 'Lose fat', detail: 'A target weight, a safe pace and a daily calorie number.' },
  { value: 'get-stronger', title: 'Get stronger', detail: 'Work up to a big set of push-ups or pull-ups.' },
  { value: 'stay-active', title: 'Stay active', detail: 'A few short workouts every week, counted for you.' },
  { value: 'less-screen', title: 'Spend less time on my phone', detail: 'Exercise to earn your scrolling time back.' },
];

function AimStep({ p, set, next }: StepProps) {
  return (
    <>
      <Title title="What are you here for?" />
      <View style={{ gap: space.sm }}>
        {AIMS.map((a) => (
          <Lane
            key={a.value}
            title={a.title}
            detail={a.detail}
            selected={p.aim === a.value}
            onPress={() =>
              set({
                aim: a.value,
                repGoal: a.value === 'get-stronger' ? (p.repGoal ?? { exercise: 'pushup', reps: 20 }) : p.repGoal,
              })
            }
          />
        ))}
      </View>
      <More label="+ Add what would make it worth it (optional)" open={p.why.length > 0}>
        <Label>What would make it worth it?</Label>
        <View style={styles.chips}>
          {WHYS.map((w) => (
            <Chip
              key={w}
              label={WHY_LABELS[w]}
              multi
              selected={p.why.includes(w)}
              onPress={() => set({ why: p.why.includes(w) ? p.why.filter((x) => x !== w) : [...p.why, w] })}
            />
          ))}
        </View>
      </More>
      <Button label="Continue" size="lg" onPress={next} />
    </>
  );
}

const SEXES: [Sex, string][] = [
  ['female', 'Female'],
  ['male', 'Male'],
  ['unspecified', 'Rather not say'],
];

const ACTIVITY: { value: Activity; title: string; detail: string }[] = [
  { value: 'low', title: 'Mostly sitting', detail: 'Desk work, little walking.' },
  { value: 'some', title: 'Some', detail: 'On your feet some of the day: walking, standing, light work.' },
  { value: 'high', title: 'Very active', detail: 'A physical job or regular sport.' },
];

/** Short chip labels for the health answers (the full wording is read out by screen readers). */
const SAFETY_SHORT: Record<SafetyFlag, string> = {
  heart: 'Heart or blood pressure',
  back: 'Lower back',
  neck: 'Neck or shoulder',
  wrist: 'Wrists',
  pregnancy: 'Pregnant or new baby',
  injury: 'Recent injury',
};

function YouStep({ p, set, next, safety, setSafety }: StepProps) {
  const imperial = p.units === 'imperial';
  const { ft, inch } = cmToFtIn(p.heightCm);
  const toggle = (f: SafetyFlag) => setSafety(safety.includes(f) ? safety.filter((x) => x !== f) : [...safety, f]);
  // A calorie plan needs sex, height and activity; otherwise weight and age are enough for each set's calories.
  const full = p.aim === 'lose-fat' || p.aim === 'get-stronger';
  return (
    <>
      <Title
        title="A bit about you"
        detail={
          full
            ? 'Used for your calorie plan and the calories each set burns. It stays on this phone.'
            : 'Your weight and age give the calories each set burns. It stays on this phone.'
        }
      />
      <Segmented
        label="Units"
        value={p.units}
        options={[
          ['metric', 'kg and cm'],
          ['imperial', 'lb and ft'],
        ]}
        onChange={(units) => set({ units })}
      />
      {full && <Segmented label="Sex" value={p.sex} options={SEXES} onChange={(sex) => set({ sex })} />}
      {full && p.sex === 'unspecified' && (
        <Body tone="muted" size={type.note}>
          Calorie needs differ by sex, so the plan uses a midpoint. It may be off by about 80 kcal a day.
        </Body>
      )}
      <View style={styles.pair}>
        <NumberField label="Age" value={p.age} onChange={(age) => set({ age })} min={LIMITS.age[0]} max={LIMITS.age[1]} />
        {imperial ? (
          <NumberField
            label="Weight"
            value={Math.round(kgToLb(p.weightKg))}
            onChange={(lb) => set({ weightKg: lbToKg(lb) })}
            min={Math.round(kgToLb(LIMITS.weightKg[0]))}
            max={Math.round(kgToLb(LIMITS.weightKg[1]))}
            unit="lb"
          />
        ) : (
          <NumberField
            label="Weight"
            value={p.weightKg}
            onChange={(weightKg) => set({ weightKg })}
            min={LIMITS.weightKg[0]}
            max={LIMITS.weightKg[1]}
            step={0.5}
            decimals={1}
            unit="kg"
          />
        )}
      </View>
      {!full ? null : imperial ? (
        <View style={styles.pair}>
          <NumberField label="Height" value={ft} onChange={(f) => set({ heightCm: clampH(ftInToCm(f, inch)) })} min={4} max={7} unit="ft" />
          <NumberField label="and" value={inch} onChange={(i) => set({ heightCm: clampH(ftInToCm(ft, i)) })} min={0} max={11} unit="in" />
        </View>
      ) : (
        <NumberField
          label="Height"
          value={p.heightCm}
          onChange={(heightCm) => set({ heightCm })}
          min={LIMITS.heightCm[0]}
          max={LIMITS.heightCm[1]}
          unit="cm"
        />
      )}
      {full && (
        <Segmented
          label="Outside workouts, you are"
          value={p.activity}
          options={ACTIVITY.map((a) => [a.value, a.title])}
          onChange={(activity) => set({ activity })}
          hint={ACTIVITY.find((a) => a.value === p.activity)?.detail}
        />
      )}
      {full && (
        <More label="+ Make the numbers more accurate (optional)" open={p.muscular || p.waistCm !== null}>
          <Segmented
            label="Build"
            value={p.muscular ? 'muscular' : 'average'}
            options={[
              ['average', 'Average'],
              ['muscular', 'I lift / very muscular'],
            ]}
            onChange={(v) => set({ muscular: v === 'muscular' })}
          />
          <WaistField p={p} set={set} />
        </More>
      )}
      <View style={{ gap: space.sm }}>
        <Label>Anything to take care with? Optional</Label>
        <View style={styles.chips}>
          {SAFETY_FLAGS.map((f) => (
            <Chip
              key={f}
              label={SAFETY_SHORT[f]}
              multi
              selected={safety.includes(f)}
              onPress={() => toggle(f)}
              accessibilityLabel={SAFETY_LABELS[f]}
            />
          ))}
        </View>
      </View>
      {(safety.includes('heart') || safety.includes('injury')) && (
        <Note tone="cue">Check with your doctor before you start. Trueline will start you on Easy, and you can stop any time.</Note>
      )}
      <Button label="Continue" size="lg" onPress={next} />
    </>
  );
}

/** Optional waist, for a body-fat estimate (Relative Fat Mass). It never changes workout calories. */
function WaistField({ p, set }: Pick<StepProps, 'p' | 'set'>) {
  const imperial = p.units === 'imperial';
  if (p.waistCm === null) {
    return (
      <Pressable
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => set({ waistCm: p.sex === 'female' ? 80 : 90 })}
        style={{ alignSelf: 'flex-start' }}
      >
        <LinkText>Add your waist for a body-fat estimate (optional) ›</LinkText>
      </Pressable>
    );
  }
  const bf = relativeFatMass(p.sex, p.heightCm, p.waistCm);
  return (
    <View style={{ gap: space.sm }}>
      <NumberField
        label="Waist, at the navel, relaxed"
        value={imperial ? Math.round(p.waistCm / 2.54) : p.waistCm}
        onChange={(v) => set({ waistCm: imperial ? v * 2.54 : v })}
        min={imperial ? 20 : LIMITS.waistCm[0]}
        max={imperial ? 79 : LIMITS.waistCm[1]}
        unit={imperial ? 'in' : 'cm'}
      />
      {bf !== null && (
        <Body tone="muted" size={type.note}>
          {`Body fat about ${Math.round(bf)}% (give or take 5), from your waist and height. Watch it fall even when the scale doesn't move.`}
        </Body>
      )}
      <Pressable accessibilityRole="button" hitSlop={8} onPress={() => set({ waistCm: null })} style={{ alignSelf: 'flex-start' }}>
        <LinkText tone="muted">Remove waist</LinkText>
      </Pressable>
    </View>
  );
}

const clampH = (cm: number) => Math.min(LIMITS.heightCm[1], Math.max(LIMITS.heightCm[0], cm));

function GoalStep(props: StepProps) {
  const { p, set, safety } = props;
  if (p.aim === 'lose-fat' && (p.age < 18 || safety.includes('pregnancy'))) {
    return (
      <>
        <Title
          title="Let's not set a weight-loss goal"
          detail={
            p.age < 18
              ? 'Under 18, your body is still growing, so Trueline won’t set a weight or calorie target. Regular workouts are the plan.'
              : 'While pregnant or soon after birth, dieting to lose weight isn’t advised. Ask your midwife or doctor what suits you; gentle, regular workouts are the plan here.'
          }
        />
        <Button label="Stay active instead" size="lg" onPress={() => set({ aim: 'stay-active' })} />
      </>
    );
  }
  if (p.aim === 'lose-fat') return <WeightGoal {...props} />;
  if (p.aim === 'get-stronger') return <StrengthGoal {...props} />;
  return <ActiveGoal {...props} />;
}

/** A weekly loss in the user's units, to the nearest 0.25 lb or 0.05 kg. */
const weeklyLoss = (kg: number, units: Profile['units']) =>
  units === 'imperial' ? `${Math.round(kgToLb(kg) * 4) / 4} lb a week` : `${Math.round(kg * 20) / 20} kg a week`;

function WeightGoal({ p, set, next }: StepProps) {
  const floor = Math.ceil(lowestHealthyKg(p.heightCm) * 2) / 2;
  // At least a kilo of room above the floor, or the target field's lowest value would be above its highest.
  const tooLight = p.weightKg - 1 < floor;
  const suggested = Math.max(floor, Math.round(p.weightKg * 0.95 * 2) / 2);
  const target = p.targetKg !== null && p.targetKg < p.weightKg && p.targetKg >= floor ? p.targetKg : suggested;
  useEffect(() => {
    if (!tooLight && p.targetKg !== target) set({ targetKg: target });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tooLight, target]);

  if (tooLight) {
    return (
      <>
        <Title
          title="You are already at a healthy weight"
          detail={`At your height, going under ${weight(floor, p.units)} would put you below a healthy weight (BMI 18.5), so Trueline won't set a weight-loss goal. Building strength is a better aim.`}
        />
        <Button
          label="Get stronger instead"
          size="lg"
          onPress={() => set({ aim: 'get-stronger', repGoal: p.repGoal ?? { exercise: 'pushup', reps: 20 } })}
        />
      </>
    );
  }

  const plan = weightPlan(bodyOf(p), target, p.pace, undefined, planWorkoutKcalPerDay(p));
  const imperial = p.units === 'imperial';
  return (
    <>
      <Title title="Where do you want to get to?" detail={`You weigh ${weight(p.weightKg, p.units)} now.`} />
      {imperial ? (
        <NumberField
          label="Target weight"
          value={Math.round(kgToLb(target))}
          onChange={(lb) => set({ targetKg: Math.max(floor, Math.min(p.weightKg - 0.5, lbToKg(lb))) })}
          min={Math.ceil(kgToLb(floor))}
          max={Math.floor(kgToLb(p.weightKg - 0.5))}
          unit="lb"
        />
      ) : (
        <NumberField
          label="Target weight"
          value={target}
          onChange={(kg) => set({ targetKg: kg })}
          min={floor}
          max={p.weightKg - 0.5}
          step={0.5}
          decimals={1}
          unit="kg"
        />
      )}
      <Body tone="muted" size={type.note}>
        The lowest target for your height is {weight(floor, p.units)}.
      </Body>
      <Segmented
        label="How fast"
        value={String(p.pace)}
        options={PACES.map((pace) => [String(pace), pace === 0.25 ? 'Gentle' : pace === 0.5 ? 'Steady' : 'Faster'])}
        onChange={(v) => set({ pace: Number(v) as Pace })}
        hint={`${paceLabel(p.pace, p.units)}: ${p.pace === 0.25 ? 'easy to keep up.' : p.pace === 0.5 ? 'the usual advice.' : 'needs a bigger change in eating.'}`}
      />
      <Body size={type.detail}>
        {Number.isFinite(plan.weeks)
          ? `${plan.floored ? 'Without eating too little, that' : 'That'} gets you to ${weight(target, p.units)} by about ${dayMonth(plan.by)}, in ${plan.weeks} weeks, counting your ${p.daysPerWeek} workouts a week.`
          : 'Your body already runs on very little, so eating less is not safe. Workouts and strength are the way forward.'}
      </Body>
      <DaysPicker {...{ p, set }} />
      <Button label="See my plan" size="lg" onPress={next} />
    </>
  );
}

function StrengthGoal({ p, set, next }: StepProps) {
  const g = p.repGoal ?? { exercise: 'pushup' as const, reps: 20 };
  return (
    <>
      <Title title="Pick your big set" detail="One set, strict form, counted by the camera." />
      <Segmented
        label="Exercise"
        value={g.exercise}
        options={[
          ['pushup', 'Push-ups'],
          ['pullup', 'Pull-ups'],
        ]}
        onChange={(exercise) => set({ repGoal: { exercise, reps: exercise === 'pullup' ? 8 : 20 } })}
      />
      <NumberField
        label="Reps in one set"
        value={g.reps}
        onChange={(reps) => set({ repGoal: { ...g, reps } })}
        min={LIMITS.reps[0]}
        max={LIMITS.reps[1]}
      />
      <Body tone="muted" size={type.note}>
        {g.exercise === 'pullup'
          ? 'Can’t do one yet? Set 1. Slow lowering from the top and long dead hangs build up to it.'
          : 'A good first target is about twice what you can do today.'}
      </Body>
      <DaysPicker {...{ p, set }} />
      <Button label="See my plan" size="lg" onPress={next} />
    </>
  );
}

function ActiveGoal({ p, set, next }: StepProps) {
  return (
    <>
      <Title
        title="How many days a week?"
        detail={
          p.aim === 'less-screen'
            ? 'On workout days your sets earn screen time back. Each workout is about 10 minutes; two days is a good start.'
            : 'Each workout is about 10 minutes of sets. Two days is a good start.'
        }
      />
      <DaysPicker {...{ p, set }} hideLabel />
      <Button label="See my plan" size="lg" onPress={next} />
    </>
  );
}

function DaysPicker({ p, set, hideLabel }: Pick<StepProps, 'p' | 'set'> & { hideLabel?: boolean }) {
  return (
    <View style={{ gap: space.sm }}>
      {!hideLabel && <Label>Workout days a week</Label>}
      <View style={styles.chips} accessibilityRole="radiogroup">
        {[2, 3, 4, 5, 6, 7].map((n) => (
          <Chip key={n} label={`${n} days`} selected={p.daysPerWeek === n} onPress={() => set({ daysPerWeek: n })} />
        ))}
      </View>
    </View>
  );
}

function PlanStep({ p, next, safety }: StepProps) {
  const b = bodyOf(p);
  const maint = maintenance(b);
  const perWorkout = workoutKcal({ weightKg: p.weightKg, heightCm: p.heightCm, sex: p.sex });
  const week = perWorkout.kcal * p.daysPerWeek;
  const noDiet = safety.includes('pregnancy') || p.age < 18;
  const burn: [string, string] = ['Your workouts burn', `about ${kcal(week)} kcal a week`];
  const lose = p.aim === 'lose-fat' && p.targetKg !== null && !noDiet;
  const plan = lose ? weightPlan(b, p.targetKg!, p.pace, undefined, planWorkoutKcalPerDay(p)) : null;

  // One headline number and a few plain rows. The method, the ranges and the sources are one tap away.
  let head: ReactNode;
  let rows: [string, string][] = [burn];
  let note: string | null = null;
  if (plan && Number.isFinite(plan.weeks)) {
    head = (
      <>
        <Label>Eat about this much a day</Label>
        <Big value={kcal(plan.eatKcal)} label={`${kcal(plan.eatKcal)} kcal a day`} />
        <Strong size={type.callout}>
          kcal a day, to reach {weight(p.targetKg!, p.units)}
          {Number.isFinite(plan.by) ? ` by ${dayMonth(plan.by)}` : ''}
        </Strong>
      </>
    );
    rows = [
      ['Your body uses', `about ${kcal(maint)} kcal a day`],
      ['You lose about', plan.floored ? weeklyLoss((plan.dailyDeficit * 7) / 7700, p.units) : paceLabel(p.pace, p.units)],
      burn,
    ];
    if (plan.floored) note = `A little slower than ${paceLabel(p.pace, p.units)}, so you never eat less than your body needs at rest.`;
  } else if (p.aim === 'get-stronger' && p.repGoal) {
    const fuel = strengthFuel(b);
    head = (
      <>
        <Label>Your goal</Label>
        <Big value={String(p.repGoal.reps)} label={`${p.repGoal.reps} in one set`} />
        <Strong size={type.callout}>{p.repGoal.exercise === 'pullup' ? 'pull-ups in one set' : 'push-ups in one set'}</Strong>
      </>
    );
    rows = [
      ['Train', `${p.daysPerWeek} days a week`],
      ['Protein', `about ${fuel.proteinG} g a day`],
      ...(noDiet ? [] : ([['Eat', `about ${kcal(fuel.eatKcal)} kcal a day`]] as [string, string][])),
      burn,
    ];
    note = null;
  } else if (p.aim === 'less-screen') {
    head = (
      <>
        <Label>Earn your screen time</Label>
        <Big value="15 / 30" label="15 minutes for 10 push-ups, 30 for 20" />
        <Strong size={type.callout}>minutes for 10 / 20 push-ups in a set</Strong>
      </>
    );
    rows = [['Workouts', `${p.daysPerWeek} days a week, about 10 minutes`], ['Also count', 'Pull-ups, crunches and planks'], burn];
  } else {
    head = (
      <>
        <Label>Your week</Label>
        <Big value={String(p.daysPerWeek)} label={`${p.daysPerWeek} workout days a week`} />
        <Strong size={type.callout}>workout days, about 10 minutes each</Strong>
      </>
    );
  }

  return (
    <>
      <View style={{ gap: space.sm }}>{head}</View>
      <View style={styles.card}>
        {rows.map(([k, v]) => (
          <View key={k} style={styles.planRow} accessible accessibilityLabel={`${k}: ${v}`}>
            <Body tone="muted" size={type.detail}>
              {k}
            </Body>
            <Strong size={type.detail} style={{ flexShrink: 1, textAlign: 'right' }}>
              {v}
            </Strong>
          </View>
        ))}
      </View>
      {note && <Body size={type.note}>{note}</Body>}
      {noDiet && (
        <Note tone="cue">
          {p.age < 18
            ? 'Under 18, your body is still growing: Trueline won’t set a calorie target. Workouts and a varied diet are the plan.'
            : 'While pregnant or soon after birth, don’t diet to lose weight. Ask your midwife or doctor what suits you.'}
        </Note>
      )}
      <ProjectionCard
        perSession={perWorkout}
        perWeek={p.daysPerWeek}
        units={p.units}
        dailyDeficit={plan && Number.isFinite(plan.weeks) ? weightPlan(b, p.targetKg!, p.pace).dailyDeficit : 0}
        targetChangeKg={plan && Number.isFinite(plan.weeks) ? p.weightKg - p.targetKg! : null}
      />
      <Body tone="muted" size={type.caption}>
        {lose ? 'Not medical advice. Your weekly weigh-in is the real check.' : 'Not medical advice.'}
      </Body>
      <Button label="Looks good" size="lg" onPress={next} />
    </>
  );
}

function AccessStep({ next }: StepProps) {
  const camera = useCameraPermission();
  const [motion, setMotion] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [asked, setAsked] = useState(false);

  const ask = async () => {
    setAsked(true);
    const ok = camera.hasPermission || (await camera.requestPermission());
    try {
      const m = await DeviceMotion.getPermissionsAsync();
      // Android's motion sensors need no permission (expo-sensors would ask for "physical activity", which isn't needed).
      const granted = Platform.OS === 'android' || m.granted || (m.canAskAgain && (await DeviceMotion.requestPermissionsAsync()).granted);
      setMotion(granted ? 'granted' : 'denied');
    } catch {
      setMotion('denied');
    }
    if (ok) next();
  };

  const deniedCamera = asked && !camera.hasPermission;
  return (
    <>
      <Title title="Trueline needs your camera to see your reps" />
      <View style={{ gap: space.md }}>
        <Point text="It runs on this phone. Nothing is recorded or uploaded." />
        <Point text="The camera is only on while a set is running." />
        <Point text="Motion sensors check the phone stands level, so angles read true." />
      </View>
      {deniedCamera ? (
        <>
          <Body tone="cue">
            Camera access is off. You can turn it on in Settings any time; until then you can still explore the guides.
          </Body>
          <Button label="Open Settings" size="lg" onPress={() => void Linking.openSettings()} />
          <Button label="Continue without camera" variant="ghost" onPress={next} />
        </>
      ) : (
        <>
          <Button label={camera.hasPermission ? 'Continue' : 'Allow camera'} size="lg" onPress={() => void ask()} />
          {!camera.hasPermission && <Button label="Not now" variant="ghost" onPress={next} />}
        </>
      )}
      {motion === 'denied' && (
        <Body tone="muted" size={type.caption}>
          Motion is off: the level check will ask you to confirm the phone is set instead.
        </Body>
      )}
    </>
  );
}

function RotationStep({ next }: StepProps) {
  const c = rotationCopy(Platform.OS);
  return (
    <>
      <Title title={c.title} detail={c.body} />
      <View style={{ gap: space.md }}>
        <Point text="Swipe down from the top-right corner of the screen." />
        <Point text="Find the lock with a circular arrow. If it is highlighted, tap it so it turns off." />
        <Point text="That's it: the picture now turns with the phone." />
      </View>
      <Button label={c.ok.replace(', start', '')} size="lg" onPress={next} />
    </>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function Title({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={{ gap: space.sm }}>
      <Display size={type.headline}>{title}</Display>
      {detail && <Body tone="muted">{detail}</Body>}
    </View>
  );
}

/** A big number on the plan, in the display face. */
function Big({ value, label }: { value: string; label: string }) {
  return (
    <Display size={type.hero} tone="vial" style={{ fontFamily: font.displayBlack }} accessibilityLabel={label}>
      {value}
    </Display>
  );
}

/** A choice row: title, one line of detail and a round (or square, for multi) mark. */
function Lane({
  title,
  detail,
  selected,
  onPress,
  compact = false,
  multi = false,
}: {
  title: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  compact?: boolean;
  multi?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: selected } : { selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        compact && { paddingVertical: space.md },
        selected && styles.selected,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Strong size={type.callout}>{title}</Strong>
        {detail && (
          <Body tone="muted" size={type.note}>
            {detail}
          </Body>
        )}
      </View>
      <View style={[styles.mark, multi && { borderRadius: 6 }, selected && styles.markOn]} />
    </Pressable>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  /** One line about the current choice, instead of a description under every option. */
  hint?: string;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <Label>{label}</Label>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map(([v, l]) => (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === v }}
            onPress={() => onChange(v)}
            style={[styles.choice, value === v && styles.selected]}
          >
            <Strong size={type.detail} style={{ textAlign: 'center' }}>
              {l}
            </Strong>
          </Pressable>
        ))}
      </View>
      {hint && (
        <Body tone="muted" size={type.note}>
          {hint}
        </Body>
      )}
    </View>
  );
}

/** Optional extras, closed until asked for: keeps each step to the questions that matter. */
function More({ label, open: startOpen, children }: { label: string; open: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  return open ? (
    <View style={{ gap: space.md }}>{children}</View>
  ) : (
    <Pressable
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => setOpen(true)}
      style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}
    >
      <LinkText>{label}</LinkText>
    </Pressable>
  );
}

function Note({ children }: { children: ReactNode; tone: 'cue' }) {
  return (
    <View style={styles.warn}>
      <Label tone="cue">Take care</Label>
      <Body size={type.note}>{children}</Body>
    </View>
  );
}

function Point({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
      <View style={styles.tick} />
      <Body size={type.detail} style={{ flex: 1 }}>
        {text}
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  // Opaque and on top, so content scrolled under the header never shows through it.
  top: {
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingBottom: space.sm,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    backgroundColor: color.ground,
    zIndex: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: space.md,
    rowGap: space.xs,
    alignItems: 'center',
    minHeight: 28,
  },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  markLine: { width: 22, height: 4, borderRadius: 2, backgroundColor: color.vial },
  progress: { flexDirection: 'row', gap: 4, marginTop: space.xs },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.line },
  page: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  glyphRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, justifyContent: 'center', paddingVertical: space.xl },
  pair: { flexDirection: 'row', gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.lineSoft,
  },
  selected: { borderColor: color.vial, backgroundColor: color.raised },
  mark: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: color.line },
  markOn: { borderColor: color.vial, backgroundColor: color.vial },
  row: { flexDirection: 'row', gap: space.md },
  choice: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.lineSoft,
  },
  card: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.lineSoft,
  },
  warn: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.cueSoft,
    borderWidth: 1,
    borderColor: color.cue,
  },
  tick: { width: 14, height: 4, borderRadius: 2, backgroundColor: color.vial, marginTop: 10 },
  planRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.md, flexWrap: 'wrap' },
});
