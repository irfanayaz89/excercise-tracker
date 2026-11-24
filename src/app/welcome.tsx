import { router, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCameraPermission } from 'react-native-vision-camera';
import type { Difficulty } from '@/engine/difficulty';
import { EXERCISE_IDS, EXERCISES, viewFor } from '@/engine/exercises';
import type { CameraView, Exercise } from '@/engine/types';
import { SAFETY_LABELS, safetyNotes } from '@/features/onboarding/safety';
import { rotationCopy } from '@/session/copy';
import {
  DEFAULT_VIEWS,
  GOAL_TARGETS,
  SAFETY_FLAGS,
  useSettings,
  type DailyGoal,
  type Experience,
  type SafetyFlag,
  type Settings,
} from '@/storage/settings';
import { ExerciseGlyph } from '@/ui/Diagrams';
import { ExerciseAnimation } from '@/ui/ExerciseAnimation';
import { OrientationPicker } from '@/ui/OrientationPicker';
import { Body, Button, Display, Label, Mono, Strong } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';

/** Everything onboarding asks, kept as a draft until the end so Back always works. */
type Draft = Pick<Settings, 'focus' | 'difficulty' | 'experience' | 'dailyGoal' | 'safety' | 'voice' | 'orientation' | 'camera' | 'views'>;

type StepId = 'welcome' | 'train' | 'strict' | 'help' | 'goal' | 'safety' | 'voice' | 'phone' | 'access' | 'rotation' | 'plan';

const RECOMMENDED: Omit<Draft, 'views'> & { views: Draft['views'] } = {
  focus: [...EXERCISE_IDS],
  difficulty: 'medium',
  experience: 'guided',
  dailyGoal: 'regular',
  safety: [],
  voice: true,
  orientation: 'landscape',
  camera: 'front',
  views: DEFAULT_VIEWS,
};

/**
 * First launch (and "Redo setup" in Settings): a few one-question screens that
 * set the app up, ask for the camera with a plain explanation first, and end
 * with a summary. No account, nothing leaves the phone. "Use recommended
 * setup" skips straight to the camera question.
 */
export default function Welcome() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { redo } = useLocalSearchParams<{ redo?: string }>();
  const [settings, update] = useSettings();
  const [draft, setDraft] = useState<Draft>(() =>
    redo
      ? {
          focus: settings.focus.length ? settings.focus : [...EXERCISE_IDS],
          difficulty: settings.difficulty,
          experience: settings.experience ?? 'guided',
          dailyGoal: settings.dailyGoal,
          safety: settings.safety,
          voice: settings.voice,
          orientation: settings.orientation,
          camera: settings.camera,
          views: settings.views,
        }
      : RECOMMENDED,
  );
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  // The Rotation Lock step only matters on iPhone, in landscape.
  const steps = useMemo<StepId[]>(
    () =>
      (['welcome', 'train', 'strict', 'help', 'goal', 'safety', 'voice', 'phone', 'access', 'rotation', 'plan'] as StepId[]).filter(
        (s) => s !== 'rotation' || (Platform.OS === 'ios' && draft.orientation === 'landscape'),
      ),
    [draft.orientation],
  );
  const [at, setAt] = useState<StepId>('welcome');
  const index = steps.indexOf(at);
  const go = (to: StepId) => setAt(to);
  const next = () => setAt(steps[Math.min(index + 1, steps.length - 1)]);
  const back = () => (index > 0 ? setAt(steps[index - 1]) : redo ? (router.canGoBack() ? router.back() : router.replace('/')) : undefined);

  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => scroll.current?.scrollTo({ y: 0, animated: false }), [at]);

  const finish = (openExercise?: Exercise) => {
    update({ ...draft, experience: draft.experience as Experience, exercise: openExercise ?? draft.focus[0] ?? settings.exercise });
    if (openExercise) {
      router.replace('/');
      router.push({ pathname: '/exercise/[id]', params: { id: openExercise } });
    } else if (redo && router.canGoBack()) router.back();
    else router.replace('/');
  };

  const art = Math.min(width, 560) - space.xl * 2;
  const content = renderStep(at, { draft, set, next, go, finish, art });

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
              <Display size={20} style={{ letterSpacing: 4 }}>
                TRUELINE
              </Display>
            </View>
          )}
          {at !== 'welcome' && at !== 'plan' && at !== 'access' && (
            <Pressable accessibilityRole="button" onPress={next} hitSlop={12}>
              <Label tone="muted">Skip</Label>
            </Pressable>
          )}
        </View>
        {at !== 'welcome' && (
          <View style={styles.progress} accessibilityLabel={`Step ${index} of ${steps.length - 1}`}>
            {steps.slice(1).map((s, i) => (
              <View key={s} style={[styles.dot, i < index && { backgroundColor: color.vial }]} />
            ))}
          </View>
        )}
      </View>
      <ScrollView ref={scroll} contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + space.xl }]}>
        {content}
      </ScrollView>
    </View>
  );
}

