import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISES, isExercise, isTimed, viewFor } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';
import { TechniqueAvoid, TechniqueSteps } from '@/features/exercise/TechniqueList';
import { PLACEMENT, rotationCopy } from '@/session/copy';
import { useSettings, type Settings } from '@/storage/settings';
import { HoldDiagram, RepDiagram } from '@/ui/Diagrams';
import { ExerciseAnimation } from '@/ui/ExerciseAnimation';
import { OrientationHint, OrientationPicker } from '@/ui/OrientationPicker';
import { Body, Button, Display, Label, Strong } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';

/**
 * The step-by-step guide shown before a set: where the phone goes, how to get
 * in view, how to do the exercise, what to avoid, and what counts. One step
 * per page so a first-timer reads each part.
 *
 * `?ex=<exercise>&view=1` opens it to read only (from an exercise's screen):
 * the last page closes instead of starting a set.
 */
export default function Guide() {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ ex?: string; view?: string }>();
  const [s, update] = useSettings();
  const exercise: Exercise = isExercise(params.ex) ? params.ex : s.exercise;
  const viewOnly = params.view === '1';
  const art = Math.min(width, 560) - space.xl * 4;
  const pages = guidePages(exercise, s, art, update);
  const [page, setPage] = useState(0);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const last = page === pages.length - 1;
  const p = pages[page];

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [page]);

  const start = guard(() => router.replace('/session'));
  const next = () => (last ? (viewOnly ? router.back() : start()) : setPage(page + 1));

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <View style={[styles.top, { paddingTop: insets.top + space.lg }]}>
        <View style={styles.header}>
          <Label tone="vial">{`${viewOnly ? 'How to' : 'Before your set'} · ${EXERCISES[exercise].label}`}</Label>
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
            <Label tone="chalk">Close</Label>
          </Pressable>
        </View>
        <View style={styles.progress} accessibilityLabel={`Step ${page + 1} of ${pages.length}`}>
          {pages.map((_, i) => (
            <View key={i} style={[styles.dot, i <= page && { backgroundColor: color.vial }]} />
          ))}
        </View>
        <Label>{`Step ${page + 1} of ${pages.length}`}</Label>
      </View>

      <ScrollView ref={scroll} contentContainerStyle={[styles.page, { paddingBottom: space.xl }]}>
        <Display size={40}>{p.title}</Display>
        <View style={{ gap: space.lg }}>{p.body}</View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.nav}>
          {page > 0 && <Button label="Back" variant="ghost" size="lg" style={{ flex: 1 }} onPress={() => setPage(page - 1)} />}
          <Button label={last ? (viewOnly ? 'Got it' : 'Start set') : 'Next'} size="lg" style={{ flex: page > 0 ? 2 : 1 }} onPress={next} />
        </View>
        {!viewOnly && (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            style={{ alignSelf: 'center' }}
            onPress={guard(() => {
              update({ experience: 'quick' });
              router.replace('/session');
            })}
          >
            <Label tone="muted">I know this · skip the guide from now on</Label>
          </Pressable>
        )}
      </View>
    </View>
  );
}

interface Page {
  title: string;
  body: React.ReactNode;
}

/** The guide's pages for one exercise, worded for its level and settings. */
function guidePages(exercise: Exercise, s: Settings, art: number, update: (p: Partial<Settings>) => void): Page[] {
  const place = PLACEMENT[s.orientation];
  const timed = isTimed(exercise);
  const camView = viewFor(exercise, s.views);
  const front = camView === 'front';
  const easy = s.difficulty === 'easy';
  const spot =
    exercise === 'sidePlank'
      ? 'your mat; you will lie on your side facing it'
      : exercise === 'crunch'
        ? 'where you will lie down'
        : timed
          ? 'where you will hold your plank'
          : 'your push-up spot';

  const phone: Page = {
    title: 'Place the phone',
    body: (
      <>
        <OrientationPicker value={s.orientation} onChange={(orientation) => update({ orientation })} />
        <OrientationHint value={s.orientation} />
        <ExerciseAnimation exercise={exercise} orientation={s.orientation} width={art} view={camView} />
        <Body tone="muted">
          {front
            ? 'Stand the phone upright on the floor 1.2–2 m beyond where your hands will be, facing you. Portrait fits best. A level, still phone is checked for you.'
            : `${place.how} Put it about ${place.distance} to the side of ${spot}, level with your hips, camera facing straight at you. A level, still phone is checked for you.`}
        </Body>
        {front && (
          <Body tone="faint" size={13}>
            {exercise === 'plank'
              ? 'Front view times the hold and checks your arms. Your hip line is only judged from the side.'
              : 'Front view counts reps and checks what can be seen head-on (depth, arms, elbows flaring, one side dropping). Your hip line is only judged from the side.'}
          </Body>
        )}
        {s.orientation === 'landscape' && <RotationNote />}
      </>
    ),
  };

  const view: Page = {
    title: 'Get in view',
    body: (
      <Body tone="muted">
        {front
          ? 'Head towards the phone, so your face, shoulders and both hands are in the picture. Your feet do not need to be.'
          : exercise === 'sidePlank'
            ? 'Face the phone, lying on your side, with your head at one end of the screen and your feet at the other.'
            : exercise === 'crunch'
              ? 'Lie on your back with your side to the phone, head at one end of the screen and feet at the other.'
              : 'Side-on to the phone, not facing it, with your head at one end of the screen and your feet at the other.'}{' '}
        {easy
          ? 'Shoulders and hips on screen is enough; feet help but are not required.'
          : 'Keep everything from head to feet inside the screen.'}{' '}
        A slight angle is fine. Pick a bright spot and fitted clothes that stand out from the floor.
      </Body>
    ),
  };

  const how: Page = {
    title: 'How to do it',
    body: (
      <>
        {timed ? <HoldDiagram width={art} exercise={exercise} /> : <RepDiagram width={art} exercise={exercise} />}
        <TechniqueSteps exercise={exercise} />
      </>
    ),
  };

  const avoid: Page = { title: 'Avoid these', body: <TechniqueAvoid exercise={exercise} /> };

  const counts: Page = {
    title: timed ? 'How the clock works' : 'What counts',
    body: (
      <>
        <Body>{countsText(exercise, s)}</Body>
        <View style={styles.note}>
          <Strong>During the set</Strong>
          <Body tone="muted" size={15}>
            {duringText(exercise)}
          </Body>
        </View>
      </>
    ),
  };

  return [phone, view, how, avoid, counts];
}

