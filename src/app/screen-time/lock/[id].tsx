import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { changeRules, countLabel, describeChange, editBase, pickApps, selectionProblem } from '@/screentime/edit';
import { describeLock, EMPTY_SELECTION, LOCK_PRESETS, lockProblem, MAX_LOCK_TIMES } from '@/screentime/rules';
import { getScreenTime } from '@/screentime/store';
import { lockLengthMin, parseHHMM } from '@/screentime/time';
import { formatMin } from '@/screentime/summary';
import type { LockTime } from '@/screentime/types';
import { Body, Button, Chip, Display, Label, Mono, Strong } from '@/ui/primitives';
import { Section } from '@/ui/rows';
import { color, font, radius, space, type } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';
import { earnableHere } from '@/screentime/decide';

const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PROBLEM: Record<NonNullable<ReturnType<typeof lockProblem>>, string> = {
  'no-days': 'Pick at least one day.',
  'bad-time': 'Start and end must be different times.',
  'too-short': 'A lock time needs at least 15 minutes.',
};

const hhmm = (m: number) => {
  const x = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

/** Add or edit a lock time (plan §2): name, days, start and end, which apps, and whether earned time works during it. */
export default function LockEditor() {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const { id } = useLocalSearchParams<{ id: string }>();
  const existing = getScreenTime().rules.lockTimes.find((l) => l.id === id) ?? null;
  const isNew = !existing;
  const [lock, setLock] = useState<LockTime>(() => existing ?? { id: `lock-${Date.now().toString(36)}`, ...LOCK_PRESETS[0] });
  const [message, setMessage] = useState<string | null>(null);
  const problem = lockProblem(lock);
  // iPhone can't count time across all apps (decide.ts earnableHere).
  const noEarnHere = lock.apps === 'all' && !earnableHere({ earnable: true, apps: 'all' });
  const len = lockLengthMin(lock);
  const set = (patch: Partial<LockTime>) => setLock((l) => ({ ...l, ...patch }));

  const save = () => {
    const rules = getScreenTime().rules;
    if (isNew && rules.lockTimes.length >= MAX_LOCK_TIMES) return setMessage(`Up to ${MAX_LOCK_TIMES} lock times.`);
    const lockTimes = isNew ? [...rules.lockTimes, lock] : rules.lockTimes.map((l) => (l.id === lock.id ? lock : l));
    const res = changeRules({ ...editBase(), lockTimes });
    if (res.result === 'applied') router.back();
    else setMessage(describeChange(res));
  };

  const remove = () => {
    const res = changeRules({ ...editBase(), lockTimes: editBase().lockTimes.filter((l) => l.id !== lock.id) });
    if (res.result === 'applied') router.back();
    else setMessage(describeChange(res));
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.huge }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Display size={type.displayM}>{isNew ? 'New lock time' : lock.name || 'Lock time'}</Display>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
          <Label tone="chalk">Cancel</Label>
        </Pressable>
      </View>

      {isNew && (
        <View style={{ gap: space.sm }}>
          <Label>Start from</Label>
          <View style={styles.chips}>
            {LOCK_PRESETS.map((p) => (
              <Chip key={p.name} label={p.name} selected={lock.name === p.name} onPress={() => setLock((l) => ({ ...l, ...p }))} />
            ))}
          </View>
        </View>
      )}

      <Section title="Name">
        <TextInput
          value={lock.name}
          onChangeText={(name) => set({ name: name.slice(0, 30) })}
          placeholder="Sleep, Study, Family dinner…"
          placeholderTextColor={color.faint}
          style={styles.input}
          accessibilityLabel="Name"
        />
      </Section>

      <Section title="When">
        <View style={styles.pad}>
          <View style={styles.days} accessibilityRole="none">
            {DAY_NAMES.map((n, d) => {
              const on = lock.days.includes(d);
              return (
                <Pressable
                  key={d}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={DAY_FULL[d]}
                  onPress={() => set({ days: on ? lock.days.filter((x) => x !== d) : [...lock.days, d].sort() })}
                  // Seven 44 pt circles don't fit a small phone: the touch area grows instead.
                  hitSlop={4}
                  style={[styles.day, on && styles.dayOn]}
                >
                  <Mono size={type.note} tone={on ? 'ink' : 'muted'}>
                    {n}
                  </Mono>
                </Pressable>
              );
            })}
          </View>
          <TimeField label="Starts" value={lock.start} onChange={(start) => set({ start })} />
          <TimeField label="Ends" value={lock.end} onChange={(end) => set({ end })} />
          <Body tone={problem ? 'cue' : 'muted'} size={type.caption}>
            {problem
              ? PROBLEM[problem]
              : `${describeLock(lock)} · ${formatMin(len ?? 0)}${(parseHHMM(lock.end) ?? 0) <= (parseHHMM(lock.start) ?? 0) ? ' (ends the next day)' : ''}`}
          </Body>
        </View>
      </Section>

      <Section title="Apps">
        <View style={styles.pad}>
          <View style={styles.chips}>
            <Chip label="My blocked apps" selected={lock.apps === 'main'} onPress={() => set({ apps: 'main' })} />
            <Chip label="Everything" selected={lock.apps === 'all'} onPress={() => set({ apps: 'all' })} />
            <Chip
              label="Its own list"
              selected={lock.apps !== 'main' && lock.apps !== 'all'}
              onPress={() => (lock.apps === 'main' || lock.apps === 'all' ? set({ apps: EMPTY_SELECTION }) : undefined)}
            />
          </View>
          <Body tone="muted" size={type.caption}>
            {lock.apps === 'main'
              ? 'Locks the same apps as the daily limit.'
              : lock.apps === 'all'
                ? 'Locks every app except your always-allowed ones (and what the phone needs, like calls).'
                : `Locks its own list: ${countLabel(lock.apps)}.`}
          </Body>
          {lock.apps !== 'main' && lock.apps !== 'all' && (
            <Button
              size="sm"
              variant="ghost"
              label="Pick apps for this lock time"
              onPress={guard(async () => {
                const current = lock.apps === 'main' || lock.apps === 'all' ? EMPTY_SELECTION : lock.apps;
                const picked = await pickApps(lock.name || 'Lock time', current);
                if (!picked) return;
                const bad = selectionProblem(picked);
                if (bad) setMessage(bad);
                else set({ apps: picked });
              })}
            />
          )}
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <Strong>Earned time works</Strong>
            <Body tone="muted" size={type.caption}>
              {noEarnHere
                ? "On iPhone, earned time can't open an Everything lock: iOS can only count time in apps you pick."
                : lock.earnable
                  ? 'Earned minutes can open the apps during this time.'
                  : 'Fully locked: not even earned time opens them.'}
            </Body>
          </View>
          <Switch
            value={lock.earnable && !noEarnHere}
            disabled={noEarnHere}
            onValueChange={(earnable) => set({ earnable })}
            trackColor={{ false: color.raised, true: color.vial }}
            thumbColor={lock.earnable ? color.vialInk : color.chalk2}
            accessibilityLabel="Earned time works"
          />
        </View>
      </Section>

      {message && (
        <View style={styles.note} accessibilityLiveRegion="polite">
          <Body size={type.note}>{message}</Body>
        </View>
      )}

      <View style={{ gap: space.md }}>
        <Button
          label={isNew ? 'Add lock time' : 'Save'}
          disabled={
            !!problem || !lock.name.trim() || (lock.apps !== 'main' && lock.apps !== 'all' && countLabel(lock.apps) === 'None picked')
          }
          onPress={save}
        />
        {!isNew && (
          <Button
            variant="danger"
            label="Delete"
            onPress={() =>
              Alert.alert('Delete this lock time?', 'It stops blocking at these times.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: remove },
              ])
            }
          />
        )}
      </View>
    </ScrollView>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const m = parseHHMM(value) ?? 0;
  const step = (d: number) => onChange(hhmm(m + d));
  return (
    <View
      style={styles.time}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`${label} ${value}`}
      accessibilityHint="Swipe up or down to change by 15 minutes"
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 15 : -15)}
    >
      <Body size={type.note} style={{ width: 56 }}>
        {label}
      </Body>
      <StepButton label="−1h" onPress={() => step(-60)} />
      <StepButton label="−15" onPress={() => step(-15)} />
      <Display size={type.displayM} style={{ flex: 1, textAlign: 'center', fontFamily: font.displayMed }}>
        {value}
      </Display>
      <StepButton label="+15" onPress={() => step(15)} />
      <StepButton label="+1h" onPress={() => step(60)} />
    </View>
  );
}

function StepButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.step, pressed && { opacity: 0.7 }]}
    >
      <Mono size={type.small}>{label}</Mono>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    rowGap: space.xs,
    alignItems: 'center',
    gap: space.md,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pad: { padding: space.lg, gap: space.md },
  input: { padding: space.lg, color: color.chalk, fontFamily: font.body, fontSize: 17 },
  days: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: color.line, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: color.vial, borderColor: color.vial },
  time: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  step: {
    paddingHorizontal: space.sm,
    minHeight: 44,
    minWidth: 44,
    borderRadius: radius.sm,
    backgroundColor: color.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  note: { padding: space.lg, borderRadius: radius.lg, backgroundColor: color.raised },
});
