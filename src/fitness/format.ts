import { kgToLb, type Pace } from './energy';
import type { Units } from '@/storage/profile';

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