interface StepProps {
  draft: Draft;
  set: (p: Partial<Draft>) => void;
  next: () => void;
  go: (s: StepId) => void;
  finish: (openExercise?: Exercise) => void;
  art: number;
}

function renderStep(at: StepId, p: StepProps): ReactNode {
  switch (at) {
    case 'welcome':
      return <WelcomeStep {...p} />;
    case 'train':
      return <TrainStep {...p} />;
    case 'strict':
      return <StrictStep {...p} />;
    case 'help':
      return <HelpStep {...p} />;
    case 'goal':
      return <GoalStep {...p} />;
    case 'safety':
      return <SafetyStep {...p} />;
    case 'voice':
      return <VoiceStep {...p} />;
    case 'phone':
      return <PhoneStep {...p} />;
    case 'access':
      return <AccessStep {...p} />;
    case 'rotation':
      return <RotationStep {...p} />;
    case 'plan':
      return <PlanStep {...p} />;
  }
}

// ─── Steps ──────────────────────────────────────────────────────────────────

function WelcomeStep({ next, go, set }: StepProps) {
  return (
    <>
      <View style={{ gap: space.md, marginTop: space.xl }}>
        <Display size={46}>Your rep counter on the floor</Display>
        <Body tone="muted">
          Trueline watches through your camera, counts push-ups and crunches, times your planks and checks your form as you go. Video never
          leaves your phone.
        </Body>
      </View>
      <View style={styles.glyphRow}>
        {EXERCISE_IDS.map((e) => (
          <ExerciseGlyph key={e} exercise={e} size={64} />
        ))}
      </View>
      <View style={{ gap: space.md }}>
        <Button label="Set up · 1 minute" size="lg" onPress={next} />
        <Button
          label="Use recommended setup"
          variant="ghost"
          onPress={() => {
            set(RECOMMENDED);
            go('access');
          }}
        />
        <Mono tone="faint" style={{ textAlign: 'center' }}>
          No account needed. Change anything later in Settings.
        </Mono>
      </View>
    </>
  );
}

function TrainStep({ draft, set, next }: StepProps) {
  const toggle = (e: Exercise) =>
    set({
      focus: draft.focus.includes(e) ? draft.focus.filter((x) => x !== e) : EXERCISE_IDS.filter((x) => x === e || draft.focus.includes(x)),
    });
  return (
    <>
      <Title title="What do you want to train?" detail="Pick any. They show first on your home screen; the rest stay one tap away." />
      <View style={styles.grid}>
        {EXERCISE_IDS.map((e) => (
          <Pressable
            key={e}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: draft.focus.includes(e) }}
            onPress={() => toggle(e)}
            style={[styles.tile, draft.focus.includes(e) && styles.selected]}
          >
            <ExerciseGlyph exercise={e} size={56} active={draft.focus.includes(e)} />
            <Strong size={17}>{EXERCISES[e].label}</Strong>
            <Mono size={12} tone={draft.focus.includes(e) ? 'vial' : 'muted'}>
              {EXERCISES[e].tagline}
            </Mono>
          </Pressable>
        ))}
      </View>
      <Button label="Continue" size="lg" disabled={draft.focus.length === 0} onPress={next} />
    </>
  );
}

