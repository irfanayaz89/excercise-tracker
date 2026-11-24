/// <reference types="jest" />
import {
  bmi,
  bmr,
  eventualChangeKg,
  fatGrams,
  ftInToCm,
  lowestHealthyKg,
  maintenance,
  metFor,
  netKcal,
  strengthFuel,
  weightPlan,
  type Body,
} from '../energy';

const man: Body = { sex: 'male', age: 30, heightCm: 180, weightKg: 80, activity: 'low' };
const woman: Body = { sex: 'female', age: 30, heightCm: 165, weightKg: 65, activity: 'some' };

describe('energy', () => {
  test('Mifflin–St Jeor matches worked examples', () => {
    // 10×80 + 6.25×180 − 5×30 + 5 = 1780
    expect(bmr(man)).toBe(1780);
    // 10×65 + 6.25×165 − 150 − 161 = 1370.25
    expect(bmr(woman)).toBeCloseTo(1370.25, 2);
    // Unspecified sits between the two.
    expect(bmr({ ...man, sex: 'unspecified' })).toBe(1780 - 83);
    expect(maintenance(man)).toBeCloseTo(2136, 0);
  });

  test('net calories from the 2024 Compendium METs', () => {
    expect(metFor('pushup')).toBe(7.5);
    expect(metFor('pullup', 12)).toBe(7.5);
    expect(metFor('pushup', 5)).toBe(3.8);
    expect(metFor('plank')).toBe(2.8);
    // 2 minutes of push-ups at 80 kg: (7.5 − 1) × 3.5 × 80 × 2 / 200 = 18.2 kcal
    expect(netKcal('pushup', 120_000, 80, 40)).toBeCloseTo(18.2, 5);
    // 1 minute of plank at 65 kg: 1.8 × 3.5 × 65 / 200 = 2.05 kcal
    expect(netKcal('plank', 60_000, 65)).toBeCloseTo(2.0475, 4);
    expect(netKcal('pushup', 0, 80)).toBe(0);
  });

  test('BMI bands and the lowest healthy target', () => {
    expect(bmi(180, 80).value).toBeCloseTo(24.69, 2);
    expect(bmi(180, 80).band).toBe('healthy');
    expect(bmi(180, 95).band).toBe('over');
    expect(bmi(180, 100).band).toBe('obese');
    expect(lowestHealthyKg(180)).toBeCloseTo(59.94, 2);
  });

  test('a weight plan at a safe pace', () => {
    const p = weightPlan({ ...man, activity: 'some' }, 75, 0.5, 0);
    expect(p.weeks).toBe(10);
    expect(p.dailyDeficit).toBeCloseTo(550, 0);
    expect(p.eatKcal).toBe(Math.round(1780 * 1.375 - 550));
    expect(p.weeks * 7 * p.dailyDeficit).toBeGreaterThanOrEqual(5 * 7700);
    expect(p.floored).toBe(false);
    expect(p.by).toBe(10 * 7 * 86_400_000);
  });

  test('eating never drops below resting energy or 1,200 kcal', () => {
    const small: Body = { sex: 'female', age: 60, heightCm: 150, weightKg: 55, activity: 'low' };
    const p = weightPlan(small, 50, 0.75, 0);
    expect(p.floored).toBe(true);
    expect(p.eatKcal).toBeGreaterThanOrEqual(1200);
    expect(p.eatKcal).toBeGreaterThanOrEqual(Math.round(bmr(small)));
    // The smaller gap means more weeks than the asked-for pace (5 kg at 0.75 kg a week = 7).
    expect(p.weeks).toBeGreaterThan(7);
    // A body whose maintenance is already near the floor gets no date at all.
    const tiny = weightPlan({ ...small, heightCm: 145, weightKg: 45, age: 80 }, 42, 0.5, 0);
    expect(tiny.weeks).toBe(Infinity);
  });

  test('long-term change follows Hall (24 kcal a day ≈ 1 kg, half in a year), not 7,700 kcal per kg', () => {
    const r = eventualChangeKg(240);
    expect(r.eventual).toBeCloseTo(10, 5);
    expect(r.inAYear).toBeCloseTo(5, 5);
    // The static rule would claim 240 × 365 / 7700 ≈ 11.4 kg in a year: about twice as much.
    expect((240 * 365) / 7700).toBeGreaterThan(r.inAYear * 2);
  });

  test('fat equivalent and strength fuel', () => {
    expect(fatGrams(77)).toBeCloseTo(10, 5);
    expect(strengthFuel(man)).toEqual({ eatKcal: Math.round(1780 * 1.2 + 250), proteinG: 128 });
    expect(ftInToCm(5, 10)).toBeCloseTo(177.8, 1);
  });
});
