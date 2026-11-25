import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Label } from './primitives';
import { color, font, radius, space } from './theme';

/**
 * A number you can type or nudge with − and +. The typed text is kept while
 * editing and only checked (and kept within range) when the field is left.
 */
export function NumberField({
  label,
  value,
  onChange,
  unit,
  step = 1,
  min,
  max,
  decimals = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  min: number;
  max: number;
  decimals?: number;
}) {
  const show = (v: number) => (decimals ? v.toFixed(decimals).replace(/\.0+$/, '') : String(Math.round(v)));
  // While typing, the field shows exactly what was typed; otherwise the value.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? show(value);

  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 10 ** decimals) / 10 ** decimals));
  const commit = () => {
    const v = Number(text.replace(',', '.'));
    const next = Number.isFinite(v) && text.trim() !== '' ? clamp(v) : value;
    setDraft(null);
    onChange(next);
  };
  // Pass on in-range values while typing, so a button tapped before the field
  // is left (e.g. Save) already has the new number.
  const type = (t: string) => {
    setDraft(t);
    const v = Number(t.replace(',', '.'));
    if (t.trim() !== '' && Number.isFinite(v) && v >= min && v <= max) onChange(clamp(v));
  };
  const nudge = (d: number) => {
    const next = clamp(value + d);
    if (next !== value) void Haptics.selectionAsync();
    onChange(next);
  };

  return (
    <View style={styles.wrap}>
      <Label>{label}</Label>
      <View style={styles.row}>
        <Step label="−" a11y={`Less ${label.toLowerCase()}`} onPress={() => nudge(-step)} disabled={value <= min} />
        <View style={styles.valueBox}>
          <TextInput
            accessibilityLabel={`${label}${unit ? `, ${unit}` : ''}`}
            value={text}
            onChangeText={type}
            onFocus={() => setDraft(show(value))}
            onBlur={commit}
            onSubmitEditing={commit}
            keyboardType={decimals ? 'decimal-pad' : 'number-pad'}
            returnKeyType="done"
            selectTextOnFocus
            maxLength={6}
            style={styles.input}
          />
          {unit && <Text style={styles.unit}>{unit}</Text>}
        </View>
        <Step label="+" a11y={`More ${label.toLowerCase()}`} onPress={() => nudge(step)} disabled={value >= max} />
      </View>
    </View>
  );
}

function Step({ label, a11y, onPress, disabled }: { label: string; a11y: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.step, { opacity: disabled ? 0.35 : pressed ? 0.7 : 1 }]}
    >
      <Text style={styles.stepText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm, flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 60,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.lineSoft,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  valueBox: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', paddingTop: 8, gap: 4 },
  input: {
    fontFamily: font.display,
    fontSize: 34,
    color: color.chalk,
    minWidth: 36,
    textAlign: 'center',
    padding: 0,
    fontVariant: ['tabular-nums'],
  },
  unit: { fontFamily: font.mono, fontSize: 13, color: color.muted },
  step: { width: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: color.raised },
  stepText: { fontFamily: font.display, fontSize: 28, color: color.chalk },
});