const STRICT: { value: Difficulty; title: string; detail: string; badge?: string }[] = [
  { value: 'easy', title: 'Easy', detail: 'Just count. Knees allowed, upper body in view is enough, no form checks.' },
  { value: 'medium', title: 'Medium', detail: 'Count and check the main form points, with some slack.', badge: 'Recommended' },
  { value: 'hard', title: 'Hard', detail: 'Strict form: full depth, a straight body, steady pace.' },
];

function StrictStep({ draft, set, next }: StepProps) {
  return (
    <>
      <Title title="How strict should it be?" detail="You can change this for each set." />
      {STRICT.map((o) => (
        <Option
          key={o.value}
          title={o.title}
          detail={o.detail}
          badge={o.badge}
          selected={draft.difficulty === o.value}
          onPress={() => {
            set({ difficulty: o.value });
            next();
          }}
        />
      ))}
    </>
  );
}

function HelpStep({ draft, set, next }: StepProps) {
  return (
    <>
      <Title title="How much help do you want?" />
      <Option
        title="Guide me"
        detail="A step-by-step guide before each set, full spoken instructions, tips after the set."
        badge="New to this"
        selected={draft.experience === 'guided'}
        onPress={() => {
          set({ experience: 'guided' });
          next();
        }}
      />
      <Option
        title="Keep it quick"
        detail="One tap to start, short cues, just the numbers. The guide still shows before your first set of each exercise."
        selected={draft.experience === 'quick'}
        onPress={() => {
          set({ experience: 'quick' });
          next();
        }}
      />
    </>
  );
}

const GOALS: { value: DailyGoal; title: string }[] = [
  { value: 'light', title: 'Light' },
  { value: 'regular', title: 'Regular' },
  { value: 'serious', title: 'Serious' },
  { value: 'none', title: 'No daily goal' },
];

export function goalLine(g: DailyGoal): string {
  if (g === 'none') return 'Just track what you do.';
  const t = GOAL_TARGETS[g];
  return `${t.reps} reps and ${t.holdMs / 1000 >= 60 ? `${t.holdMs / 60000} min` : `${t.holdMs / 1000} s`} of plank a day`;
}

function GoalStep({ draft, set, next }: StepProps) {
  return (
    <>
      <Title
        title="Pick a daily goal"
        detail="Reps count push-ups and crunches; plank time counts both planks. Home shows how far you are."
      />
      {GOALS.map((g) => (
        <Option
          key={g.value}
          title={g.title}
          detail={goalLine(g.value)}
          badge={g.value === 'regular' ? 'Recommended' : undefined}
          selected={draft.dailyGoal === g.value}
          onPress={() => {
            set({ dailyGoal: g.value });
            next();
          }}
        />
      ))}
    </>
  );
}

function SafetyStep({ draft, set, next }: StepProps) {
  const toggle = (f: SafetyFlag) => set({ safety: draft.safety.includes(f) ? draft.safety.filter((x) => x !== f) : [...draft.safety, f] });
  return (
    <>
      <Title title="Quick safety check" detail="Does any of this apply? It only changes the tips you see, and stays on this phone." />
      {SAFETY_FLAGS.map((f) => (
        <Option key={f} title={SAFETY_LABELS[f]} selected={draft.safety.includes(f)} onPress={() => toggle(f)} multi />
      ))}
      <Option
        title="None of these"
        selected={draft.safety.length === 0}
        onPress={() => {
          set({ safety: [] });
          next();
        }}
      />
      <Body tone="faint" size={13}>
        Trueline is not medical advice. If you have pain, an injury or a health condition, check with a doctor or physio before you start.
      </Body>
      {draft.safety.length > 0 && <Button label="Continue" size="lg" onPress={next} />}
    </>
  );
}

