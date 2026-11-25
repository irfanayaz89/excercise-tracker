import { type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { color, font, radius, space, type } from './theme';

type Tone = 'chalk' | 'chalk2' | 'muted' | 'faint' | 'vial' | 'good' | 'cue' | 'fault' | 'ink';

const toneColor: Record<Tone, string> = {
  chalk: color.chalk,
  chalk2: color.chalk2,
  muted: color.muted,
  faint: color.faint,
  vial: color.vial,
  good: color.good,
  cue: color.cue,
  fault: color.fault,
  ink: color.vialInk,
};

interface TProps extends TextProps {
  tone?: Tone;
  size?: number;
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
}

/** Condensed display face for numbers and headlines. */
export function Display({ tone = 'chalk', size = type.headline, style, ...rest }: TProps) {
  return (
    <Text
      allowFontScaling={false}
      style={[{ fontFamily: font.display, fontSize: size, lineHeight: Math.round(size * 1.08), color: toneColor[tone], letterSpacing: 0.5 }, style]}
      {...rest}
    />
  );
}

export function Body({ tone = 'chalk', size = type.body, style, ...rest }: TProps) {
  return <Text style={[{ fontFamily: font.body, fontSize: size, lineHeight: size * 1.45, color: toneColor[tone] }, style]} {...rest} />;
}

export function Strong({ tone = 'chalk', size = type.body, style, ...rest }: TProps) {
  return <Text style={[{ fontFamily: font.bodySemi, fontSize: size, lineHeight: size * 1.35, color: toneColor[tone] }, style]} {...rest} />;
}

/** Uppercase utility label, monospaced, letter-spaced. */
export function Label({ tone = 'muted', size = type.micro, style, ...rest }: TProps) {
  return (
    <Text
      style={[{ fontFamily: font.monoMed, fontSize: size, letterSpacing: 1.4, textTransform: 'uppercase', color: toneColor[tone] }, style]}
      {...rest}
    />
  );
}

export function Mono({ tone = 'chalk', size = type.caption, style, ...rest }: TProps) {
  return (
    <Text style={[{ fontFamily: font.mono, fontSize: size, color: toneColor[tone], fontVariant: ['tabular-nums'] }, style]} {...rest} />
  );
}

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: 'vial' | 'ghost' | 'quiet' | 'danger';
  size?: 'lg' | 'md' | 'sm';
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, variant = 'vial', size = 'md', icon, style, disabled, ...rest }: ButtonProps) {
  const h = size === 'lg' ? 64 : size === 'md' ? 52 : 40;
  const bg = variant === 'vial' ? color.vial : variant === 'danger' ? color.faultSoft : variant === 'ghost' ? 'transparent' : color.raised;
  const fg = variant === 'vial' ? color.vialInk : variant === 'danger' ? color.fault : color.chalk;
  const border = variant === 'ghost' ? color.line : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        {
          height: h,
          backgroundColor: bg,
          borderColor: border,
          opacity: disabled ? 0.4 : pressed ? 0.82 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        style,
      ]}
      {...rest}
    >
      {icon}
      <Text
        style={{
          fontFamily: size === 'lg' ? font.display : font.bodySemi,
          fontSize: size === 'lg' ? 26 : size === 'md' ? 16 : 14,
          color: fg,
          letterSpacing: size === 'lg' ? 1 : 0.2,
          textTransform: size === 'lg' ? 'uppercase' : 'none',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Selectable chip used for targets and settings. */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && { opacity: 0.8 }]}
    >
      <Text style={{ fontFamily: font.monoMed, fontSize: 14, color: selected ? color.vialInk : color.chalk2 }}>{label}</Text>
    </Pressable>
  );
}

export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: color.line }, style]} />;
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  chip: {
    minWidth: 52,
    height: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: color.vial, borderColor: color.vial },
});
