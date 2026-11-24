import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCameraPermission } from 'react-native-vision-camera';
import { EXERCISE_IDS } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';
import { SAFETY_LABELS } from '@/features/onboarding/safety';
import {
  bmi,
  cmToFtIn,
  eventualChangeKg,
  ftInToCm,
  kgToLb,
  lbToKg,
  lowestHealthyKg,
  maintenance,
  PACES,
  strengthFuel,
  weightPlan,
  type Activity,
  type Pace,
  type Sex,
} from '@/fitness/energy';
import { dayMonth, kcal, paceLabel, weight } from '@/fitness/format';
import { fatGrams } from '@/fitness/energy';
import { workoutKcal } from '@/fitness/goal';
import { rotationCopy } from '@/session/copy';
import { bodyOf, defaultProfile, LIMITS, startProfile, useProfile, type Aim, type Profile } from '@/storage/profile';
import { SAFETY_FLAGS, useSettings, type SafetyFlag } from '@/storage/settings';
import { NumberField } from '@/ui/NumberField';
import { Body, Button, Display, Label, Strong } from '@/ui/primitives';
import { Scoreboard } from '@/ui/Scoreboard';
import { color, font, radius, space } from '@/ui/theme';

type StepId = 'intro' | 'aim' | 'you' | 'goal' | 'plan' | 'access' | 'rotation';

/** The exercises shown first on Home for each aim. */
const FOCUS: Record<Aim, Exercise[]> = {
  'lose-fat': ['pushup', 'plank', 'crunch', 'pullup', 'sidePlank'],
  'get-stronger': ['pushup', 'pullup', 'plank'],
  'stay-active': [...EXERCISE_IDS],
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
  const [p, setP] = useState<Profile>(() => (redo && saved ? { ...saved } : defaultProfile()));
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
  const back = () => (index > 0 ? setAt(steps[index - 1]) : redo && router.canGoBack() ? router.back() : undefined);

  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => scroll.current?.scrollTo({ y: 0, animated: false }), [at]);

  /** Skip the questions: no goal, just count reps. */
  const [skipped, setSkipped] = useState(false);
  const finish = () => {
    if (!skipped) setProfile(startProfile(p, redo ? saved : null));
    updateSettings({
      experience: settings.experience ?? 'guided',
      difficulty: redo ? settings.difficulty : 'medium',
      focus: skipped ? [] : FOCUS[p.aim],
      exercise: skipped ? settings.exercise : FOCUS[p.aim][0],
      safety,
    });
    if (redo && router.canGoBack()) router.back();
    else router.replace('/');
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
      <View style={[styles.top, { paddingTop: insets.top + space.md }]}>
        <View style={styles.header}>
          {index > 0 || redo ? (
            <Pressable accessibilityRole="button" onPress={back} hitSlop={12} style={styles.back}>
              <Strong size={16}>‹ Back</Strong>
            </Pressable>
          ) : (
            <Display size={24}>Trueline</Display>
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
              <View key={s} style={[styles.seg, i <= qIndex && { backgroundColor: color.vial }]} />
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
      <View style={{ gap: space.lg, marginTop: space.xl }}>
        <Scoreboard value="25" fraction={0.62} size={200} label="" />
        <Display size={44}>Pick a goal. Your camera counts the reps.</Display>
        <Body tone="chalk2">
          Three quick questions give you a plan with real numbers: what to eat, when you will get there and what your workouts burn. Video
          never leaves your phone.
        </Body>
      </View>
      <View style={{ gap: space.sm, marginTop: space.lg }}>
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
            onPress={() => {
              set({
                aim: a.value,
                repGoal: a.value === 'get-stronger' ? (p.repGoal ?? { exercise: 'pushup', reps: 20 }) : p.repGoal,
              });
              next();
            }}
          />
        ))}
      </View>
    </>
  );
}

const SEXES: [Sex, string][] = [
  ['female', 'Female'],
  ['male', 'Male'],
  ['unspecified', 'Rather not say'],
];

const ACTIVITY: { value: Activity; title: string; detail: string }[] = [
  { value: 'low', title: 'Mostly sitting', detail: 'Desk work, little walking' },
  { value: 'some', title: 'On my feet some of the day', detail: 'Walking, standing, light work' },
  { value: 'high', title: 'Active most days', detail: 'Physical job or regular sport' },
];

