import { kgToLb, type Pace } from './energy';
import type { Units, Why } from '@/storage/profile';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "3 March", or "3 March 2027" when not this year. */
export function dayMonth(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const y = d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${y}`;
}

/** A weight in the user's units, e.g. "72.5 kg" or "160 lb". */
export function weight(kg: number, units: Units, withUnit = true): string {
  const v = units === 'imperial' ? String(Math.round(kgToLb(kg))) : (Math.round(kg * 10) / 10).toString();
  return withUnit ? `${v} ${units === 'imperial' ? 'lb' : 'kg'}` : v;
}

export const kcal = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function paceLabel(pace: Pace, units: Units): string {
  return units === 'imperial' ? `${(Math.round(kgToLb(pace) * 4) / 4).toString()} lb a week` : `${pace} kg a week`;
}

/**
 * Calories for display: rounded, never decimals, with the honest range when
 * there is one ("≈4 kcal (3–6)", "under 1 kcal").
 */
export function kcalText(k: number | { kcal: number; low: number; high: number }, withRange = true): string {
  const v = typeof k === 'number' ? k : k.kcal;
  if (v < 1) return 'under 1 kcal';
  if (typeof k === 'number' || !withRange) return `≈${kcal(v)} kcal`;
  const lo = Math.max(0, Math.round(k.low));
  const hi = Math.max(lo, Math.round(k.high));
  return lo === hi ? `≈${kcal(v)} kcal` : `≈${kcal(v)} kcal (${kcal(lo)}–${kcal(hi)})`;
}

export const WHY_LABELS: Record<Why, string> = {
  energy: 'More energy',
  health: 'Better health',
  confidence: 'Feel confident',
  sport: 'For my sport',
  mood: 'Better mood',
  focus: 'Better focus',
};
