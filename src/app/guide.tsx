import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLACEMENT } from '@/session/copy';
import { useSettings } from '@/storage/settings';
import { RepDiagram, SetupDiagram } from '@/ui/Diagrams';
import { OrientationHint, OrientationPicker } from '@/ui/OrientationPicker';
import { Body, Button, Display, Label, Strong } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';

/**
 * Guided mode only: the whole set explained on one page before the camera
 * opens, so a first-timer knows where to put the phone and what counts.
 */
export default function Guide() {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const { width } = useWindowDimensions();
  const [s, update] = useSettings();
  const place = PLACEMENT[s.orientation];
  const art = Math.min(width, 560) - space.xl * 4;

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <ScrollView contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: space.xl }]}>
        <View style={styles.header}>
          <Label tone="vial">Before your set</Label>
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
            <Label tone="chalk">Close</Label>
          </Pressable>
        </View>
        <Display size={40}>Four things, then go</Display>

        <Step n={1} title="Place the phone">
          <OrientationPicker value={s.orientation} onChange={(orientation) => update({ orientation })} />
          <OrientationHint value={s.orientation} />
          <SetupDiagram width={art} orientation={s.orientation} />
          <Body tone="muted">{`${place.how} Put it about ${place.distance} to the side of your push-up spot, level with your hips, camera facing straight at you. A level, still phone is checked for you.`}</Body>
        </Step>

        <Step n={2} title="Get in view, side-on">
          <Body tone="muted">
            {s.difficulty === 'easy'
              ? 'Arms, shoulders and hips on screen (feet help but are not required)'
              : 'Head to feet inside the screen'}
            , with your side to the phone, not your face. A slight angle is fine. Pick a bright spot and fitted clothes that stand out from
            the floor, so your elbows and hips are easy to see.
          </Body>
        </Step>

        <Step n={3} title="What counts as a rep">
          <RepDiagram width={art} />
          <Body tone="muted">
            {s.difficulty === 'easy'
              ? 'Get into push-up position (knees are fine) and counting starts by itself. Bend your arms well, then push back up. Easy mode only counts; it does not judge your form.'
              : 'Hold a straight-arm plank for a second and counting starts by itself. Go down until your elbows reach about 90°, then push all the way up. Half reps are not counted. Reps with sagging or high hips count, but are flagged so you can improve.'}
          </Body>
        </Step>

        <Step n={4} title="During the set">
          <Body tone="muted">
            Listen for the voice coach: it counts out loud and tells you what to fix. To rest, just stand up or sit back; your count is kept.
            Tap Finish set when you are done.
          </Body>
        </Step>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        <Button label="I'm ready" size="lg" onPress={guard(() => router.replace('/session'))} />
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
      </View>
    </View>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepHead}>
        <Display size={30} tone="vial" style={{ width: 24 }}>
          {n}
        </Display>
        <Strong size={18}>{title}</Strong>
      </View>
      <View style={{ gap: space.md }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  step: {
    gap: space.md,
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.lineSoft,
  },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
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
});