function YouStep({ p, set, next, safety, setSafety }: StepProps) {
  const imperial = p.units === 'imperial';
  const { ft, inch } = cmToFtIn(p.heightCm);
  const toggle = (f: SafetyFlag) => setSafety(safety.includes(f) ? safety.filter((x) => x !== f) : [...safety, f]);
  return (
    <>
      <Title title="A bit about you" detail="Used for the calorie maths. It stays on this phone." />
      <Segmented
        label="Units"
        value={p.units}
        options={[
          ['metric', 'kg and cm'],
          ['imperial', 'lb and ft'],
        ]}
        onChange={(units) => set({ units })}
      />
      <Segmented label="Sex" value={p.sex} options={SEXES} onChange={(sex) => set({ sex })} />
      {p.sex === 'unspecified' && (
        <Body tone="muted" size={14}>
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
      {imperial ? (
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
      <View style={{ gap: space.sm }}>
        <Label>Outside workouts, you are</Label>
        {ACTIVITY.map((a) => (
          <Lane key={a.value} title={a.title} detail={a.detail} compact selected={p.activity === a.value} onPress={() => set({ activity: a.value })} />
        ))}
      </View>
      <View style={{ gap: space.sm }}>
        <Label>Anything to take care with? Optional</Label>
        <View style={styles.chips}>
          {SAFETY_FLAGS.map((f) => (
            <Tag key={f} label={SAFETY_LABELS[f]} on={safety.includes(f)} onPress={() => toggle(f)} />
          ))}
        </View>
      </View>
      <Button label="Continue" size="lg" onPress={next} />
    </>
  );
}

const clampH = (cm: number) => Math.min(LIMITS.heightCm[1], Math.max(LIMITS.heightCm[0], cm));

function GoalStep(props: StepProps) {
  const { p } = props;
  if (p.aim === 'lose-fat') return <WeightGoal {...props} />;
  if (p.aim === 'get-stronger') return <StrengthGoal {...props} />;
  return <ActiveGoal {...props} />;
}

function WeightGoal({ p, set, next }: StepProps) {
  const floor = Math.ceil(lowestHealthyKg(p.heightCm) * 2) / 2;
  const tooLight = p.weightKg <= floor;
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
        <Button label="Get stronger instead" size="lg" onPress={() => set({ aim: 'get-stronger', repGoal: p.repGoal ?? { exercise: 'pushup', reps: 20 } })} />
      </>
    );
  }

  const plan = weightPlan(bodyOf(p), target, p.pace);
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
      <Body tone="muted" size={14}>
        The lowest target for your height is {weight(floor, p.units)}.
      </Body>
      <View style={{ gap: space.sm }}>
        <Label>How fast</Label>
        {PACES.map((pace) => (
          <Lane
            key={pace}
            compact
            title={paceLabel(pace, p.units)}
            detail={pace === 0.25 ? 'Gentle, easy to keep up' : pace === 0.5 ? 'Steady, the usual advice' : 'Faster, needs a bigger change in eating'}
            selected={p.pace === pace}
            onPress={() => set({ pace: pace as Pace })}
          />
        ))}
      </View>
      <Body size={15}>
        {Number.isFinite(plan.weeks)
          ? `${plan.floored ? 'Without eating too little, that' : 'That'} gets you to ${weight(target, p.units)} by about ${dayMonth(plan.by)}, in ${plan.weeks} weeks.`
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
      <Body tone="muted" size={14}>
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
      <Title title="How many days a week?" detail="Each workout is about 10 minutes of sets. Two days is a good start." />
      <DaysPicker {...{ p, set }} hideLabel />
      <Button label="See my plan" size="lg" onPress={next} />
    </>
  );
}

function DaysPicker({ p, set, hideLabel }: Pick<StepProps, 'p' | 'set'> & { hideLabel?: boolean }) {
  return (
    <View style={{ gap: space.sm }}>
      {!hideLabel && <Label>Workout days a week</Label>}
      <View style={styles.days} accessibilityRole="radiogroup">
        {[2, 3, 4, 5, 6, 7].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityLabel={`${n} days a week`}
            accessibilityState={{ selected: p.daysPerWeek === n }}
            onPress={() => {
              void Haptics.selectionAsync();
              set({ daysPerWeek: n });
            }}
            style={[styles.day, p.daysPerWeek === n && styles.dayOn]}
          >
            <Display size={30} tone={p.daysPerWeek === n ? 'ink' : 'chalk'}>
              {n}
            </Display>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function PlanStep({ p, next, safety }: StepProps) {
  const b = bodyOf(p);
  const maint = maintenance(b);
  const perWorkout = workoutKcal(p.weightKg);
  const week = perWorkout * p.daysPerWeek;
  const noDiet = safety.includes('pregnancy') || p.age < 18;
  const workouts = (
    <Fact
      big={kcal(week)}
      unit="kcal a week from workouts"
      text={`${p.daysPerWeek} workouts of about 10 minutes, on top of what you burn anyway. That is the energy in about ${Math.round(fatGrams(week))} g of body fat.`}
    />
  );

  let head: ReactNode;
  let facts: ReactNode;
  if (p.aim === 'lose-fat' && p.targetKg !== null && !noDiet) {
    const plan = weightPlan(b, p.targetKg, p.pace);
    const lasting = eventualChangeKg(week / 7);
    head = (
      <>
        <Label>Eat about this much a day</Label>
        <Scoreboard value={kcal(plan.eatKcal)} fraction={1} size={120} label={`${kcal(plan.eatKcal)} kcal a day`} />
        <Strong size={17}>
          kcal a day, to reach {weight(p.targetKg, p.units)}
          {Number.isFinite(plan.by) ? ` by ${dayMonth(plan.by)}` : ''}
        </Strong>
      </>
    );
    facts = (
      <>
        <Fact
          big={kcal(maint)}
          unit="kcal a day keeps you as you are"
          text={`Your body's daily use, from your size, age and activity. Eating ${kcal(plan.dailyDeficit)} less a day loses about ${paceLabel(p.pace, p.units)} at first.`}
        />
        {workouts}
        <Body tone="muted" size={14}>
          {`Kept up for good, these workouts alone would take off about ${weight(lasting.eventual, p.units)} over the years, half of it in the first year. Most of the change comes from eating.`}
        </Body>
        {plan.floored && (
          <Note tone="cue">
            {`At ${paceLabel(p.pace, p.units)} you would eat less than your body needs at rest, so the plan stays at ${kcal(plan.eatKcal)} kcal and takes a little longer.`}
          </Note>
        )}
      </>
    );
  } else if (p.aim === 'get-stronger' && p.repGoal) {
    const fuel = strengthFuel(b);
    head = (
      <>
        <Label>Protein a day</Label>
        <Scoreboard value={`${fuel.proteinG}`} fraction={1} size={140} label={`${fuel.proteinG} grams of protein a day`} />
        <Strong size={17}>grams of protein, about {kcal(fuel.eatKcal)} kcal a day in all</Strong>
      </>
    );
    facts = (
      <>
        <Fact
          big={String(p.repGoal.reps)}
          unit={p.repGoal.exercise === 'pullup' ? 'pull-ups in one set' : 'push-ups in one set'}
          text={`Train it on ${p.daysPerWeek} days a week with a rest day after hard ones. Add a rep when every rep of the last set was clean.`}
        />
        <Body tone="muted" size={14}>
          {`Muscle needs a little more food than you use (about ${kcal(fuel.eatKcal - maint)} kcal over) and protein spread across meals. 1.6 g per kg a day is where studies stop finding extra gains.`}
        </Body>
        {workouts}
      </>
    );
  } else {
    head = (
      <>
        <Label>Your week</Label>
        <Scoreboard value={String(p.daysPerWeek)} fraction={1} size={160} label={`${p.daysPerWeek} workout days a week`} />
        <Strong size={17}>workout days, about 10 minutes each</Strong>
      </>
    );
    facts = (
      <>
        {workouts}
        <Body tone="muted" size={14}>
          Health guidelines (WHO) ask for muscle work on at least 2 days a week, plus 150 minutes of walking or other movement.
        </Body>
      </>
    );
  }

  const bmiNow = bmi(p.heightCm, p.weightKg);
  return (
    <>
      <View style={{ gap: space.sm }}>{head}</View>
      <View style={{ gap: space.lg }}>{facts}</View>
      {noDiet && (
        <Note tone="cue">
          {p.age < 18
            ? 'Under 18, your body is still growing: Trueline won’t set a calorie target. Workouts and a varied diet are the plan.'
            : 'While pregnant or soon after birth, don’t diet to lose weight. Ask your midwife or doctor what suits you.'}
        </Note>
      )}
      <Body tone="faint" size={13}>
        {`Estimates from standard equations (Mifflin–St Jeor and the 2024 Compendium of Physical Activities). Real needs vary by about 10%; your weekly weight is the true check. BMI now ${bmiNow.value.toFixed(1)}. Not medical advice.`}
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
          <Body tone="cue">Camera access is off. You can turn it on in Settings any time; until then you can still explore the guides.</Body>
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
        <Body tone="faint" size={13}>
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
      <Display size={40}>{title}</Display>
      {detail && <Body tone="chalk2">{detail}</Body>}
    </View>
  );
}

/** A full-width choice. Selected fills with effort orange, like a lit lane. */
function Lane({
  title,
  detail,
  selected,
  onPress,
  compact = false,
}: {
  title: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.lane, compact && styles.laneCompact, selected && styles.laneOn, pressed && { opacity: 0.88 }]}
    >
      {compact ? (
        <Strong size={17} tone={selected ? 'ink' : 'chalk'}>
          {title}
        </Strong>
      ) : (
        <Display size={30} tone={selected ? 'ink' : 'chalk'}>
          {title}
        </Display>
      )}
      {detail && (
        <Body size={14} style={{ color: selected ? color.vialInk : color.chalk2 }}>
          {detail}
        </Body>
      )}
    </Pressable>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <Label>{label}</Label>
      <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map(([v, l]) => (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === v }}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(v);
            }}
            style={[styles.segItem, value === v && styles.segOn]}
          >
            <Strong size={15} tone={value === v ? 'ink' : 'chalk'}>
              {l}
            </Strong>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Tag({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[styles.tag, on && { backgroundColor: color.cueSoft, borderColor: color.cue }]}
    >
      <Body size={14} style={{ fontFamily: font.bodyMed }}>
        {label}
      </Body>
    </Pressable>
  );
}

/** A number with what it means, used on the plan. */
function Fact({ big, unit, text }: { big: string; unit: string; text: string }) {
  return (
    <View style={styles.fact}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' }}>
        <Display size={40} style={{ fontFamily: font.displayBlack }}>
          {big}
        </Display>
        <Strong size={15}>{unit}</Strong>
      </View>
      <Body tone="chalk2" size={14}>
        {text}
      </Body>
    </View>
  );
}

function Note({ children, tone }: { children: ReactNode; tone: 'cue' }) {
  return (
    <View style={[styles.note, { borderLeftColor: tone === 'cue' ? color.cue : color.vial }]}>
      <Body size={14}>{children}</Body>
    </View>
  );
}

function Point({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
      <View style={styles.tick} />
      <Body size={16} style={{ flex: 1 }}>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  back: { minHeight: 44, justifyContent: 'center' },
  progress: { flexDirection: 'row', gap: 3 },
  seg: { flex: 1, height: 3, backgroundColor: color.line },
  page: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  pair: { flexDirection: 'row', gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  lane: { gap: 4, paddingVertical: space.lg, paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: color.surface },
  laneCompact: { paddingVertical: space.md, gap: 2 },
  laneOn: { backgroundColor: color.vial },
  segmented: { flexDirection: 'row', gap: 2 },
  segItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface, paddingHorizontal: space.sm },
  segOn: { backgroundColor: color.vial },
  tag: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
  },
  days: { flexDirection: 'row', gap: 2 },
  day: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  dayOn: { backgroundColor: color.vial },
  fact: { gap: 4, borderLeftWidth: 3, borderLeftColor: color.vial, paddingLeft: space.md },
  note: { borderLeftWidth: 3, paddingLeft: space.md, paddingVertical: space.xs },
  tick: { width: 14, height: 3, backgroundColor: color.vial, marginTop: 11 },
});
