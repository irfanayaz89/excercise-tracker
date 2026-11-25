/// <reference types="jest" />
import { holdKcal, repKcal, setKcal, typicalSetKcal, workoutKcal, type ExerciseBody } from '../energy';
import { forecastBest, projectWeightChange, projectWorkouts } from '../projection';

const man = (kg: number): ExerciseBody => ({ weightKg: kg, heightCm: 176, sex: 'male' });
const woman = (kg: number): ExerciseBody => ({ weightKg: kg, heightCm: 163, sex: 'female' });

describe('per-rep calories match the research tables', () => {
  test('10 push-ups at 70 kg (man): 4.1 kcal (2.9–6.1)', () => {
    const k = setKcal({ exercise: 'pushup', activeMs: 20_000, holdMs: 0, totalReps: 10 }, man(70));
    expect(k.kcal).toBeCloseTo(4.13, 1);
    expect(k.low).toBeCloseTo(2.85, 1);
    expect(k.high).toBeCloseTo(6.06, 1);
  });

  test('a slow push-up matches the lab measurement (0.77 kcal at 6 s, 66 kg)', () => {
    expect(repKcal('pushup', { weightKg: 66, heightCm: 172, sex: 'male' }, 6).kcal).toBeCloseTo(0.77, 1);
  });

  test('5 pull-ups 3.4, 20 crunches 1.6, a 60 s plank 3.5 (70 kg man)', () => {
    expect(typicalSetKcal('pullup', man(70)).kcal).toBeCloseTo(3.35, 1);
    expect(typicalSetKcal('crunch', man(70)).kcal).toBeCloseTo(1.6, 1);
    expect(typicalSetKcal('plank', man(70)).kcal).toBeCloseTo(3.5, 5);
  });

  test('women: same per kg except height and crunch segment share (10 push-ups at 70 kg ≈ 4.0)', () => {
    expect(typicalSetKcal('pushup', woman(70)).kcal).toBeCloseTo(4.0, 1);
    expect(typicalSetKcal('plank', woman(55)).kcal).toBeCloseTo(2.75, 1);
  });

  test('cost scales with body mass, and a pause no longer halves every rep', () => {
    const at = (kg: number) => typicalSetKcal('pushup', man(kg)).kcal;
    expect(at(100) / at(55)).toBeCloseTo(100 / 55, 5);
    // 10 push-ups spread over 76 s or 75 s (7.9 vs 8 a minute): almost the same, no cliff.
    const slow = setKcal({ exercise: 'pushup', activeMs: 76_000, holdMs: 0, totalReps: 10 }, man(70)).kcal;
    const fast = setKcal({ exercise: 'pushup', activeMs: 75_000, holdMs: 0, totalReps: 10 }, man(70)).kcal;
    expect(Math.abs(slow - fast)).toBeLessThan(0.1);
  });

  test('side plank range is wider than a front plank (never measured)', () => {
    const f = holdKcal('plank', man(70), 60_000);
    const s = holdKcal('sidePlank', man(70), 60_000);
    expect(s.kcal).toBe(f.kcal);
    expect(s.low).toBeLessThan(f.low);
    expect(s.high).toBeGreaterThan(f.high);
  });

  test("the plan's 10-minute workout is about 19 kcal at 70 kg", () => {
    expect(workoutKcal(man(70)).kcal).toBeCloseTo(19, 0);
  });
});

describe('30 and 60 day projections', () => {
  test('a 53 kcal session four times a week: ≈900 kcal and ≈90 g of fat-energy in 30 days', () => {
    const p30 = projectWorkouts({ kcal: 53, low: 37, high: 82 }, 4, 30);
    expect(p30.sessions).toBe(17);
    expect(p30.total.kcal).toBeCloseTo(901, 0);
    expect(p30.fatG.kcal).toBeCloseTo(93.6, 0);
    const p60 = projectWorkouts({ kcal: 53, low: 37, high: 82 }, 4, 60);
    expect(p60.total.kcal).toBe(53 * 34);
  });

  test('a 500 kcal daily gap: about 2.0 kg (1.0–3.1) in 30 days and 3.9 kg (2.0–5.0) in 60', () => {
    const a = projectWeightChange(500, 30, 0);
    expect(a.kg).toBeCloseTo(1.95, 1);
    expect(a.low).toBeCloseTo(0.97, 1);
    expect(a.high).toBeCloseTo(3.09, 1);
    const b = projectWeightChange(500, 60, 0);
    expect(b.kg).toBeCloseTo(3.9, 1);
    expect(b.high).toBeCloseTo(5.04, 1);
    expect(projectWeightChange(0, 30, 0).kg).toBe(0);
  });

  test('rep forecasts slow down and cap by level', () => {
    expect(forecastBest(6, 0).best).toBe(6);
    const f = forecastBest(6, 60);
    expect(f.best).toBeGreaterThan(6);
    expect(f.best).toBeLessThanOrEqual(12);
    expect(forecastBest(30, 60).best).toBeLessThanOrEqual(36);
    expect(forecastBest(0, 60).best).toBe(0);
  });
});
