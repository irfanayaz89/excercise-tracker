import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { changeRules, countLabel, describeChange, editBase, pickApps, selectionProblem } from '@/screentime/edit';
import { appLimitProblem, EMPTY_SELECTION, MAX_APP_LIMITS } from '@/screentime/rules';
import { getScreenTime } from '@/screentime/store';
import type { AppLimit } from '@/screentime/types';
import { Body, Button, Chip, Display, Label } from '@/ui/primitives';
import { Section, ToggleRow } from '@/ui/rows';
import { color, font, radius, space, type } from '@/ui/theme';
import { useTapGuard } from '@/ui/useTapGuard';

const MINUTES: [number | null, string][] = [
  [null, 'No time limit'],
  [10, '10 min'],
  [20, '20 min'],
  [30, '30 min'],
  [45, '45 min'],
  [60, '1 h'],
  [90, '1.5 h'],
];
const OPENS: [number | null, string][] = [
  [null, 'Any number'],
  [3, '3'],
  [5, '5'],
  [10, '10'],
  [20, '20'],
];

const PROBLEM: Record<NonNullable<ReturnType<typeof appLimitProblem>>, string> = {
  'no-apps': 'Pick the apps this limit is for.',
  'no-limit': Platform.OS === 'ios' ? 'Pick a time limit.' : 'Pick a time limit, a number of opens, or both.',
};

/**
 * Add or edit a per-app limit: which apps, how many minutes a day and (Android) how many opens.
 * Changes follow the strictness rules like any other: making a limit easier waits.
 */
export default function AppLimitEditor() {
  const insets = useSafeAreaInsets();
  const guard = useTapGuard();
  const { id } = useLocalSearchParams<{ id: string }>();
  const existing = getScreenTime().rules.appLimits.find((l) => l.id === id) ?? null;
  const isNew = !existing;
  const [limit, setLimit] = useState<AppLimit>(
    () =>
      existing ?? {
        id: `limit-${Date.now().toString(36)}`,
        name: '',
        apps: EMPTY_SELECTION,
        dailyMin: 20,
        opensPerDay: null,
        enabled: true,
      },
  );
  const [message, setMessage] = useState<string | null>(null);
  const set = (patch: Partial<AppLimit>) => setLimit((l) => ({ ...l, ...patch }));
  const problem = appLimitProblem(limit);

  const commit = (appLimits: AppLimit[]) => {
    const res = changeRules({ ...editBase(), appLimits });
    if (res.result === 'applied') router.back();
    else setMessage(describeChange(res));
  };

  const save = () => {
    const rules = getScreenTime().rules;
    if (isNew && rules.appLimits.length >= MAX_APP_LIMITS) return setMessage(`Up to ${MAX_APP_LIMITS} app limits.`);
    const named = { ...limit, name: limit.name.trim() || 'App limit' };
    commit(isNew ? [...rules.appLimits, named] : rules.appLimits.map((l) => (l.id === limit.id ? named : l)));
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.huge }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Display size={type.displayM}>{isNew ? 'New app limit' : limit.name || 'App limit'}</Display>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
          <Label tone="chalk">Cancel</Label>
        </Pressable>
      </View>

      <Section title="Apps">
        <View style={styles.pad}>
          <Body tone="muted" size={type.caption}>
            {countLabel(limit.apps) === 'None picked'
              ? 'One app or a group, like Instagram, or Instagram and TikTok together.'
              : countLabel(limit.apps)}
          </Body>
          <Button
            size="sm"
            variant="ghost"
            label="Pick apps"
            onPress={guard(async () => {
              const picked = await pickApps(limit.name || 'App limit', limit.apps);
              if (!picked) return;
              const bad = selectionProblem(picked);
              if (bad) setMessage(bad);
              else set({ apps: picked });
            })}
          />
        </View>
      </Section>

      <Section title="Name">
        <TextInput
          value={limit.name}
          onChangeText={(name) => set({ name: name.slice(0, 30) })}
          placeholder="Instagram, Videos, Games…"
          placeholderTextColor={color.faint}
          style={styles.input}
          accessibilityLabel="Name"
        />
      </Section>

      <Section title="Time a day">
        <View style={styles.pad}>
          <View style={styles.chips}>
            {MINUTES.map(([v, l]) => (
              <Chip key={l} label={l} selected={limit.dailyMin === v} onPress={() => set({ dailyMin: v })} />
            ))}
          </View>
          <Body tone="muted" size={type.caption}>
            {Platform.OS === 'ios'
              ? 'iPhone counts this itself and can be a few minutes off either way, so treat it as approximate.'
              : 'Counted to the second while the apps are on screen.'}
          </Body>
        </View>
      </Section>

      {Platform.OS === 'android' && (
        <Section title="Opens a day">
          <View style={styles.pad}>
            <View style={styles.chips}>
              {OPENS.map(([v, l]) => (
                <Chip key={l} label={l} selected={limit.opensPerDay === v} onPress={() => set({ opensPerDay: v })} />
              ))}
            </View>
            <Body tone="muted" size={type.caption}>
              Each time you open one of these apps counts. Once they’re used up, the next open is blocked until tomorrow.
            </Body>
          </View>
        </Section>
      )}

      {!isNew && (
        <Section title="On or off">
          <ToggleRow
            label="Limit on"
            hint="Switching it off counts as making things easier."
            value={limit.enabled}
            onChange={(enabled) => set({ enabled })}
          />
        </Section>
      )}

      {(message || problem) && (
        <View style={styles.note} accessibilityLiveRegion="polite">
          <Body size={type.note}>{message ?? (problem ? PROBLEM[problem] : '')}</Body>
        </View>
      )}

      <View style={{ gap: space.md }}>
        <Button label={isNew ? 'Add limit' : 'Save'} disabled={!!problem} onPress={save} />
        {!isNew && (
          <Button
            variant="danger"
            label="Delete"
            onPress={() =>
              Alert.alert('Delete this app limit?', 'These apps go back to the main rules.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => commit(editBase().appLimits.filter((l) => l.id !== limit.id)) },
              ])
            }
          />
        )}
      </View>
    </ScrollView>
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
  note: { padding: space.lg, borderRadius: radius.lg, backgroundColor: color.raised },
});
