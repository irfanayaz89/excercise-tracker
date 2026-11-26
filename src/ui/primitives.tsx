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
      // Headlines follow the phone's text size (up to 1.3×); big numerals are already as large as fits.
      maxFontSizeMultiplier={size >= 60 ? 1 : 1.3}
      style={[
        { fontFamily: font.display, fontSize: size, lineHeight: Math.round(size * 1.08), color: toneColor[tone], letterSpacing: 0.5 },
        style,
      ]}
      {...rest}
    />
  );
}

/**
 * How far text follows the phone's text size. Body copy grows up to 2× (the largest accessibility
 * sizes stay readable without one word per line); small letter-spaced labels up to 1.5×, past
 * which they no longer fit beside what they label.
 */
const BODY_SCALE = 2;
/** "Step-by-step guide ›": the arrow is for the eye; screen readers say the words only. */
const spoken = (rest: TProps) =>
  rest.accessibilityLabel ??
  (typeof rest.children === 'string' && rest.children.endsWith('›') ? rest.children.slice(0, -1).trim() : undefined);
const LABEL_SCALE = 1.5;

export function Body({ tone = 'chalk', size = type.body, style, ...rest }: TProps) {
  return (
    <Text
      accessibilityLabel={spoken(rest)}
      maxFontSizeMultiplier={BODY_SCALE}
      style={[{ fontFamily: font.body, fontSize: size, lineHeight: size * 1.45, color: toneColor[tone] }, style]}
      {...rest}
    />
  );
}

export function Strong({ tone = 'chalk', size = type.body, style, ...rest }: TProps) {
  return (
    <Text
      accessibilityLabel={spoken(rest)}
      maxFontSizeMultiplier={BODY_SCALE}
      style={[{ fontFamily: font.bodySemi, fontSize: size, lineHeight: size * 1.35, color: toneColor[tone] }, style]}
      {...rest}
    />
  );
}

/** Uppercase utility label, monospaced, letter-spaced. */
export function Label({ tone = 'muted', size = type.micro, style, ...rest }: TProps) {
  return (
    <Text
      accessibilityLabel={spoken(rest)}
      maxFontSizeMultiplier={LABEL_SCALE}
      style={[{ fontFamily: font.monoMed, fontSize: size, letterSpacing: 1.4, textTransform: 'uppercase', color: toneColor[tone] }, style]}
      {...rest}
    />
  );
}

/**
 * A tappable text link: sentence case in the brand yellow, so it reads as an action and not as
 * one of the uppercase section labels. Goes inside a Pressable that carries the role.
 */
export function LinkText({ tone = 'vial', size = type.detail, style, ...rest }: TProps) {
  return (
    <Text
      accessibilityLabel={spoken(rest)}
      maxFontSizeMultiplier={BODY_SCALE}
      style={[{ fontFamily: font.bodySemi, fontSize: size, lineHeight: size * 1.35, color: toneColor[tone] }, style]}
      {...rest}
    />
  );
}

export function Mono({ tone = 'chalk', size = type.caption, style, ...rest }: TProps) {
  return (
    <Text
      maxFontSizeMultiplier={LABEL_SCALE}
      style={[{ fontFamily: font.mono, fontSize: size, color: toneColor[tone], fontVariant: ['tabular-nums'] }, style]}
      {...rest}
    />
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
  // Minimum heights, so larger text grows the button instead of clipping; never under 44 pt to tap.
  const h = size === 'lg' ? 64 : size === 'md' ? 52 : 44;
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
          minHeight: h,
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
        // Big condensed button text follows headlines (1.3×), or a full-width button fills the screen.
        maxFontSizeMultiplier={size === 'lg' ? 1.3 : BODY_SCALE}
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

/**
 * A choice. One of a set ("radio button, selected") unless `multi`, where several can be on
 * ("checkbox, checked").
 */
export function Chip({
  label,
  selected,
  onPress,
  multi = false,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  multi?: boolean;
  /** When the chip's short text needs a fuller name for screen readers. */
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && { opacity: 0.8 }]}
    >
      <Text
        maxFontSizeMultiplier={LABEL_SCALE}
        style={{ fontFamily: font.monoMed, fontSize: type.note, color: selected ? color.vialInk : color.chalk2 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A labelled number. "sm": a quiet figure in a card (Earned left, Used today). "lg": a headline
 * figure (Best set, Avg rep).
 */
export function Stat({
  label,
  value,
  size = 'sm',
  tone = 'chalk',
  style,
}: {
  label: string;
  value: string;
  size?: 'sm' | 'lg';
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flex: 1, gap: size === 'lg' ? 4 : 2 }, style]} accessible accessibilityLabel={`${label}: ${value}`}>
      {size === 'lg' ? (
        <Label>{label}</Label>
      ) : (
        <Mono size={type.micro} tone="muted">
          {label}
        </Mono>
      )}
      {size === 'lg' ? (
        <Display size={type.stat} tone={tone}>
          {value}
        </Display>
      ) : (
        <Strong size={type.callout} tone={tone}>
          {value}
        </Strong>
      )}
    </View>
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
    paddingVertical: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  chip: {
    minWidth: 52,
    minHeight: 44,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: color.vial, borderColor: color.vial },
});
