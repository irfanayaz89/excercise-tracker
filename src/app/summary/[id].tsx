import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MissReason, RepFault, RepRecord } from '@/engine/repCounter';
import type { SessionSummary } from '@/engine/session';
import type { HoldFault, HoldSummary } from '@/engine/holdTimer';
import { DIFFICULTY_COPY, FAULT_COPY, HOLD_COPY, MISS_COPY, formatDuration } from '@/session/copy';
import { getLastSummary } from '@/session/lastSummary';
import { getSession } from '@/storage/history';
import { useSettings } from '@/storage/settings';
import { Body, Button, Display, Label, Mono, Rule, Strong } from '@/ui/primitives';
import { ExerciseGlyph } from '@/ui/Diagrams';
import { Tally } from '@/ui/Tally';
import { color, radius, space, type } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';

const END_NOTE: Record<SessionSummary['endReason'], string | null> = {
  user: null,
  target: 'Target reached.',
  idle: 'Ended on its own after a long stretch with no reps.',
  'paused-too-long': 'Ended on its own after a long pause.',
  'form-break': 'Ended at the first form break (test mode).',
};

/** A stored set that cannot be shown must not take the app down. */
export { ErrorScreen as ErrorBoundary } from '@/ui/ErrorScreen';

export default function SummaryScreen() {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [settings] = useSettings();
  const guided = settings.experience !== 'quick';

  const data = useMemo(() => {
    const last = getLastSummary();
    if (id === 'last' || (last && last.savedId === id)) {
      return last ? { summary: last.summary, wallStart: last.wallStart, saved: last.savedId !== null, demo: !!last.demo } : null;
    }
    const stored = id ? getSession(id) : null;
    return stored ? { summary: stored.summary, wallStart: stored.row.startedAt, saved: true, demo: false } : null;
  }, [id]);

  if (!data) {
    return (
      <View style={[styles.empty, { paddingTop: insets.top + space.xl }]}>
        <Display size={type.headline}>Set not found</Display>
        <Body tone="muted">This set is no longer in your history.</Body>
        <Button label="Back home" onPress={() => router.dismissTo('/')} />
      </View>
    );
  }

  const { summary: s, wallStart, saved, demo } = data;
  const faults = (Object.entries(s.faultCounts) as [RepFault, number][]).sort((a, b) => b[1] - a[1]);
  const misses = (Object.entries(s.missCounts) as [MissReason, number][]).sort((a, b) => b[1] - a[1]);
  const missTotal = misses.reduce((n, [, c]) => n + c, 0);
  const flagged = s.totalReps - s.cleanReps;
  const note = END_NOTE[s.endReason];
  const level = s.difficulty === 'easy' || s.difficulty === 'medium' || s.difficulty === 'hard' ? s.difficulty : null;
  const levelLabel = level ? `${DIFFICULTY_COPY[level].label} mode` : null;
  const header = `${new Date(wallStart).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ${formatDuration(s.activeMs)}${levelLabel ? ` · ${levelLabel}` : ''}`;

  if (s.exercise === 'plank') {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: color.ground }}
        contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.huge }]}
      >
        <View style={styles.headRow}>
          <ExerciseGlyph exercise="plank" size={36} />
          <Label style={{ flexShrink: 1 }}>{header}</Label>
        </View>
        <PlankResult
          hold={s.hold}
          note={s.endReason === 'idle' ? 'Ended on its own after a long stretch out of position.' : note}
          saved={saved}
          demo={demo}
          guided={guided}
          easy={level === 'easy'}
        />
        <View style={{ gap: space.md }}>
          <Button label="Another plank" size="lg" onPress={guard(() => router.replace('/session'))} />
          <Button label="Done" variant="ghost" onPress={() => router.dismissTo('/')} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.huge }]}
    >
      <View style={styles.headRow}>
        <ExerciseGlyph exercise="pushup" size={36} />
        <Label style={{ flexShrink: 1 }}>{header}</Label>
      </View>

      {s.totalReps === 0 ? (
        <View style={{ gap: space.md }}>
          <Display size={type.headline}>No push-ups counted</Display>
          <Body tone="muted">
            {missTotal > 0
              ? 'Reps were seen but did not reach the full range. Go down until your elbows reach about 90° and push all the way back up.'
              : 'Make sure your whole body is in view, side-on to the phone, and that you start from a straight-arm plank.'}
          </Body>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md }}>
            <Display size={type.hero * 1.8} style={{ fontFamily: 'BigShouldersDisplay_900Black' }}>
              {s.totalReps}
            </Display>
            <Body tone="muted" style={{ marginBottom: 18 }}>
              push-ups
            </Body>
          </View>
          <Tally reps={s.reps.map((r) => r.clean)} height={30} maxGroups={20} />
        </View>
      )}

      {note && <Mono tone="vial">{note}</Mono>}
      {demo ? (
        <Mono tone="muted">Demo set · not added to your history.</Mono>
      ) : (
        !saved && s.totalReps > 0 && <Mono tone="cue">This set could not be saved to history.</Mono>
      )}

      <View style={styles.stats}>
        <Stat label="Clean" value={String(s.cleanReps)} tone="good" />
        <Stat label="Flagged" value={String(flagged)} tone={flagged ? 'cue' : 'chalk'} />
        <Stat label="Best streak" value={String(s.bestCleanStreak)} />
        <Stat label="Avg rep" value={s.avgRepMs ? `${(s.avgRepMs / 1000).toFixed(1)}s` : '—'} />
      </View>

      {s.reps.length > 1 && <TempoChart reps={s.reps} />}

      {guided && s.totalReps > 0 && level === 'easy' && (
        <View style={styles.tip}>
          <Label tone="vial">Next time</Label>
          <Body>Counted in Easy mode, without form checks. When setup feels easy, try Medium to get feedback on your hips and depth.</Body>
        </View>
      )}
      {guided && s.totalReps > 0 && level !== 'easy' && <NextTime faults={faults} misses={misses} cleanShare={s.cleanReps / s.totalReps} />}

      {faults.length > 0 && (
        <View style={{ gap: space.md }}>
          <Label>Form to work on</Label>
          <View style={styles.list}>
            {faults.map(([f, n], i) => (
              <View key={f}>
                {i > 0 && <Rule />}
                <View style={styles.item}>
                  <Display size={32} tone={f === 'head-dropping' ? 'muted' : 'cue'} style={{ minWidth: 40 }}>
                    {n}
                  </Display>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Strong>{FAULT_COPY[f]?.short ?? f}</Strong>
                    {guided && (
                      <Body tone="muted" size={14}>
                        {FAULT_COPY[f]?.detail}
                      </Body>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {misses.length > 0 && (
        <View style={{ gap: space.md }}>
          <Label>{`Not counted · ${missTotal}`}</Label>
          <View style={styles.list}>
            {misses.map(([m, n], i) => (
              <View key={m}>
                {i > 0 && <Rule />}
                <View style={styles.item}>
                  <Display size={32} tone="muted" style={{ minWidth: 40 }}>
                    {n}
                  </Display>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Strong>{MISS_COPY[m]?.short ?? m}</Strong>
                    {guided && (
                      <Body tone="muted" size={14}>
                        {MISS_COPY[m]?.detail}
                      </Body>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={{ gap: space.md }}>
        <Button label="Another set" size="lg" onPress={guard(() => router.replace('/session'))} />
        <Button label="Done" variant="ghost" onPress={() => router.dismissTo('/')} />
      </View>
    </ScrollView>
  );
}

/** Plank results: time in good form first, then where the rest of the time went. */
function PlankResult({
  hold,
  note,
  saved,
  demo,
  guided,
  easy,
}: {
  hold: HoldSummary | undefined;
  note: string | null;
  saved: boolean;
  demo: boolean;
  guided: boolean;
  easy: boolean;
}) {
  if (!hold || hold.goodMs < 1000) {
    return (
      <View style={{ gap: space.md }}>
        <Display size={type.headline}>No plank timed</Display>
        <Body tone="muted">
          Hold a plank on straight arms or forearms, side-on to the phone, with your body in view. The clock starts once you are steady.
        </Body>
        {demo && <Mono tone="muted">Demo set · not added to your history.</Mono>}
      </View>
    );
  }
  const faults = (Object.entries(hold.faultMs) as [HoldFault, number][]).filter(([, ms]) => ms >= 500).sort((a, b) => b[1] - a[1]);
  const pct = Math.round(hold.formPct * 100);
  const top = faults.find(([f]) => f !== 'dropped');
  const tip = top
    ? `Most of the lost time was "${HOLD_COPY[top[0]].short.toLowerCase()}". ${HOLD_COPY[top[0]].detail}`
    : hold.breaks === 0
      ? easy
        ? 'No breaks. When this feels easy, try Medium so the clock also checks your hips more closely.'
        : 'No breaks. Next time, pick a longer target.'
      : 'Rest a little longer between holds, then keep one straight line from shoulders to heels.';
  return (
    <>
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md }}>
          <Display size={type.hero * 1.5} style={{ fontFamily: 'BigShouldersDisplay_900Black' }}>
            {formatDuration(hold.goodMs)}
          </Display>
          <Body tone="muted" style={{ marginBottom: 16 }}>
            in good form
          </Body>
        </View>
        <View style={styles.formBar} accessible accessibilityLabel={`${pct} percent of the hold in good form`}>
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color.good }} />
        </View>
      </View>

      {note && <Mono tone="vial">{note}</Mono>}
      {demo ? (
        <Mono tone="muted">Demo set · not added to your history.</Mono>
      ) : (
        !saved && <Mono tone="cue">This plank could not be saved to history.</Mono>
      )}

      <View style={styles.stats}>
        <Stat label="Good form" value={`${pct}%`} tone={pct >= 90 ? 'good' : pct >= 70 ? 'chalk' : 'cue'} />
        <Stat label="Longest hold" value={formatDuration(hold.longestMs)} />
        <Stat label="Breaks" value={String(hold.breaks)} tone={hold.breaks ? 'cue' : 'chalk'} />
        <Stat label="Plank" value={hold.variant === 'forearm' ? 'Forearm' : 'High'} />
      </View>

      {guided && (
        <View style={styles.tip}>
          <Label tone="vial">Next time</Label>
          <Body>{tip}</Body>
        </View>
      )}

      {(faults.length > 0 || hold.headDownMs >= 3000) && (
        <View style={{ gap: space.md }}>
          <Label>Time out of form</Label>
          <View style={styles.list}>
            {faults.map(([f, ms], i) => (
              <View key={f}>
                {i > 0 && <Rule />}
                <View style={styles.item}>
                  <Display size={32} tone="cue" style={{ minWidth: 64 }}>
                    {formatDuration(ms)}
                  </Display>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Strong>{HOLD_COPY[f].short}</Strong>
                    {guided && (
                      <Body tone="muted" size={14}>
                        {HOLD_COPY[f].detail}
                      </Body>
                    )}
                  </View>
                </View>
              </View>
            ))}
            {hold.headDownMs >= 3000 && (
              <View>
                {faults.length > 0 && <Rule />}
                <View style={styles.item}>
                  <Display size={32} tone="muted" style={{ minWidth: 64 }}>
                    {formatDuration(hold.headDownMs)}
                  </Display>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Strong>{FAULT_COPY['head-dropping'].short}</Strong>
                    {guided && (
                      <Body tone="muted" size={14}>
                        {FAULT_COPY['head-dropping'].detail} This is a tip; it does not stop the clock.
                      </Body>
                    )}
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      )}
    </>
  );
}

/** Guided mode: one plain-language thing to focus on next set. */
function NextTime({ faults, misses, cleanShare }: { faults: [RepFault, number][]; misses: [MissReason, number][]; cleanShare: number }) {
  const topFault = faults.find(([f]) => f !== 'head-dropping');
  const tip = topFault
    ? `Most flagged reps were "${FAULT_COPY[topFault[0]].short.toLowerCase()}". ${FAULT_COPY[topFault[0]].detail}`
    : misses[0]
      ? `${MISS_COPY[misses[0][0]].detail} Those reps were not counted.`
      : cleanShare === 1
        ? 'Every rep was clean. Next time, try a few more or slow the way down to about two seconds.'
        : 'Solid set. Keep your body in one straight line from shoulders to heels.';
  return (
    <View style={styles.tip}>
      <Label tone="vial">Next time</Label>
      <Body>{tip}</Body>
    </View>
  );
}

function Stat({ label, value, tone = 'chalk' }: { label: string; value: string; tone?: 'chalk' | 'good' | 'cue' }) {
  return (
    <View style={styles.stat}>
      <Label>{label}</Label>
      <Display size={36} tone={tone}>
        {value}
      </Display>
    </View>
  );
}

/** One bar per rep: height = time taken, colour = clean or flagged. */
function TempoChart({ reps }: { reps: RepRecord[] }) {
  const max = Math.max(...reps.map((r) => r.durationMs));
  return (
    <View style={{ gap: space.sm }}>
      <Label>Each rep · bar height is time taken</Label>
      <View
        style={styles.chart}
        accessible
        accessibilityLabel={`Rep tempo chart: ${reps.length} reps, ${reps.filter((r) => !r.clean).length} flagged`}
      >
        {reps.map((r) => (
          <View key={r.index} style={styles.barSlot}>
            <View
              style={[
                styles.bar,
                { height: `${Math.max(6, (r.durationMs / max) * 100)}%`, backgroundColor: r.clean ? color.chalk2 : color.cue },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Mono size={11} tone="faint">
          rep 1
        </Mono>
        <Mono size={11} tone="faint">{`${(max / 1000).toFixed(1)}s max`}</Mono>
        <Mono size={11} tone="faint">{`rep ${reps.length}`}</Mono>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  empty: { flex: 1, backgroundColor: color.ground, padding: space.xl, gap: space.lg },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg },
  stat: { width: '50%', gap: 4 },
  list: { borderRadius: radius.lg, borderWidth: 1, borderColor: color.lineSoft, overflow: 'hidden' },
  item: { flexDirection: 'row', gap: space.lg, padding: space.lg, alignItems: 'flex-start' },
  tip: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderLeftWidth: 4,
    borderLeftColor: color.vial,
  },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 96, gap: 3 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  formBar: { height: 8, borderRadius: 4, backgroundColor: color.raised, overflow: 'hidden' },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 2 },
});