function VoiceStep({ draft, set, next }: StepProps) {
  const sample = () => {
    void Speech.stop();
    Speech.speak('Three. Four. Lift your hips. Five.', { rate: 1 });
  };
  useEffect(() => () => void Speech.stop(), []);
  return (
    <>
      <Title
        title="Want a voice coach?"
        detail="You'll be a couple of metres from the phone, too far to read the screen. The coach counts out loud and tells you what to fix."
      />
      <Button label="▶  Hear a sample" variant="quiet" onPress={sample} />
      <Option
        title="Voice coach on"
        badge="Recommended"
        selected={draft.voice}
        onPress={() => {
          set({ voice: true });
          next();
        }}
      />
      <Option
        title="Voice coach off"
        detail="Short sounds and big numbers only."
        selected={!draft.voice}
        onPress={() => {
          set({ voice: false });
          next();
        }}
      />
    </>
  );
}

function PhoneStep({ draft, set, next, art }: StepProps) {
  const shown = draft.focus.length ? draft.focus : EXERCISE_IDS;
  const setView = (e: Exercise, v: CameraView) => set({ views: { ...draft.views, [e]: v } });
  return (
    <>
      <Title title="How will the phone stand?" detail="On the floor, propped against a wall or something steady." />
      <OrientationPicker value={draft.orientation} onChange={(orientation) => set({ orientation })} />
      <ExerciseAnimation exercise={shown[0]} orientation={draft.orientation} width={art} view={viewFor(shown[0], draft.views)} />
      <View style={{ gap: space.sm }}>
        <Label>Camera</Label>
        <View style={styles.row}>
          <Choice label="Front camera" detail="See the screen" on={draft.camera === 'front'} onPress={() => set({ camera: 'front' })} />
          <Choice
            label="Back camera"
            detail="Sharper, can't see screen"
            on={draft.camera === 'back'}
            onPress={() => set({ camera: 'back' })}
          />
        </View>
      </View>
      <View style={{ gap: space.sm }}>
        <Label>Where the phone sees you from</Label>
        {shown.map((e) => (
          <View key={e} style={styles.viewRow}>
            <ExerciseGlyph exercise={e} size={40} />
            <Strong size={15} style={{ flex: 1 }}>
              {EXERCISES[e].label}
            </Strong>
            {!EXERCISES[e].frontView ? (
              <Mono size={12} tone="muted">
                {e === 'sidePlank' ? 'Facing the phone' : 'Side-on only'}
              </Mono>
            ) : (
              <View style={styles.seg}>
                <Seg label="Side" on={draft.views[e] === 'side'} onPress={() => setView(e, 'side')} />
                <Seg label="Front" on={draft.views[e] === 'front'} onPress={() => setView(e, 'front')} />
              </View>
            )}
          </View>
        ))}
        <Body tone="muted" size={13}>
          Side-on checks your whole body line. Front (facing the phone) is easier to set up and checks what can be seen head-on; the hip
          line is only judged side-on. Crunches need side-on to see the curl.
        </Body>
      </View>
      <Button label="Continue" size="lg" onPress={next} />
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
      <View style={styles.card}>
        <Point text="Runs on this phone. Nothing is recorded or uploaded." />
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
        <Body tone="faint" size={13}>
          Motion is off: the level check will ask you to confirm the phone is set instead.
        </Body>
      )}
    </>
  );
}

function RotationStep({ next, set }: StepProps) {
  const c = rotationCopy(Platform.OS);
  return (
    <>
      <Title title={c.title} detail={c.body} />
      <View style={styles.card}>
        <Point text="Swipe down from the top-right corner of the screen." />
        <Point text="Find the lock with a circular arrow. If it is highlighted, tap it so it turns off." />
        <Point text="That's it: the picture now turns with the phone." />
      </View>
      <Button label={c.ok.replace(', start', '')} size="lg" onPress={next} />
      <Button
        label="Use portrait instead"
        variant="ghost"
        onPress={() => {
          set({ orientation: 'portrait' });
          next();
        }}
      />
    </>
  );
}

