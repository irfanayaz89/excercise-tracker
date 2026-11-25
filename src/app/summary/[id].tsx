import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HINT_FAULTS, type MissReason, type RepFault, type RepRecord } from '@/engine/repCounter';
import type { Exercise } from '@/engine/types';
import type { SessionSummary } from '@/engine/session';
import type { HoldFault, HoldSummary } from '@/engine/holdTimer';
import { DIFFICULTY_COPY, FAULT_COPY, HOLD_COPY, faultCopy, formatDuration, missCopy } from '@/session/copy';
import { getLastSummary } from '@/session/lastSummary';
import { bestBefore, correctReps, deleteSession, getSession } from '@/storage/history';
import { SetCalories } from '@/features/energy/Calories';
import { useSettings } from '@/storage/settings';
import { Body, Button, Display, Label, Mono, Rule, Stat, Strong } from '@/ui/primitives';
import { ExerciseGlyph } from '@/ui/Diagrams';
import { Tally } from '@/ui/Tally';
import { color, radius, space, type, font } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';
import { EXERCISES, isTimed } from '@/engine/exercises';

/** "+18 min screen time" after a set that earned some (plan §4), and how the workout focus went. */
function EarnedNote({
  earned,
  focus,
}: {
  earned: { minutes: number; capped: boolean; bonus?: number; halfRate?: boolean } | null;
  focus?: { heldMin: number; continuesUntil: number | null } | null;
}) {
  if (!earned && !focus) return null;
  const parts: string[] = [];
  if (earned)
    parts.push(
      earned.minutes > 0
        ? `+${earned.minutes} min screen time${earned.bonus ? `, including ${earned.bonus} min of bonuses` : ''}${earned.capped ? ' · today’s earning limit reached' : earned.halfRate ? ' · half rate after your first hour today' : ''}`
        : 'Today’s earning limit is reached: this set earned no screen time.',
    );
  if (focus?.continuesUntil)
    parts.push(`Focus continues until ${new Date(focus.continuesUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  else if (focus && focus.heldMin > 0) parts.push(`Focus held ${focus.heldMin} min`);
  if (!parts.length) return null;
  const text = parts.join(' · ');
  return (
    <View style={styles.earned} accessible accessibilityLabel={text}>
      <Mono tone={earned && earned.minutes === 0 && !focus ? 'muted' : 'good'}>{text}</Mono>
    </View>
  );
}

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
  const { id, fresh: freshParam } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const [settings, updateSettings] = useSettings();
  const guided = settings.experience !== 'quick';

  const data = useMemo(() => {
    const last = getLastSummary();
    // The in-memory copy is only for the set that just ended (opened from the session);
    // opened later from history, read what's saved (it may have been fixed since).
    if (id === 'last' || (last && last.savedId === id && freshParam === '1')) {
      return last
        ? {
            summary: last.summary,
            wallStart: last.wallStart,
            saved: last.savedId !== null,
            demo: !!last.demo,
            earned: last.earned ?? null,
            focus: last.focus ?? null,
            savedId: last.savedId,
            fresh: true,
          }
        : null;
    }
    const stored = id ? getSession(id) : null;
    return stored
      ? {
          summary: stored.summary,
          wallStart: stored.row.startedAt,
          saved: true,
          demo: false,
          earned: null,
          focus: null,
          savedId: id,
          fresh: false,
        }
      : null;
  }, [id, freshParam]);
  // A count fixed by hand on this screen (history and calories follow it).
  const [fixed, setFixed] = useState<number | null>(null);

  if (!data) {
    return (
      <View style={[styles.empty, { paddingTop: insets.top + space.xl }]}>
        <Display size={type.headline}>Set not found</Display>
        <Body tone="muted">This set is no longer in your history.</Body>
        <Button label="Back home" onPress={() => router.dismissTo('/')} />
      </View>
    );
  }

  const { wallStart, saved, demo, earned, focus, savedId, fresh } = data;
  /** Another set of this exercise (not whatever was picked last), and a demo stays a demo. */
  const another = () => {
    const exercise = data.summary.exercise ?? 'pushup';
    updateSettings({ exercise });
    router.replace(demo ? { pathname: '/session', params: { demo: '1', ex: exercise } } : '/session');
  };
  const counted = fixed !== null || data.summary.counted !== undefined;
  const s =
    fixed === null
      ? data.summary
      : { ...data.summary, totalReps: fixed, cleanReps: Math.min(data.summary.counted?.clean ?? data.summary.cleanReps, fixed) };
  const faults = (Object.entries(s.faultCounts) as [RepFault, number][]).sort((a, b) => b[1] - a[1]);
  const misses = (Object.entries(s.missCounts) as [MissReason, number][]).sort((a, b) => b[1] - a[1]);
  const missTotal = misses.reduce((n, [, c]) => n + c, 0);
  const ex: Exercise = s.exercise ?? 'pushup';
  const crunch = ex === 'crunch';
  const flagged = s.totalReps - s.cleanReps;
  const note = END_NOTE[s.endReason];
  const level = s.difficulty === 'easy' || s.difficulty === 'medium' || s.difficulty === 'hard' ? s.difficulty : null;
  const levelLabel = level ? `${DIFFICULTY_COPY[level].label} mode` : null;
  const header = `${new Date(wallStart).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · ${formatDuration(s.activeMs)}${levelLabel ? ` · ${levelLabel}` : ''}`;

  if (isTimed(s.exercise ?? 'pushup')) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: color.ground }}
        contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.huge }]}
      >
        <View style={styles.headRow}>
          <ExerciseGlyph exercise={s.exercise ?? 'plank'} size={36} />
          <Label style={{ flexShrink: 1 }}>{header}</Label>
        </View>
        <EarnedNote earned={earned} focus={focus} />
        <PlankResult
          hold={s.hold}
          sides={s.exercise === 'sidePlank' ? (s.holdSides ?? {}) : null}
          note={s.endReason === 'idle' ? 'Ended on its own after a long stretch out of position.' : note}
          saved={saved}
          demo={demo}
          guided={guided}
          easy={level === 'easy'}
          exercise={s.exercise ?? 'plank'}
        />
        {saved && savedId && !demo && <PersonalBest exercise={s.exercise ?? 'plank'} id={savedId} value={s.hold?.goodMs ?? 0} />}
        <View style={{ gap: space.md }}>
          {fresh && <RestTimer />}
          <Button label={`Another ${EXERCISES[s.exercise ?? 'plank'].label.toLowerCase()}`} size="lg" onPress={guard(another)} />
          <Button label="Done" variant="ghost" onPress={() => router.dismissTo('/')} />
          {saved && savedId && !demo && <DeleteSet id={savedId} />}
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
        <ExerciseGlyph exercise={ex} size={36} />
        <Label style={{ flexShrink: 1 }}>{header}</Label>
      </View>
      <EarnedNote earned={earned} focus={focus} />

      {s.totalReps === 0 ? (
        <View style={{ gap: space.md }}>
          <Display size={type.headline}>{`No ${EXERCISES[ex].unit} counted`}</Display>
          <Body tone="muted">
            {crunch
              ? missTotal > 0
                ? 'Crunches were seen but did not lift far enough. Curl up until your shoulder blades leave the floor, then lower back down.'
                : 'Make sure your whole body is in view, side-on to the phone, and that you start lying still on your back with your knees bent.'
              : missTotal > 0
                ? 'Reps were seen but did not reach the full range. Go down until your elbows reach about 90° and push all the way back up.'
                : 'Make sure your whole body is in view, side-on to the phone, and that you start from a straight-arm plank.'}
          </Body>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md }}>
            <Display size={type.hero * 1.8} style={{ fontFamily: font.displayBlack }}>
              {s.totalReps}
            </Display>
            <Body tone="muted" style={{ marginBottom: 18 }}>
              {EXERCISES[ex].unit}
            </Body>
          </View>
          {!counted && <Tally reps={s.reps.map((r) => r.clean)} height={30} maxGroups={20} />}
          {counted && (
            <Mono tone="muted">
              {`Count fixed by hand${data.summary.counted ? ` (the camera counted ${data.summary.counted.total})` : ''}.`}
            </Mono>
          )}
          {/* Same inputs as the history list (active time over reps), so a set shows one calorie figure everywhere. */}
          <SetCalories exercise={ex} activeMs={s.activeMs} holdMs={0} reps={s.totalReps} />
        </View>
      )}
      {saved && savedId && !demo && s.totalReps > 0 && <PersonalBest exercise={ex} id={savedId} value={s.totalReps} />}
      {saved && savedId && !demo && (
        <FixCount
          total={s.totalReps}
          onFix={(n) => {
            const res = correctReps(savedId, n);
            if (res === 'deleted') router.dismissTo('/');
            else if (res === 'saved') setFixed(n);
          }}
        />
      )}

      {note && <Mono tone="vial">{note}</Mono>}
      {demo ? (
        <Mono tone="muted">Demo set · not added to your history.</Mono>
      ) : (
        !saved && s.totalReps > 0 && <Mono tone="cue">This set could not be saved to history.</Mono>
      )}

      <View style={styles.stats}>
        <Stat size="lg" style={styles.stat} label="Clean" value={String(s.cleanReps)} tone="good" />
        <Stat size="lg" style={styles.stat} label="Flagged" value={String(flagged)} tone={flagged ? 'cue' : 'chalk'} />
        {!counted && <Stat size="lg" style={styles.stat} label="Best streak" value={String(s.bestCleanStreak)} />}
        <Stat size="lg" style={styles.stat} label="Avg rep" value={s.avgRepMs ? `${(s.avgRepMs / 1000).toFixed(1)}s` : '—'} />
      </View>

      {!counted && s.reps.length > 1 && <TempoChart reps={s.reps} />}

      {guided && s.totalReps > 0 && level === 'easy' && (
        <View style={styles.tip}>
          <Label tone="vial">Next time</Label>
          <Body>
            {`Counted in Easy mode, without form checks. When setup feels easy, try Medium to get feedback on your ${crunch ? 'lift, feet and pace' : 'hips and depth'}.`}
          </Body>
        </View>
      )}
      {guided && s.totalReps > 0 && level !== 'easy' && (
        <NextTime faults={faults} misses={misses} cleanShare={s.cleanReps / s.totalReps} exercise={ex} />
      )}

      {faults.length > 0 && (
        <View style={{ gap: space.md }}>
          <Label>Form to work on</Label>
          <View style={styles.list}>
            {faults.map(([f, n], i) => (
              <View key={f}>
                {i > 0 && <Rule />}
                <View style={styles.item}>
                  <Display size={type.displayM} tone={HINT_FAULTS.includes(f) ? 'muted' : 'cue'} style={{ minWidth: 40 }}>
                    {n}
                  </Display>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Strong>{faultCopy(f, ex)?.short ?? f}</Strong>
                    {guided && (
                      <Body tone="muted" size={type.note}>
                        {faultCopy(f, ex)?.detail}
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
                  <Display size={type.displayM} tone="muted" style={{ minWidth: 40 }}>
                    {n}
                  </Display>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Strong>{missCopy(m, ex)?.short ?? m}</Strong>
                    {guided && (
                      <Body tone="muted" size={type.note}>
                        {missCopy(m, ex)?.detail}
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
        {fresh && <RestTimer />}
        <Button label="Another set" size="lg" onPress={guard(another)} />
        <Button label="Done" variant="ghost" onPress={() => router.dismissTo('/')} />
        {saved && savedId && !demo && <DeleteSet id={savedId} />}
      </View>
    </ScrollView>
  );
}

/** Plank results: time in good form first, then where the rest of the time went. */
function PlankResult({
  hold,
  sides,
  note,
  saved,
  demo,
  guided,
  easy,
  exercise,
}: {
  exercise: Exercise;
  hold: HoldSummary | undefined;
  /** Side plank: each side's hold; null for a regular plank. */
  sides: SessionSummary['holdSides'] | null;
  note: string | null;
  saved: boolean;
  demo: boolean;
  guided: boolean;
  easy: boolean;
}) {
  if (!hold || hold.goodMs < 1000) {
    return (
      <View style={{ gap: space.md }}>
        <Display size={type.headline}>{sides ? 'No side plank timed' : 'No plank timed'}</Display>
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
          <Display size={type.hero * 1.5} style={{ fontFamily: font.displayBlack }}>
            {formatDuration(hold.goodMs)}
          </Display>
          <Body tone="muted" style={{ marginBottom: 16 }}>
            in good form
          </Body>
        </View>
        <View style={styles.formBar} accessible accessibilityLabel={`${pct} percent of the hold in good form`}>
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color.good }} />
        </View>
        <SetCalories exercise={exercise} activeMs={hold.totalMs} holdMs={hold.goodMs} reps={0} />
      </View>

      {sides && <SideBalance sides={sides} />}

      {note && <Mono tone="vial">{note}</Mono>}
      {demo ? (
        <Mono tone="muted">Demo set · not added to your history.</Mono>
      ) : (
        !saved && <Mono tone="cue">This plank could not be saved to history.</Mono>
      )}

      <View style={styles.stats}>
        <Stat size="lg" style={styles.stat} label="Good form" value={`${pct}%`} tone={pct >= 90 ? 'good' : pct >= 70 ? 'chalk' : 'cue'} />
        <Stat size="lg" style={styles.stat} label="Longest hold" value={formatDuration(hold.longestMs)} />
        <Stat size="lg" style={styles.stat} label="Breaks" value={String(hold.breaks)} tone={hold.breaks ? 'cue' : 'chalk'} />
        <Stat size="lg" style={styles.stat} label="Plank" value={hold.variant === 'forearm' ? 'Forearm' : 'High'} />
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
                  <Display size={type.displayM} tone="cue" style={{ minWidth: 64 }}>
                    {formatDuration(ms)}
                  </Display>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Strong>{HOLD_COPY[f].short}</Strong>
                    {guided && (
                      <Body tone="muted" size={type.note}>
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
                  <Display size={type.displayM} tone="muted" style={{ minWidth: 64 }}>
                    {formatDuration(hold.headDownMs)}
                  </Display>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Strong>{FAULT_COPY['head-dropping'].short}</Strong>
                    {guided && (
                      <Body tone="muted" size={type.note}>
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
function NextTime({
  faults,
  misses,
  cleanShare,
  exercise,
}: {
  faults: [RepFault, number][];
  misses: [MissReason, number][];
  cleanShare: number;
  exercise: Exercise;
}) {
  const topFault = faults.find(([f]) => !HINT_FAULTS.includes(f));
  const crunch = exercise === 'crunch';
  const tip = topFault
    ? `Most flagged reps were "${faultCopy(topFault[0], exercise).short.toLowerCase()}". ${faultCopy(topFault[0], exercise).detail}`
    : misses[0]
      ? `${missCopy(misses[0][0], exercise).detail} Those reps were not counted.`
      : cleanShare === 1
        ? crunch
          ? 'Every crunch was clean. Next time, try a few more, or pause a moment at the top of each one.'
          : 'Every rep was clean. Next time, try a few more or slow the way down to about two seconds.'
        : crunch
          ? 'Solid set. Curl up with your stomach, keep your feet down, and lower slowly.'
          : 'Solid set. Keep your body in one straight line from shoulders to heels.';
  return (
    <View style={styles.tip}>
      <Label tone="vial">Next time</Label>
      <Body>{tip}</Body>
    </View>
  );
}

/** A new best set, or the first set of an exercise: worth a moment. */
function PersonalBest({ exercise, id, value }: { exercise: Exercise; id: string; value: number }) {
  const [prev] = useState(() => bestBefore(exercise, id));
  if (value <= 0 || (prev !== null && value <= prev)) return null;
  const timed = isTimed(exercise);
  const text =
    prev === null
      ? `Your first ${EXERCISES[exercise].label.toLowerCase()} set is saved. This is the number to beat.`
      : `Up from ${timed ? formatDuration(prev) : prev}. That's a new best.`;
  return (
    <View style={styles.best} accessible accessibilityLabel={`${prev === null ? 'First set' : 'New personal best'}. ${text}`}>
      <Label tone="good">{prev === null ? 'First set' : 'New personal best'}</Label>
      <Body size={type.detail}>{text}</Body>
    </View>
  );
}

/**
 * "Count wrong? Fix it": the camera can miss or add a rep. The fix goes into
 * history and calories, never into screen time already earned.
 */
function FixCount({ total, onFix }: { total: number; onFix: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(total);
  if (!open) {
    return (
      <Pressable accessibilityRole="button" hitSlop={8} onPress={() => (setN(total), setOpen(true))} style={{ alignSelf: 'flex-start' }}>
        <Label tone="vial">Count wrong? Fix it ›</Label>
      </Pressable>
    );
  }
  return (
    <View style={styles.fix}>
      <Label>Reps you did</Label>
      <View style={styles.fixRow}>
        <Button label="−" variant="quiet" size="sm" onPress={() => setN((v) => Math.max(0, v - 1))} accessibilityLabel="One fewer rep" />
        <Display size={type.pageHero} accessibilityLiveRegion="polite">
          {n}
        </Display>
        <Button label="+" variant="quiet" size="sm" onPress={() => setN((v) => Math.min(500, v + 1))} accessibilityLabel="One more rep" />
      </View>
      <Body tone="muted" size={type.caption}>
        Fixing the count updates your history, best set and calories. Screen time already earned stays the same.
      </Body>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button
          label="Save"
          style={{ flex: 1 }}
          disabled={n === total}
          onPress={() => {
            onFix(n);
            setOpen(false);
          }}
        />
        <Button label="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setOpen(false)} />
      </View>
    </View>
  );
}

/**
 * A rest countdown after a fresh set: 60–90 s is plenty; going sooner is fine.
 * Counted from a deadline, so a phone that locks during the rest still shows
 * the right time when it wakes.
 */
function RestTimer({ seconds = 75 }: { seconds?: number }) {
  const [deadline] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  useEffect(() => {
    if (left <= 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [left, now]);
  return (
    <Mono tone={left > 0 ? 'muted' : 'good'} accessibilityLiveRegion={left === 0 ? 'polite' : 'none'}>
      {left > 0 ? `Rest ${formatDuration(left * 1000)} before the next set, or go when ready` : 'Rested. Ready for the next set.'}
    </Mono>
  );
}

/** Delete a saved set from history (asks first: it can't be undone). */
function DeleteSet({ id }: { id: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={12}
      style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}
      onPress={() =>
        Alert.alert(
          'Delete this set?',
          'It comes off your history, totals and best sets. Screen time it earned stays. This can’t be undone.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                deleteSession(id);
                router.dismissTo('/');
              },
            },
          ],
        )
      }
    >
      <Label tone="fault">Delete this set</Label>
    </Pressable>
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
        <Mono size={type.micro} tone="muted">
          rep 1
        </Mono>
        <Mono size={type.micro} tone="muted">{`${(max / 1000).toFixed(1)}s max`}</Mono>
        <Mono size={type.micro} tone="muted">{`rep ${reps.length}`}</Mono>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  best: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.goodSoft,
    borderWidth: 1,
    borderColor: color.good,
  },
  fix: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.lineSoft,
  },
  fixRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  earned: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: color.goodSoft,
  },
  page: { paddingHorizontal: space.xl, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  empty: { flex: 1, backgroundColor: color.ground, padding: space.xl, gap: space.lg },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg },
  stat: { flex: 0, width: '50%' },
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

