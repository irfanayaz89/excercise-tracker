import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Body, Chip, Label, Strong } from './primitives';
import { color, radius, space } from './theme';

/** Grouped rows used by Settings and the Screen Time screens. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.md }}>
      <Label tone="vial">{title}</Label>
      <View style={styles.section}>{children}</View>
    </View>
  );
}

export function ToggleRow({
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

export function ChoiceRow({
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

/** A row that opens something: label, hint and a value on the right. */
export function LinkRow({ label, hint, value, onPress, disabled }: { label: string; hint?: string; value?: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, disabled && { opacity: 0.45 }, pressed && { backgroundColor: color.raised }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Strong>{label}</Strong>
        {hint ? (
          <Body tone="muted" size={13}>
            {hint}
          </Body>
        ) : null}
      </View>
      {value ? (
        <Body tone="muted" size={14}>
          {value}
        </Body>
      ) : null}
      <Label tone="muted">›</Label>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: radius.lg, borderWidth: 1, borderColor: color.lineSoft, backgroundColor: color.surface, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
});