/** Landscape: Rotation Lock must be off, or the picture can reach the tracker upside down. */
function RotationNote() {
  const c = rotationCopy(Platform.OS);
  return (
    <View style={styles.warn}>
      <Strong tone="cue">{`First, ${c.title.charAt(0).toLowerCase()}${c.title.slice(1)}`}</Strong>
      <Body size={15}>{c.body}</Body>
    </View>
  );
}

function countsText(exercise: Exercise, s: Settings): string {
  const easy = s.difficulty === 'easy';
  const test = s.plankTestMode && isTimed(exercise) ? ' Test mode is on: the hold ends at the first real form break.' : '';
  switch (exercise) {
    case 'pushup':
      return easy
        ? 'Get into push-up position (knees are fine) and counting starts by itself. Bend your arms well, then push back up. Easy mode only counts; it does not judge your form.'
        : 'Hold a straight-arm plank for a second and counting starts by itself. Go down until your elbows reach about 90°, then push all the way up. Half reps are not counted. Reps with sagging or high hips count, but are flagged so you can improve.';
    case 'crunch':
      return easy
        ? 'Lie on your back with your knees bent and keep still for a second: counting starts by itself. Curl up a little, then lower back down. Easy mode only counts; it does not judge your form.'
        : 'Lie still on your back for a second and counting starts by itself. Curl up until your shoulder blades leave the floor, then lower back down: that is one rep. Half crunches are not counted. Sitting all the way up, lifting your feet or rushing still count, but are flagged so you can improve.';
    case 'plank':
      return (
        (easy
          ? 'Get into a plank on straight arms or forearms (knees are fine) and the clock starts by itself. Only a big sag or piked hips stop it.'
          : 'Hold a plank on straight arms, or on your forearms with elbows under your shoulders, and the clock starts by itself. It runs while your body stays in one straight line, and pauses if your hips sag or rise until you fix them.') +
        test
      );
    case 'sidePlank':
      return (
        `Lie on one side facing the phone and lift your hips: the clock starts by itself. It runs while your body stays in one line, and pauses if your hips drop or you roll forward or back. Each side is timed on its own${
          s.targetHoldSec > 0 ? `: when one side reaches ${s.targetHoldSec} seconds you will hear "switch sides"` : ''
        }.` + test
      );
  }
}

function duringText(exercise: Exercise): string {
  switch (exercise) {
    case 'pushup':
      return 'The voice coach counts out loud and tells you what to fix. To rest, stand up or sit back; your count is kept. Tap Finish set when you are done.';
    case 'crunch':
      return 'The voice coach counts out loud and tells you what to fix. To rest, sit up or stretch your legs out; your count is kept. Tap Finish set when you are done.';
    case 'plank':
      return 'The voice coach calls your time every 15 seconds and warns you when your hips drift, before the clock stops. To rest, drop to the floor; your time is kept. Tap Finish when you are done.';
    case 'sidePlank':
      return 'The voice coach calls your time and warns you when your hips drop, before the clock stops. To switch sides, get up and turn around so you face the phone with your other side down. Tap Finish when both sides are done.';
  }
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progress: { flexDirection: 'row', gap: space.xs, marginTop: space.sm },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.line },
  page: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  note: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.lineSoft,
  },
  footer: {
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    backgroundColor: color.ground,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  nav: { flexDirection: 'row', gap: space.md },
  warn: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.cueSoft,
    borderWidth: 1,
    borderColor: color.cue,
  },
});
