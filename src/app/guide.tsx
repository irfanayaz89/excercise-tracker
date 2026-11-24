import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EXERCISES, isExercise, isTimed, viewFor } from '@/engine/exercises';
import type { Exercise } from '@/engine/types';
import { TECHNIQUE } from '@/features/exercise/technique';
import { TechniqueSteps } from '@/features/exercise/TechniqueList';
import { PLACEMENT, rotationCopy } from '@/session/copy';
import { useSettings, type Settings } from '@/storage/settings';
import { HoldDiagram, RepDiagram } from '@/ui/Diagrams';
import { ExerciseAnimation } from '@/ui/ExerciseAnimation';
import { OrientationPicker } from '@/ui/OrientationPicker';
import { Body, Button, Display, Label, Strong } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';

/**
 * The short guide shown before a set, two pages: where the phone goes (with
 * the animation), then how to do the exercise, the top mistakes and what counts.
 * The full technique (breathing, how much to start with, safety) stays on each
 * exercise's own screen.
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
          <Label tone="vial">{`${viewOnly ? 'How to do' : 'Before your set of'} ${EXERCISES[exercise].label.toLowerCase()}`}</Label>
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
            <Label tone="muted">I know this, skip the guide from now on</Label>
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

/** The guide's two pages for one exercise: where the phone goes, then how to do it and what counts. */
function guidePages(exercise: Exercise, s: Settings, art: number, update: (p: Partial<Settings>) => void): Page[] {
  const timed = isTimed(exercise);
  const camView = viewFor(exercise, s.views);
  const pull = exercise === 'pullup';
  const t = TECHNIQUE[exercise];

  const setup: Page = {
    title: 'Set up',
    body: (
      <>
        {!pull && <OrientationPicker value={s.orientation} onChange={(orientation) => update({ orientation })} />}
        <ExerciseAnimation exercise={exercise} orientation={pull ? 'portrait' : s.orientation} width={art} view={camView} />
        <Body tone="muted">{placementText(exercise, s)}</Body>
        {!pull && s.orientation === 'landscape' && <RotationNote />}
      </>
    ),
  };

  const how: Page = {
    title: 'How to do it',
    body: (
      <>
        {timed ? <HoldDiagram width={art} exercise={exercise} /> : <RepDiagram width={art} exercise={exercise} />}
        <TechniqueSteps exercise={exercise} compact />
        <View style={{ gap: space.xs }} accessibilityRole="list">
          {t.avoid.slice(0, 3).map((a) => (
            <View key={a} style={styles.row}>
              <Strong tone="cue" style={{ width: 18 }}>
                ✕
              </Strong>
              <Body style={{ flex: 1 }} size={14}>
                {a}
              </Body>
            </View>
          ))}
        </View>
        <View style={styles.note}>
          <Strong>{timed ? 'How the clock works' : 'What counts'}</Strong>
          <Body tone="muted" size={15}>
            {countsText(exercise, s)}
          </Body>
        </View>
      </>
    ),
  };

  return [setup, how];
}

/** Where the phone goes and what must be in view, in two short sentences. */
function placementText(exercise: Exercise, s: Settings): string {
  const place = PLACEMENT[s.orientation];
  const easy = s.difficulty === 'easy';
  if (exercise === 'pullup') {
    return 'Portrait, 2–2.5 m from the bar, about waist high (or on the floor, leaning back). Keep the bar, your hands, face and hips in view.';
  }
  if (viewFor(exercise, s.views) === 'front') {
    return 'Upright on the floor 1.2–2 m beyond your hands, facing you. Keep your face, shoulders and both hands in view.';
  }
  const where = exercise === 'sidePlank' ? 'facing you' : 'side-on to you';
  return `${place.how} About ${place.distance} away, ${where}, level with your hips. ${
    easy ? 'Shoulders and hips in view is enough.' : 'Keep head to feet in view.'
  }`;
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

/** What counts (or how the clock runs), in a couple of short sentences. */
function countsText(exercise: Exercise, s: Settings): string {
  const easy = s.difficulty === 'easy';
  const test = s.plankTestMode && isTimed(exercise) ? ' Test mode: the hold ends at the first real form break.' : '';
  const rest = ' Rest any time; your count is kept.';
  switch (exercise) {
    case 'pushup':
      return (
        (easy
          ? 'Get into position and counting starts. Easy mode just counts.'
          : 'Hold a plank to start. Down to about 90°, then all the way up. Half reps don’t count; form slips are flagged.') + rest
      );
    case 'pullup':
      return (
        (easy
          ? 'Hang still to start. Chin over the bar counts. Easy mode just counts.'
          : 'Hang still to start. Chin over the bar, then back to straight arms. Kips and half reps don’t count; swinging or dropping is flagged.') + rest
      );
    case 'crunch':
      return (
        (easy
          ? 'Lie still to start. Curl up a little, then lower. Easy mode just counts.'
          : 'Lie still to start. Curl until your shoulder blades leave the floor, then lower. Half crunches don’t count.') + rest
      );
    case 'plank':
      return 'Get into your plank and the clock starts. It runs while your body stays in one straight line.' + test;
    case 'sidePlank':
      return (
        `Lift your hips facing the phone and the clock starts. Each side is timed on its own${
          s.targetHoldSec > 0 ? `; at ${s.targetHoldSec} s you’ll hear “switch sides”` : ''
        }.` + test
      );
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
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  warn: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.cueSoft,
    borderWidth: 1,
    borderColor: color.cue,
  },
});