function PlanStep({ draft, go, finish }: StepProps) {
  const focus = draft.focus.length ? draft.focus : EXERCISE_IDS;
  const notes = focus.flatMap((e) => safetyNotes(draft.safety, e).map((n) => `${EXERCISES[e].label}: ${n}`));
  return (
    <>
      <Title title="Your setup" detail="Tap a line to change it." />
      <View style={styles.card}>
        <Row label="Training" value={focus.map((e) => EXERCISES[e].label).join(', ')} onPress={() => go('train')} />
        <Row label="Strictness" value={STRICT.find((s) => s.value === draft.difficulty)!.title} onPress={() => go('strict')} />
        <Row label="Help" value={draft.experience === 'quick' ? 'Keep it quick' : 'Guide me'} onPress={() => go('help')} />
        <Row label="Daily goal" value={goalLine(draft.dailyGoal)} onPress={() => go('goal')} />
        <Row label="Voice coach" value={draft.voice ? 'On' : 'Off'} onPress={() => go('voice')} />
        <Row
          label="Phone"
          value={`${draft.orientation === 'landscape' ? 'Landscape' : 'Portrait'}, ${draft.camera} camera · ${focus
            .map(
              (e) => `${EXERCISES[e].label} ${e === 'sidePlank' || viewFor(e, draft.views) === 'front' ? 'facing the phone' : 'side-on'}`,
            )
            .join(', ')}`}
          onPress={() => go('phone')}
        />
      </View>
      {notes.length > 0 && (
        <View style={styles.warn}>
          <Label tone="cue">Take care</Label>
          {notes.slice(0, 4).map((n) => (
            <Body key={n} size={14}>
              {n}
            </Body>
          ))}
        </View>
      )}
      <Button label={`Start with ${EXERCISES[focus[0]].label.toLowerCase()}`} size="lg" onPress={() => finish(focus[0])} />
      <Button label="Go to home" variant="ghost" onPress={() => finish()} />
    </>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function Title({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={{ gap: space.sm }}>
      <Display size={38}>{title}</Display>
      {detail && <Body tone="muted">{detail}</Body>}
    </View>
  );
}

function Option({
  title,
  detail,
  badge,
  selected,
  onPress,
  multi = false,
}: {
  title: string;
  detail?: string;
  badge?: string;
  selected: boolean;
  onPress: () => void;
  multi?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: selected } : { selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.option, selected && styles.selected, pressed && { opacity: 0.85 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <Strong size={17}>{title}</Strong>
          {badge && (
            <Mono size={11} tone="vial">
              {badge.toUpperCase()}
            </Mono>
          )}
        </View>
        {detail && (
          <Body tone="muted" size={14}>
            {detail}
          </Body>
        )}
      </View>
      <View style={[styles.mark, multi && { borderRadius: 6 }, selected && styles.markOn]} />
    </Pressable>
  );
}

function Choice({ label, detail, on, onPress }: { label: string; detail: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.choice, on && styles.selected]}
    >
      <Strong size={15}>{label}</Strong>
      <Mono size={11} tone={on ? 'vial' : 'muted'}>
        {detail}
      </Mono>
    </Pressable>
  );
}

function Seg({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.segItem, on && styles.segOn]}
    >
      <Strong size={14} tone={on ? 'ink' : 'chalk'}>
        {label}
      </Strong>
    </Pressable>
  );
}

function Point({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
      <View style={styles.tick} />
      <Body size={15} style={{ flex: 1 }}>
        {text}
      </Body>
    </View>
  );
}

function Row({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}. Change`} onPress={onPress} style={styles.planRow}>
      <Label style={{ width: 92 }}>{label}</Label>
      <Body size={15} style={{ flex: 1 }}>
        {value}
      </Body>
      <Label tone="chalk">›</Label>
    </Pressable>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 28 },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  markLine: { width: 22, height: 4, borderRadius: 2, backgroundColor: color.vial },
  progress: { flexDirection: 'row', gap: 4, marginTop: space.xs },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.line },
  page: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  glyphRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, justifyContent: 'center', paddingVertical: space.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.lineSoft,
  },
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
    gap: 2,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.lineSoft,
  },
  viewRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  seg: { flexDirection: 'row', borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, overflow: 'hidden' },
  segItem: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  segOn: { backgroundColor: color.vial },
  card: {
    gap: space.md,
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
  planRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
});
