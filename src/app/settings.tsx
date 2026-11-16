import { router, useFocusEffect } from 'expo-router';
import type { File } from 'expo-file-system';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteRecording, listRecordings, shareRecording } from '@/session/recordings';
import type { Difficulty } from '@/engine/difficulty';
import type { PhoneOrientation } from '@/engine/types';
import { useSettings, type Experience, type Settings } from '@/storage/settings';
import { Body, Chip, Display, Label, Mono, Rule, Strong } from '@/ui/primitives';
import { color, radius, space } from '@/ui/theme';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [s, update] = useSettings();
  const [recs, setRecs] = useState<File[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setRecs(listRecordings());
    }, []),
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.ground }}
      contentContainerStyle={[styles.page, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.huge }]}
    >
      <View style={styles.header}>
        <Display size={36}>Settings</Display>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
          <Label tone="chalk">Done</Label>
        </Pressable>
      </View>

      <Section title="Your set">
        <ChoiceRow
          label="Help level"
          hint="Guided explains each step, shows a setup guide before every set and speaks full instructions. Quick keeps screens and cues short."
          value={s.experience ?? 'guided'}
          options={[
            ['guided', 'Guided'],
            ['quick', 'Quick'],
          ]}
          onChange={(v) => update({ experience: v as Experience })}
        />
        <ChoiceRow
          label="Difficulty"
          hint="Easy just counts push-ups with a relaxed setup. Medium adds main form checks. Hard is the strict standard."
          value={s.difficulty}
          options={[
            ['easy', 'Easy'],
            ['medium', 'Medium'],
            ['hard', 'Hard'],
          ]}
          onChange={(v) => update({ difficulty: v as Difficulty })}
        />
        <ChoiceRow
          label="Phone orientation"
          hint="Landscape: 1.5–2 m away, fits your body best. Portrait: 2.5–3 m away, for tight spots or if your phone stand only holds it upright."
          value={s.orientation}
          options={[
            ['landscape', 'Landscape'],
            ['portrait', 'Portrait'],
          ]}
          onChange={(v) => update({ orientation: v as PhoneOrientation })}
        />
      </Section>

      <Section title="Camera">
        <ChoiceRow
          label="Which camera"
          hint="Front lets you glance at the screen. Back is sharper in low light."
          value={s.camera}
          options={[
            ['front', 'Front'],
            ['back', 'Back'],
          ]}
          onChange={(v) => update({ camera: v as Settings['camera'] })}
        />
        <ChoiceRow
          label="Tracking model"
          hint="Auto uses the accurate model and switches to the light one if your phone is too slow."
          value={s.model}
          options={[
            ['auto', 'Auto'],
            ['full', 'Accurate'],
            ['lite', 'Light'],
          ]}
          onChange={(v) => update({ model: v as Settings['model'] })}
        />
      </Section>

      <Section title="Coaching">
        <ToggleRow
          label="Voice coach"
          hint="Spoken cues. The phone is 2 m away, so this is how feedback reaches you."
          value={s.voice}
          onChange={(v) => update({ voice: v })}
        />
        <ToggleRow
          label="Count out loud"
          hint="Say the number after every rep."
          value={s.countAloud}
          disabled={!s.voice}
          onChange={(v) => update({ countAloud: v })}
        />
        <ToggleRow
          label="Allow knee push-ups"
          hint="Count reps done from the knees instead of asking you to straighten your legs."
          value={s.allowKneeling}
          onChange={(v) => update({ allowKneeling: v })}
        />
      </Section>

      <Section title="Tuning">
        <ToggleRow
          label="Show tracking details"
          hint="Frame rate, model speed and live joint angles on the set screen."
          value={s.showTracking}
          onChange={(v) => update({ showTracking: v })}
        />
        <ToggleRow
          label="Record sets for tuning"
          hint="Saves body points (never video) from each set so miscounts can be replayed and fixed."
          value={s.recordForTuning}
          onChange={(v) => update({ recordForTuning: v })}
        />
        {recs.length > 0 && (
          <View style={styles.recs}>
            {recs.slice(0, 20).map((f, i) => (
              <View key={f.uri}>
                {i > 0 && <Rule />}
                <View style={styles.recRow}>
                  <Mono size={12} style={{ flex: 1 }} numberOfLines={1}>
                    {f.name.replace('set-', '').replace('.json', '')}
                  </Mono>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Share recording ${f.name}`}
                    hitSlop={8}
                    onPress={() => void shareRecording(f)}
                  >
                    <Label tone="vial">Share</Label>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={pendingDelete === f.uri ? `Confirm delete recording ${f.name}` : `Delete recording ${f.name}`}
                    hitSlop={8}
                    onPress={() => {
                      if (pendingDelete !== f.uri) {
                        setPendingDelete(f.uri);
                        return;
                      }
                      deleteRecording(f);
                      setPendingDelete(null);
                      setRecs(listRecordings());
                    }}
                  >
                    <Label tone={pendingDelete === f.uri ? 'fault' : 'muted'}>{pendingDelete === f.uri ? 'Tap to delete' : 'Delete'}</Label>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
      </Section>

      <Body tone="faint" size={13}>
        Video is processed on this phone and never stored or uploaded.
      </Body>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.md }}>
      <Label tone="vial">{title}</Label>
      <View style={styles.section}>{children}</View>
    </View>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, disabled && { opacity: 0.45 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Strong>{label}</Strong>
        <Body tone="muted" size={13}>
          {hint}
        </Body>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: color.raised, true: color.vial }}
        thumbColor={value ? color.vialInk : color.chalk2}
        accessibilityLabel={label}
      />
    </View>
  );
}

function ChoiceRow({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch' }]}>
      <Strong>{label}</Strong>
      <Body tone="muted" size={13}>
        {hint}
      </Body>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' }}>
        {options.map(([v, l]) => (
          <Chip key={v} label={l} selected={value === v} onPress={() => onChange(v)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl, gap: space.xxl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { borderRadius: radius.lg, borderWidth: 1, borderColor: color.lineSoft, backgroundColor: color.surface, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  recs: { margin: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: color.line },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: space.md, paddingVertical: space.sm },
});