/**
 * Side plank: each side, and whether they match. The McGill side-bridge test
 * treats left and right within about 5% of each other as balanced.
 */
function SideBalance({ sides }: { sides: NonNullable<SessionSummary['holdSides']> }) {
  const l = sides.left?.goodMs ?? 0;
  const r = sides.right?.goodMs ?? 0;
  const both = l > 0 && r > 0;
  const gap = both ? Math.abs(l - r) / Math.max(l, r) : 0;
  const weaker = l < r ? 'left' : 'right';
  const verdict = !both
    ? `Only the ${l > 0 ? 'left' : 'right'} side was timed. Do the other side next time to compare.`
    : gap <= 0.05
      ? 'Balanced: both sides within 5% of each other.'
      : `Your ${weaker} side held ${Math.round(gap * 100)}% less. Give it a little extra work.`;
  return (
    <View style={{ gap: space.md }}>
      <Label>Each side</Label>
      <View style={{ flexDirection: 'row', gap: space.lg }}>
        {(['left', 'right'] as const).map((s) => (
          <View key={s} style={{ flex: 1, gap: 4 }}>
            <Label>{s === 'left' ? 'Left side' : 'Right side'}</Label>
            <Display size={type.headline}>{sides[s] ? formatDuration(sides[s]!.goodMs) : '–'}</Display>
            {sides[s] && <Mono size={type.small} tone="muted">{`${Math.round(sides[s]!.formPct * 100)}% good form`}</Mono>}
          </View>
        ))}
      </View>
      <Body tone={both && gap > 0.05 ? 'chalk' : 'muted'}>{verdict}</Body>
    </View>
  );
}
