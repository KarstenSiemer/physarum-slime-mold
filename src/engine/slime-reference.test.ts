import { describe, expect, it } from 'vitest';
import { hexToLinear } from '../model/color';
import { defaultSettings, defaultStrain, STYLES, type Settings } from '../model/params';
import { at } from './at';
import { trailLevels } from './flow';
import type { FlowGrid } from './flow-reference';
import { BACKGROUND, SLIME_BEAD, SLIME_LOOK, SLIME_RELIEF } from './render';
import { PLASM_SPAN, SLIME_FULL, SLIME_RIM, stampOf, STEPS_PER_HOUR } from './slime';
import {
  amountLeft,
  amountStep,
  filmAt,
  filmCell,
  filmCells,
  filmOf,
  half,
  hasSlime,
  holdsPlasm,
  lattice,
  noiseSlope,
  paintedAmount,
  patternSteps,
  plasmLevel,
  SLIME_BEADS,
  SLIME_RIPPLE,
  SLIME_WAVES,
  slimeBeads,
  slimeColour,
  slimed,
  slimeDown,
  slimeLook,
  slimePaint,
  slimeStep,
  slimeStrength,
  slimeWaves,
  spline,
  splineSlope,
  SUN,
  wetShine,
  type Rgb,
  type SlimeField,
  type SlimeLook,
  type SlimeSettings,
} from './slime-reference';
import type { Stroke } from './types';

/** The 32-bit float just below a positive 32-bit float. */
function below(v: number): number {
  const f = new Float32Array([v]);
  const bits = new Uint32Array(f.buffer);
  bits[0] = (bits[0] ?? 0) - 1;
  return f[0] ?? 0;
}

// The rule of the slime field on the CPU (ADR 0055, decision 3), which both backends are checked against.
describe('the CPU reference of the slime field', () => {
  const [w, h] = [12, 10];
  const strains = [
    { ...defaultStrain(0, 2), deposit: 5, decay: 0.1 },
    { ...defaultStrain(1, 2), deposit: 2, decay: 0.6 },
  ];
  const settings: SlimeSettings = { ...defaultSettings(), strains };
  const [lowA, lowB] = strains.map((strain) => Math.fround(trailLevels(strain, 'sense-first')[0])) as [number, number];
  const cell = (x: number, y: number) => y * w + x;
  /** A grid with a wall at (3, 3) and (4, 3). */
  const gridOf = (boundary: Settings['boundary']): FlowGrid => {
    const env = new Uint8Array(w * h * 4);
    for (const c of [cell(3, 3), cell(4, 3)]) env[c * 4] = 255;
    return { width: w, height: h, boundary, env };
  };
  /** A trail with the values of `at`: cell, lane, value. */
  const trailOf = (at: readonly (readonly [number, number, number])[]) => {
    const trail = new Float32Array(w * h * 4);
    for (const [c, lane, v] of at) trail[c * 4 + lane] = v;
    return trail;
  };
  const none = () => new Uint32Array(w * h);

  it('has two strains with levels of their own', () => {
    expect(lowA).toBe(1);
    expect(lowB).toBeCloseTo(0.0296, 4);
    expect(below(lowA)).toBeLessThan(lowA);
    expect(below(lowA)).toBeGreaterThan(0.9999999);
  });

  it('gives a cell at or above the level of a strain the stamp of the step, and none just below it', () => {
    const trail = trailOf([
      [cell(5, 5), 0, lowA],
      [cell(6, 5), 0, below(lowA)],
      [cell(7, 5), 1, lowB],
      [cell(8, 5), 1, below(lowB)],
      [cell(5, 6), 0, 40],
      // The trail of the second strain at the level of the first, and the other way round.
      [cell(6, 6), 1, 0.5],
      [cell(7, 6), 0, 0.5],
      // Both strains.
      [cell(8, 6), 0, 3],
      [cell(8, 6), 1, 3],
    ]);
    const out = slimeStep(gridOf('box'), settings, 7, none(), trail);
    const stamped = [...out].flatMap((v, c) => (v === 0 ? [] : [c]));
    expect(stamped).toEqual([cell(5, 5), cell(7, 5), cell(5, 6), cell(6, 6), cell(8, 6)]);
    // The number of the step plus 1: 0 is a cell without a stamp.
    for (const c of stamped) expect(out[c]).toBe(8);
    expect(stampOf(7)).toBe(8);
    expect(holdsPlasm(gridOf('box'), settings, trail, 5, 5)).toBe(true);
    expect(holdsPlasm(gridOf('box'), settings, trail, 6, 5)).toBe(false);
    expect(holdsPlasm(gridOf('box'), settings, trail, 7, 6)).toBe(false);
  });

  it('reads the trail of the strains of the settings only', () => {
    // Lanes of strains that the settings do not hold: no level, so no plasm.
    const trail = trailOf([
      [cell(5, 5), 2, 1e6],
      [cell(6, 5), 3, 1e6],
      [cell(7, 5), 1, 1e6],
    ]);
    expect([...slimeStep(gridOf('box'), settings, 0, none(), trail)].filter((v) => v !== 0)).toEqual([1]);
    // With one strain the lane of the second one counts for nothing.
    const one = { ...settings, strains: strains.slice(0, 1) };
    expect([...slimeStep(gridOf('box'), one, 0, none(), trail)].every((v) => v === 0)).toBe(true);
  });

  it('gives no stamp to a wall and to a cell outside the arena, whatever trail they hold', () => {
    const everywhere = new Float32Array(w * h * 4).fill(40);
    const box = slimeStep(gridOf('box'), settings, 0, none(), everywhere);
    expect([box[cell(3, 3)], box[cell(4, 3)]]).toEqual([0, 0]);
    expect([...box].filter((v) => v === 1).length).toBe(w * h - 2);
    // The dish of 12 × 10 cells has a radius of 0.945 · 5 cells around (6, 5): its corners lie outside.
    const dish = slimeStep(gridOf('dish'), settings, 0, none(), everywhere);
    expect([dish[cell(0, 0)], dish[cell(11, 9)], dish[cell(0, 5)], dish[cell(3, 3)]]).toEqual([0, 0, 0, 0]);
    expect([dish[cell(6, 5)], dish[cell(2, 5)], dish[cell(6, 1)]]).toEqual([1, 1, 1]);
    // On the periodic grid every cell is inside.
    const wrap = slimeStep(gridOf('wrap'), settings, 0, none(), everywhere);
    expect([...wrap].filter((v) => v === 1).length).toBe(w * h - 2);
  });

  it('keeps the stamp of a cell that the plasm left, and renews the stamp of a cell that holds plasm', () => {
    const grid = gridOf('box');
    const first = slimeStep(grid, settings, 0, none(), trailOf([[cell(5, 5), 0, 9]]));
    const second = trailOf([
      [cell(5, 5), 0, 9],
      [cell(6, 5), 0, 9],
    ]);
    const later = slimeStep(grid, settings, 1, first, second);
    expect([later[cell(5, 5)], later[cell(6, 5)]]).toEqual([2, 2]);
    // The plasm leaves (6, 5), then all cells: the stamps stay.
    const third = slimeStep(grid, settings, 2, later, trailOf([[cell(5, 5), 0, 9]]));
    expect([third[cell(5, 5)], third[cell(6, 5)]]).toEqual([3, 2]);
    const empty = slimeStep(grid, settings, 3, third, trailOf([]));
    expect(empty).toEqual(third);
    // The field that goes in stays as it was.
    expect([...first].filter((v) => v !== 0)).toEqual([1]);
  });

  it('writes nothing without slime: with a life time of 0, and in the Jones model', () => {
    const grid = gridOf('box');
    const trail = new Float32Array(w * h * 4).fill(40);
    const before = slimeStep(grid, settings, 4, none(), trailOf([[cell(5, 5), 0, 9]]));
    for (const off of [
      { ...settings, slimeLife: 0 },
      { ...settings, model: 'jones' as const },
    ]) {
      expect(slimeStep(grid, off, 9, before, trail)).toEqual(before);
      expect([...slimeStep(grid, off, 9, none(), trail)].every((v) => v === 0)).toBe(true);
    }
    // The shortest life time of the setting writes as the longest one: the life time is not in the rule of the stamp.
    expect(slimeStep(grid, { ...settings, slimeLife: 1 }, 9, none(), trail)).toEqual(
      slimeStep(grid, { ...settings, slimeLife: 240 }, 9, none(), trail),
    );
  });

  it('takes the level of the order of a step', () => {
    // Moving first a cell holds more trail in the end, so the level is higher: 1 / d against (1 − d) / d.
    const fast = [{ ...defaultStrain(0), deposit: 5, decay: 0.6 }];
    const [sense, move] = (['sense-first', 'move-first'] as const).map((stepOrder) =>
      Math.fround(trailLevels(at(fast, 0), stepOrder)[0]),
    ) as [number, number];
    expect(move).toBeGreaterThan(sense);
    const trail = trailOf([[cell(5, 5), 0, sense]]);
    const one = { ...settings, strains: fast };
    expect(slimeStep(gridOf('box'), one, 0, none(), trail)[cell(5, 5)]).toBe(1);
    expect(slimeStep(gridOf('box'), { ...one, stepOrder: 'move-first' }, 0, none(), trail)[cell(5, 5)]).toBe(0);
  });

  it('says that a cell has slime while its stamp is younger than the life time', () => {
    const life = 144 * STEPS_PER_HOUR;
    // No stamp: no slime, at any step and life time.
    expect(hasSlime(0, 0, life)).toBe(false);
    expect(hasSlime(0, 5, 2 ** 32 - 1)).toBe(false);
    // A stamp of step 10 (the field holds 11). The step after reads it at the age 1.
    const held = stampOf(10);
    expect(hasSlime(held, 11, life)).toBe(true);
    // t − S < L: the last step with slime is S + L − 1.
    expect(hasSlime(held, 10 + life - 1, life)).toBe(true);
    expect(hasSlime(held, 10 + life, life)).toBe(false);
    expect(hasSlime(held, 10 + life + 1000, life)).toBe(false);
    // A stamp painted before a step has the number of that step: its age is 0 until the step has run.
    expect(hasSlime(stampOf(10), 10, 1)).toBe(true);
    expect(hasSlime(stampOf(10), 11, 1)).toBe(false);
    // Without slime (a life time of 0) no cell has slime.
    expect(hasSlime(held, 10, 0)).toBe(false);
    // A change of the life time acts on all slime at once.
    expect([hasSlime(held, 40, 20), hasSlime(held, 40, 31), hasSlime(held, 40, 30)]).toEqual([false, true, false]);
  });

  // Decision 8: the picture draws the slime of a cell as strong as it is young. `step` is the steps that ran so far.
  describe('the strength of the slime of a cell in the picture', () => {
    const life = 144 * STEPS_PER_HOUR;

    it('is full at the age 0: a stamp that the Slime tool wrote after the last step', () => {
      // After 10 steps the next step has the number 10, and a stroke writes its stamp.
      expect(slimeStrength(stampOf(10), 10, life)).toBe(1);
      expect(slimeStrength(stampOf(0), 0, life)).toBe(1);
    });

    it('falls in a straight line with the age, to one half at half the life time', () => {
      // A cell that held plasm in the last step, the step 9 of 10: the age 1.
      expect(slimeStrength(stampOf(9), 10, life)).toBe(1 - 1 / life);
      expect(slimeStrength(stampOf(10), 10 + life / 2, life)).toBe(0.5);
      expect(slimeStrength(stampOf(10), 10 + life / 4, life)).toBe(0.75);
      expect(slimeStrength(stampOf(10), 10 + (3 * life) / 4, life)).toBe(0.25);
      // The last step with slime: the age life − 1.
      expect(slimeStrength(stampOf(10), 10 + life - 1, life)).toBeCloseTo(1 / life, 12);
      expect(slimeStrength(stampOf(10), 10 + life - 1, life)).toBeGreaterThan(0);
    });

    it('is 0 at the life time and after it', () => {
      expect(slimeStrength(stampOf(10), 10 + life, life)).toBe(0);
      expect(slimeStrength(stampOf(10), 10 + life + 1, life)).toBe(0);
      expect(slimeStrength(stampOf(10), 10 + 5 * life, life)).toBe(0);
      // A short life time, as a test has it: 3 steps.
      expect([0, 1, 2, 3, 4].map((age) => slimeStrength(stampOf(7), 7 + age, 3))).toEqual([
        1,
        1 - 1 / 3,
        1 - 2 / 3,
        0,
        0,
      ]);
    });

    it('is 0 without a stamp, and without slime in the model', () => {
      expect(slimeStrength(0, 0, life)).toBe(0);
      expect(slimeStrength(0, 2 ** 32 - 1, life)).toBe(0);
      // A step count of life − 1 would give a cell without a stamp the age `life`, were 0 a stamp.
      expect(slimeStrength(0, life - 1, life)).toBe(0);
      expect(slimeStrength(0, life - 2, life)).toBe(0);
      // A life time of 0: the model has no slime.
      expect(slimeStrength(stampOf(10), 10, 0)).toBe(0);
    });

    it('takes the age in unsigned 32-bit integers, as the passes do', () => {
      // The count of the steps is at the end of its 32 bits: the step with the number 2^32 − 1 comes next, and its
      // stamp is 2^32, which the field holds as 0. One step before, a stamp still has the age 0 and 1.
      const last = 2 ** 32 - 2;
      expect(stampOf(last)).toBe(2 ** 32 - 1);
      expect(slimeStrength(stampOf(last), last, life)).toBe(1);
      expect(slimeStrength(stampOf(last - 1), last, life)).toBe(1 - 1 / life);
      // The count wrapped to 3: a stamp from 6 steps before is 6 steps old, not 2^32 − 6 steps.
      const old = stampOf(2 ** 32 - 3);
      expect(old).toBe(2 ** 32 - 2);
      expect(slimeStrength(old, 3, life)).toBe(1 - 6 / life);
      // A stamp from the future of the count is older than every life time below 2^32 steps.
      expect(slimeStrength(stampOf(11), 10, life)).toBe(0);
      expect(slimeStrength(stampOf(11), 10, 2 ** 32 - 1)).toBe(0);
    });
  });
});

// ADR 0057: the amount of slime of a cell, which only the picture reads. The rules in plain cases.
describe('the CPU reference of the amount of slime (ADR 0057)', () => {
  const [w, h] = [12, 10];
  const strains = [
    { ...defaultStrain(0, 2), deposit: 5, decay: 0.1 },
    { ...defaultStrain(1, 2), deposit: 2, decay: 0.6 },
  ];
  const settings: SlimeSettings = { ...defaultSettings(), strains, slimeLife: 12 / STEPS_PER_HOUR };
  const life = 12;
  const [lowA, lowB] = strains.map((strain) => Math.fround(trailLevels(strain, 'sense-first')[0])) as [number, number];
  const cell = (x: number, y: number) => y * w + x;
  const grid = (boundary: Settings['boundary'] = 'box', walls: number[] = []): FlowGrid => {
    const env = new Uint8Array(w * h * 4);
    for (const c of walls) env[c * 4] = 255;
    return { width: w, height: h, boundary, env };
  };
  /** A trail with the values of `at`: cell, lane, value. */
  const trailOf = (at: readonly (readonly [number, number, number])[]) => {
    const trail = new Float32Array(w * h * 4);
    for (const [c, lane, v] of at) trail[c * 4 + lane] = v;
    return trail;
  };
  const none = () => new Uint32Array(w * h);

  it('is a whole number up to 4,095, and the plasm is full 4 low levels above the low level', () => {
    expect(SLIME_FULL).toBe(4095);
    expect(PLASM_SPAN).toBeCloseTo(4, 12);
    expect(SLIME_RIM).toBe(4);
  });

  it('leaves all of an amount at the age 0 and 1, the share 1 − age / life time after it, and nothing without slime', () => {
    // A stamp of step 10, read before the step 10 (a stroke) and before the step 11 (the step after): all of it.
    expect(amountLeft(4095, stampOf(10), 10, life)).toBe(4095);
    expect(amountLeft(4095, stampOf(10), 11, life)).toBe(4095);
    // Three steps old: 9 of 12. Six steps old: 2,047.5, rounded down.
    expect(amountLeft(4095, stampOf(10), 13, life)).toBe(3071);
    expect(amountLeft(4095, stampOf(10), 16, life)).toBe(2047);
    expect(amountLeft(1000, stampOf(10), 16, life)).toBe(500);
    expect(amountLeft(7, stampOf(10), 12, life)).toBe(5);
    // The last step with slime, the age 11: a twelfth.
    expect(amountLeft(4095, stampOf(10), 21, life)).toBe(341);
    // At the life time and after it, without a stamp, and without slime in the model: nothing.
    expect(amountLeft(4095, stampOf(10), 22, life)).toBe(0);
    expect(amountLeft(4095, stampOf(10), 500, life)).toBe(0);
    expect(amountLeft(4095, 0, 16, life)).toBe(0);
    expect(amountLeft(4095, stampOf(10), 10, 0)).toBe(0);
    // The age in unsigned 32-bit integers: the count of the steps wrapped to 3, and the stamp is 6 steps old.
    expect(amountLeft(4095, stampOf(2 ** 32 - 3), 3, life)).toBe(2047);
    // The longest life time, 240 hours: the product of the amount and the steps still fits 32 bits.
    expect(4095 * 432_000).toBeLessThan(2 ** 32);
    expect(amountLeft(4095, stampOf(0), 216_000, 432_000)).toBe(2047);
  });

  it('takes the level of the plasm from the strain with the most: 0 at its low level, full at 5 low levels', () => {
    const level = (at: readonly (readonly [number, number, number])[]) => plasmLevel(settings, trailOf(at), cell(5, 5));
    expect(level([[cell(5, 5), 0, lowA]])).toBe(0);
    expect(level([[cell(5, 5), 0, 5 * lowA]])).toBe(4095);
    expect(level([[cell(5, 5), 0, 50 * lowA]])).toBe(4095);
    // Half way: 2,047.5, rounded to the nearest.
    expect(level([[cell(5, 5), 0, 3 * lowA]])).toBe(2048);
    expect(level([[cell(5, 5), 0, 2 * lowA]])).toBe(1024);
    // Below the low level and without trail: 0.
    expect(level([[cell(5, 5), 0, 0.5 * lowA]])).toBe(0);
    expect(level([])).toBe(0);
    // The second strain has a level of its own, and the strain with the most counts.
    expect(level([[cell(5, 5), 1, Math.fround(5 * lowB)]])).toBe(4095);
    expect(
      level([
        [cell(5, 5), 0, 2 * lowA],
        [cell(5, 5), 1, Math.fround(4 * lowB)],
      ]),
    ).toBe(3071);
    // A lane of a strain that the settings do not hold counts for nothing.
    expect(level([[cell(5, 5), 2, 1e6]])).toBe(0);
  });

  it('lets a cell with plasm gain 1 per step up to the level of its plasm, and keeps the amount of a cell without', () => {
    const full = trailOf([
      [cell(5, 5), 0, 5 * lowA],
      [cell(6, 5), 0, 2 * lowA],
    ]);
    let stamps: Uint32Array = none();
    let amounts: Uint32Array = none();
    for (let step = 0; step < 3; step++) {
      amounts = amountStep(grid(), settings, step, stamps, amounts, full);
      stamps = slimeStep(grid(), settings, step, stamps, full);
    }
    // Three steps from nothing: 3, under a full tube and under a thin one.
    expect([amounts[cell(5, 5)], amounts[cell(6, 5)], amounts[cell(7, 5)]]).toEqual([3, 3, 0]);
    // At its level a cell gains no more, and above it the cell keeps what it has: the slime is never thicker than
    // the plasm was, and never gets thinner under plasm.
    const held = none();
    held.set([1024, 1023, 3000], cell(6, 5));
    const stamped = none();
    stamped.set([stampOf(2), stampOf(2), stampOf(2)], cell(6, 5));
    const thin = trailOf([
      [cell(6, 5), 0, 2 * lowA],
      [cell(7, 5), 0, 2 * lowA],
      [cell(8, 5), 0, 2 * lowA],
    ]);
    const next = amountStep(grid(), settings, 3, stamped, held, thin);
    expect([next[cell(6, 5)], next[cell(7, 5)], next[cell(8, 5)]]).toEqual([1024, 1024, 3000]);
    // A cell without plasm keeps its amount, whatever its age: the picture lets it fade, the field does not.
    const left = amountStep(grid(), settings, 9, stamped, held, trailOf([]));
    expect(left).toEqual(held);
    // The field that goes in stays as it was.
    expect([held[cell(6, 5)], held[cell(7, 5)]]).toEqual([1024, 1023]);
  });

  it('starts from nothing on ground without slime, and from what the picture showed where plasm comes back', () => {
    const plasm = trailOf([[cell(5, 5), 0, 5 * lowA]]);
    const amounts = none();
    amounts[cell(5, 5)] = 4000;
    // No stamp: the amount of before counts for nothing.
    expect(amountStep(grid(), settings, 30, none(), amounts, plasm)[cell(5, 5)]).toBe(1);
    // Slime that is over (12 steps old): from nothing too.
    const stamps = none();
    stamps[cell(5, 5)] = stampOf(10);
    expect(amountStep(grid(), settings, 22, stamps, amounts, plasm)[cell(5, 5)]).toBe(1);
    // Slime of 6 steps: from half of the amount, rounded down, plus 1.
    expect(amountStep(grid(), settings, 16, stamps, amounts, plasm)[cell(5, 5)]).toBe(2001);
    // The step after its stamp: from all of it.
    expect(amountStep(grid(), settings, 11, stamps, amounts, plasm)[cell(5, 5)]).toBe(4001);
  });

  it('gives no amount to a wall and to a cell outside the arena, and none without slime in the model', () => {
    const everywhere = new Float32Array(w * h * 4).fill(40);
    const walled = amountStep(grid('box', [cell(3, 3)]), settings, 0, none(), none(), everywhere);
    expect(walled[cell(3, 3)]).toBe(0);
    expect([...walled].filter((v) => v === 1).length).toBe(w * h - 1);
    const dish = amountStep(grid('dish'), settings, 0, none(), none(), everywhere);
    expect([dish[cell(0, 0)], dish[cell(6, 5)]]).toEqual([0, 1]);
    for (const off of [
      { ...settings, slimeLife: 0 },
      { ...settings, model: 'jones' as const },
    ])
      expect([...amountStep(grid(), off, 0, none(), none(), everywhere)].every((v) => v === 0)).toBe(true);
  });

  it('paints an amount that rises over 4 cells from the edge of a stroke to the full amount', () => {
    // Half a cell outside the radius and beyond: nothing. 3.5 cells inside it and beyond: the full amount.
    expect(paintedAmount(9.5, 9)).toBe(0);
    expect(paintedAmount(12, 9)).toBe(0);
    expect(paintedAmount(5.5, 9)).toBe(4095);
    expect(paintedAmount(0, 9)).toBe(4095);
    // Half way up the rim: half of the full amount, rounded to the nearest.
    expect(paintedAmount(7.5, 9)).toBe(2048);
    // t³ (t (6 t − 15) + 10) at t = 0.375 is 0.27521, and at t = 0.275 it is 0.13162.
    expect(paintedAmount(8, 9)).toBe(1127);
    expect(paintedAmount(0, 0.6)).toBe(539);
    // The curve starts and ends flat: next to its ends it changes little.
    expect(paintedAmount(9.4, 9)).toBeLessThan(2);
    expect(paintedAmount(5.6, 9)).toBeGreaterThan(4093);
    // It never falls toward the middle of the stroke.
    const rise = Array.from({ length: 96 }, (_, i) => paintedAmount(9.5 - i / 20, 9));
    expect(rise.every((v, i) => i === 0 || v >= (rise[i - 1] ?? 0))).toBe(true);
  });

  it('lets the Slime tool give a cell the larger of what is left of its amount and the amount of the stroke', () => {
    const stroke: Stroke = { kind: 'slime', from: [5.5, 5.5], to: [5.5, 5.5], radius: 2.6 };
    const stamps = none();
    const amounts = none();
    // Slime of 6 steps with the full amount in the middle cell and in a cell of the rim, and beside the stroke.
    for (const c of [cell(5, 5), cell(7, 5), cell(9, 5)]) [stamps[c], amounts[c]] = [stampOf(10), 4095];
    slimePaint(grid(), settings, 16, stamps, stroke, undefined, { amounts, life });
    // The middle: what is left, 2,047, is less than the stroke gives there.
    expect(paintedAmount(0, 2.6)).toBe(3772);
    expect(amounts[cell(5, 5)]).toBe(3772);
    // The rim, 2 cells from the middle: the stroke gives 539, and what is left is more.
    expect(paintedAmount(2, 2.6)).toBe(539);
    expect(amounts[cell(7, 5)]).toBe(2047);
    // A cell of the stroke without slime before: the amount of the stroke.
    expect(amounts[cell(4, 5)]).toBe(paintedAmount(1, 2.6));
    // Every cell of the stroke has the stamp of the stroke, and a cell beside it keeps its stamp and its amount.
    expect([stamps[cell(5, 5)], stamps[cell(7, 5)], stamps[cell(4, 5)]]).toEqual([17, 17, 17]);
    expect([stamps[cell(9, 5)], amounts[cell(9, 5)]]).toEqual([stampOf(10), 4095]);
  });

  it('lets an erase and a wall clear the amount, and leaves it under every other kind of stroke and in the Jones model', () => {
    const fresh = () => {
      const [stamps, amounts] = [none(), none()];
      for (const c of [cell(5, 5), cell(9, 5)]) [stamps[c], amounts[c]] = [stampOf(10), 4095];
      return { stamps, amounts };
    };
    const over = (kind: Stroke['kind']): Stroke => ({ kind, from: [5.5, 5.5], to: [5.5, 5.5], radius: 1 });
    for (const kind of ['erase', 'wall'] as const) {
      const { stamps, amounts } = fresh();
      slimePaint(grid(), settings, 11, stamps, over(kind), undefined, { amounts, life });
      expect([stamps[cell(5, 5)], amounts[cell(5, 5)]], kind).toEqual([0, 0]);
      expect([stamps[cell(9, 5)], amounts[cell(9, 5)]], kind).toEqual([stampOf(10), 4095]);
    }
    for (const kind of ['food', 'light', 'anode', 'cathode'] as const) {
      const { stamps, amounts } = fresh();
      slimePaint(grid(), settings, 11, stamps, over(kind), undefined, { amounts, life });
      expect([stamps[cell(5, 5)], amounts[cell(5, 5)]], kind).toEqual([stampOf(10), 4095]);
    }
    // The Slime tool paints no wall: a cell with a wall keeps no stamp and no amount.
    const { stamps, amounts } = fresh();
    slimePaint(grid('box', [cell(5, 5)]), settings, 11, stamps, over('slime'), undefined, { amounts, life });
    expect([stamps[cell(5, 5)], amounts[cell(5, 5)]]).toEqual([stampOf(10), 4095]);
    expect([stamps[cell(5, 4)], amounts[cell(5, 4)]]).toEqual([12, paintedAmount(1, 1)]);
    // The Jones model has no slime.
    const jones = fresh();
    slimePaint(grid(), { model: 'jones' }, 11, jones.stamps, over('slime'), undefined, {
      amounts: jones.amounts,
      life,
    });
    expect(jones).toEqual(fresh());
  });
});

// ADR 0057: the film of the slime in the picture. The rules of the reference in plain cases, with the numbers worked
// out by hand.
describe('the CPU reference of the film of the slime (ADR 0057)', () => {
  const life = 12;
  /** A grid without walls, or with a wall in each cell of `walls`. */
  const grid = (
    width: number,
    height: number,
    boundary: Settings['boundary'] = 'box',
    walls: readonly (readonly [number, number])[] = [],
  ): FlowGrid => {
    const env = new Uint8Array(width * height * 4);
    for (const [x, y] of walls) env[(y * width + x) * 4] = 255;
    return { width, height, boundary, env };
  };
  /** A field at step 0 with new slime of the amounts of `at`: column, row, amount (the full amount by default). */
  const field = (
    width: number,
    height: number,
    at: readonly (readonly [number, number, number?])[],
    step = 0,
  ): SlimeField => {
    const [stamps, amounts] = [new Uint32Array(width * height), new Uint32Array(width * height)];
    for (const [x, y, amount = SLIME_FULL] of at)
      [stamps[y * width + x], amounts[y * width + x]] = [stampOf(0), amount];
    return { stamps, amounts, step, life };
  };
  /** New slime of the full amount in every cell. */
  const full = (width: number, height: number) =>
    field(
      width,
      height,
      Array.from({ length: width * height }, (_, c) => [c % width, Math.floor(c / width)] as const),
    );

  describe('a texel of a map', () => {
    it('holds the nearest 16-bit float, and the even one of two that are as near', () => {
      for (const v of [0, 1, 0.5, 0.25, 0.75, 1 / 16, 4 / 16, 9 / 64, 1023 / 1024, 2047 / 2048, 1 + 1 / 1024])
        expect(half(v)).toBe(v);
      // From 0.5 to 1 the values lie 1 / 2048 apart, from 0.25 to 0.5 half as far, and from 1 on twice as far.
      expect(half(0.7)).toBe(1434 / 2048);
      expect(half(0.3)).toBe(1229 / 4096);
      expect(half(1 / 3)).toBe(1365 / 4096);
      expect(half(1.3)).toBe(1331 / 1024);
      // Half way between two values: the one with the even last bit.
      expect(half(1 + 1 / 2048)).toBe(1);
      expect(half(1 + 3 / 2048)).toBe(1 + 2 / 1024);
      expect(half(1 + 1.0001 / 2048)).toBe(1 + 1 / 1024);
      expect(half(0.5 + 1 / 4096)).toBe(0.5);
      // Just below a power of 2 the value rounds up to it.
      expect(half(1 - 1 / 8192)).toBe(1);
      expect(half(0.5 - 1 / 16384)).toBe(0.5);
      // Below 2^-14 the values lie 2^-24 apart, down to 0.
      expect(half(2 ** -24)).toBe(2 ** -24);
      expect(half(1.5 * 2 ** -24)).toBe(2 ** -23);
      expect(half(2.5 * 2 ** -24)).toBe(2 ** -23);
      expect(half(0.4 * 2 ** -24)).toBe(0);
      expect(half(1e-9)).toBe(0);
      // The film is never thinner than nothing.
      expect(half(-0.3)).toBe(0);
    });
  });

  describe('the thickness of the slime of a cell', () => {
    it('is the amount as a share of the full amount, times the strength of the age', () => {
      // New slime of the full amount: 1.
      expect(filmCell(stampOf(0), 4095, 0, life)).toBe(1);
      expect(filmCell(stampOf(7), 4095, 7, life)).toBe(1);
      // Half the amount, or half the life time: one half. Both: a quarter.
      expect(filmCell(stampOf(0), 2047.5, 0, life)).toBe(0.5);
      expect(filmCell(stampOf(0), 4095, 6, life)).toBe(0.5);
      expect(filmCell(stampOf(0), 2047.5, 6, life)).toBe(0.25);
      expect(filmCell(stampOf(0), 4095, 3, life)).toBe(0.75);
      // A third of the amount: a third, as a 32-bit float.
      expect(filmCell(stampOf(0), 1365, 0, life)).toBe(Math.fround(1 / 3));
      // The last step with slime: a twelfth of the amount.
      expect(filmCell(stampOf(0), 4095, 11, life)).toBeCloseTo(1 / 12, 6);
      // The strength of the age is the one of slimeStrength().
      expect(filmCell(stampOf(0), 4095, 5, life)).toBeCloseTo(slimeStrength(stampOf(0), 5, life), 6);
    });

    it('is 0 without slime: an amount of 0, no stamp, and an age at or above the life time', () => {
      expect(filmCell(stampOf(0), 0, 0, life)).toBe(0);
      expect(filmCell(0, 4095, 0, life)).toBe(0);
      expect(filmCell(stampOf(0), 4095, 12, life)).toBe(0);
      expect(filmCell(stampOf(0), 4095, 500, life)).toBe(0);
      expect(filmCell(stampOf(0), 4095, 0, 0)).toBe(0);
    });
  });

  describe('the map of the film', () => {
    const one = field(8, 6, [[3, 2]]);

    it('is the mean of the thickness over the 3 × 3 cells around a cell, with the weights 1, 2, 1 along each axis', () => {
      const map = filmCells(grid(8, 6), one);
      expect(map.length).toBe(48);
      // One cell of the full thickness: 4, 2 and 1 sixteenths in the cells around it, and nothing beyond them.
      expect([...map.slice(8 + 2, 8 + 5)]).toEqual([1 / 16, 2 / 16, 1 / 16]);
      expect([...map.slice(16 + 2, 16 + 5)]).toEqual([2 / 16, 4 / 16, 2 / 16]);
      expect([...map.slice(24 + 2, 24 + 5)]).toEqual([1 / 16, 2 / 16, 1 / 16]);
      expect(map.reduce((sum, v) => sum + v, 0)).toBe(1);
      expect([...map].filter((v) => v !== 0).length).toBe(9);
      expect(filmOf(grid(8, 6), one, 3, 2)).toBe(0.25);
      // A flat film stays flat, also in the cells at the edge of a box, which have fewer cells around them.
      expect([...filmCells(grid(8, 6), full(8, 6))].every((v) => v === 1)).toBe(true);
      // Old slime and thin slime: the thickness is blended, never the amounts or the stamps.
      const mixed = field(8, 6, [
        [3, 2, 4095],
        [4, 2, 1365],
      ]);
      expect(filmOf(grid(8, 6), mixed, 3, 2)).toBeCloseTo((4 + 2 / 3) / 16, 7);
    });

    it('leaves the cells of walls out of the mean, so a wall takes the film of the open cells beside it', () => {
      // A wall in the cell to the right of the one cell with slime. The cell with slime: 4 of the 14 that are left.
      const walled = grid(8, 6, 'box', [[4, 2]]);
      expect(filmOf(walled, one, 3, 2)).toBeCloseTo(4 / 14, 7);
      // The cell of the wall: 2 of the 12 around it.
      expect(filmOf(walled, one, 4, 2)).toBeCloseTo(2 / 12, 7);
      // Slime everywhere but in a wall of 3 × 3 cells: the 8 outer cells of the wall hold the full film. Its middle
      // cell touches no open cell, and takes the film of the open cells among the 5 × 5 around it: the full film too.
      const block = [1, 2, 3].flatMap((y) => [3, 4, 5].map((x) => [x, y] as const));
      const around = full(8, 6);
      for (const [x, y] of block) [around.stamps[y * 8 + x], around.amounts[y * 8 + x]] = [0, 0];
      const map = filmCells(grid(8, 6, 'box', block), around);
      expect([...map].filter((v) => v === 1).length).toBe(48);
      expect(map[2 * 8 + 4]).toBe(1);
      // One cell with slime, two cells to the left of that middle cell: with the weights 1, 2, 3, 2, 1 it has 3 of
      // the 32 that the 16 open cells among the 5 × 5 have together.
      expect(filmOf(grid(8, 6, 'box', block), field(8, 6, [[2, 2]]), 4, 2)).toBeCloseTo(3 / 32, 7);
      // A wall of 5 × 5 cells at the upper edge of the grid. The upper three cells of its middle column have no open
      // cell among the 5 × 5 around them, and hold no film. Every other cell of the wall holds the full film.
      const wide = [0, 1, 2, 3, 4].flatMap((y) => [1, 2, 3, 4, 5].map((x) => [x, y] as const));
      const beside = full(8, 6);
      for (const [x, y] of wide) [beside.stamps[y * 8 + x], beside.amounts[y * 8 + x]] = [0, 0];
      const deep = filmCells(grid(8, 6, 'box', wide), beside);
      expect([...deep].filter((v) => v === 1).length).toBe(45);
      expect([deep[3], deep[8 + 3], deep[2 * 8 + 3], deep[3 * 8 + 3]]).toEqual([0, 0, 0, 1]);
      // A frame that draws no walls counts their cells, with the thickness 0 that they have: the film falls
      // toward the wall.
      const bare = filmCells(grid(8, 6, 'box', block), around, false);
      expect(bare[2 * 8 + 2]).toBe(12 / 16);
      expect(bare[2 * 8 + 3]).toBe(4 / 16);
      expect(bare[2 * 8 + 4]).toBe(0);
      expect(filmOf(walled, one, 3, 2, false)).toBe(0.25);
    });

    it('leaves the cells outside the arena out of the mean, and wraps on the periodic grid', () => {
      // The corner cell of a box has 4 cells around it: 4 of 9.
      const corner = field(8, 6, [[0, 0]]);
      expect(filmOf(grid(8, 6), corner, 0, 0)).toBeCloseTo(4 / 9, 7);
      // On the periodic grid it has all 9, and the cells across the edges get their share.
      expect(filmOf(grid(8, 6, 'wrap'), corner, 0, 0)).toBe(4 / 16);
      expect(filmOf(grid(8, 6, 'wrap'), corner, 7, 0)).toBe(2 / 16);
      expect(filmOf(grid(8, 6, 'wrap'), corner, 7, 5)).toBe(1 / 16);
      expect(filmOf(grid(8, 6), corner, 7, 5)).toBe(0);
      // The dish of 12 × 10 cells, 4.725 cells around (6, 5): slime everywhere in it. A cell outside the rim that
      // touches a cell of the dish holds the full film, and so does a corner of the grid, which lies two cells from
      // a cell of the dish.
      const dish = grid(12, 10, 'dish');
      const map = filmCells(dish, full(12, 10));
      expect([map[5 * 12 + 6], map[5 * 12 + 1], map[5 * 12]]).toEqual([1, 1, 1]);
      expect([map[0], map[11], map[9 * 12 + 11]]).toEqual([1, 1, 1]);
      // A dish of the same size in a grid of 20 × 10 cells, around (10, 5). Along the row of its centre the cell 5 is
      // the first of the dish. The cell 4 touches it, the cell 3 lies two cells from it, and the cell 2 lies three
      // cells from it: no film there, and none in the corner of the grid.
      const far = filmCells(grid(20, 10, 'dish'), full(20, 10));
      expect([far[5 * 20 + 5], far[5 * 20 + 4], far[5 * 20 + 3], far[5 * 20 + 2], far[0]]).toEqual([1, 1, 1, 0, 0]);
    });
  });

  describe('a coarse map of the film', () => {
    it('holds the mean over the 2^level cells per side that a texel covers', () => {
      const map = new Float32Array(8 * 4);
      map.set([1, 0.5, 0.25, 0], 0);
      map.set([0.5, 0, 0.25, 1], 8);
      const down = slimeDown(map, 8, 4, 1);
      expect(down.length).toBe(4 * 2);
      expect([...down]).toEqual([0.5, 0.375, 0, 0, 0, 0, 0, 0]);
      // The level 2: 4 × 4 cells, the mean of 4 texels of the level 1.
      expect([...slimeDown(map, 8, 4, 2)]).toEqual([0.21875, 0]);
      // A flat film is flat on every level.
      const flat = new Float32Array(8 * 4).fill(0.75);
      for (const level of [1, 2, 3]) expect([...slimeDown(flat, 8, 4, level)].every((v) => v === 0.75)).toBe(true);
    });

    it('counts a cell by the share that a texel covers, on a side that 2^level does not divide', () => {
      // 3 cells and 2 texels: a texel is 1.5 cells wide, and the cell in the middle lies half in each.
      const row = Float32Array.from([1, 0.5, 0]);
      const [left, right] = slimeDown(row, 3, 1, 1);
      expect(left).toBeCloseTo((1 + 0.25) / 1.5, 3);
      expect(right).toBeCloseTo(0.25 / 1.5, 3);
      // 26 × 17 cells: 13 × 9 texels of the level 1, 7 × 5 of the level 2, and a flat film stays flat.
      const flat = new Float32Array(26 * 17).fill(0.5);
      expect(slimeDown(flat, 26, 17, 1).length).toBe(13 * 9);
      expect(slimeDown(flat, 26, 17, 2).length).toBe(7 * 5);
      for (const level of [1, 2, 3, 4])
        for (const v of slimeDown(flat, 26, 17, level)) expect(Math.abs(v - 0.5)).toBeLessThanOrEqual(1 / 4096);
    });
  });

  describe('the film at a point', () => {
    /** A map that rises along x and along y: 0.1 + 0.05 x + 0.02 y at the centre of the cell (x, y). */
    const ramp = Float32Array.from({ length: 12 * 10 }, (_, c) => 0.1 + 0.05 * (c % 12) + 0.02 * Math.floor(c / 12));

    it('weighs the 3 texels around a point by a quadratic B-spline', () => {
      expect(spline(0)).toEqual([0.125, 0.75, 0.125]);
      expect(spline(-0.5)).toEqual([0.5, 0.5, 0]);
      expect(spline(0.5)).toEqual([0, 0.5, 0.5]);
      expect(splineSlope(0)).toEqual([-0.5, -0, 0.5]);
      for (const u of [-0.5, -0.3, 0, 0.17, 0.5]) {
        const [w, s] = [spline(u), splineSlope(u)];
        expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 12);
        expect(s[0] + s[1] + s[2]).toBeCloseTo(0, 12);
        // A straight line through the three texels comes out exactly, with its slope.
        expect(-w[0] + w[2]).toBeCloseTo(u, 12);
        expect(-s[0] + s[2]).toBeCloseTo(1, 12);
      }
    });

    it('is the thickness of a flat film, with no slope', () => {
      const flat = new Float32Array(8 * 6).fill(0.75);
      for (const p of [
        [3.5, 2.5],
        [4, 3],
        [0.1, 5.9],
        [7.31, 0.77],
      ] as const) {
        const film = filmAt(flat, grid(8, 6), 0, p);
        expect(film.h).toBeCloseTo(0.75, 12);
        expect(Math.hypot(...film.g)).toBeLessThan(1e-12);
      }
    });

    it('follows a film that rises in a straight line exactly, with its gradient per cell', () => {
      for (const [x, y] of [
        [5.5, 4.5],
        [6, 5],
        [4.21, 6.83],
        [8.999, 2.001],
      ] as const) {
        const film = filmAt(ramp, grid(12, 10), 0, [x, y]);
        // The centre of the cell (x, y) lies at (x + 0.5, y + 0.5).
        expect(film.h).toBeCloseTo(0.1 + 0.05 * (x - 0.5) + 0.02 * (y - 0.5), 6);
        expect(film.g[0]).toBeCloseTo(0.05, 6);
        expect(film.g[1]).toBeCloseTo(0.02, 6);
      }
    });

    it('blends the texels: 1/8, 3/4, 1/8 at the centre of a cell, and the two columns beside the edge of a cell', () => {
      const one = new Float32Array(8 * 6);
      one[2 * 8 + 3] = 1;
      const look = (x: number, y: number) => filmAt(one, grid(8, 6), 0, [x, y]);
      expect(look(3.5, 2.5).h).toBeCloseTo(0.75 * 0.75, 12);
      expect(look(4.5, 2.5).h).toBeCloseTo(0.125 * 0.75, 12);
      expect(look(4.5, 3.5).h).toBeCloseTo(0.125 * 0.125, 12);
      // The edge between two cells: half of each column.
      expect(look(4, 2.5).h).toBeCloseTo(0.5 * 0.75, 12);
      // A cell and a half from the centre of the texel and beyond: nothing.
      expect(look(5, 2.5).h).toBe(0);
      expect(look(5.7, 2.5).h).toBe(0);
      // The film has no crease: the gradient is the same on both sides of the edge of a cell, and 0 on the top.
      expect(look(4 - 1e-9, 2.5).g[0]).toBeCloseTo(look(4 + 1e-9, 2.5).g[0], 6);
      expect(look(3.5, 2.5).g).toEqual([0, 0]);
      expect(look(4, 2.5).g[0]).toBeCloseTo(-0.75, 12);
    });

    it('repeats on the periodic grid, and goes on beyond the edge of a closed arena', () => {
      const edge = new Float32Array(8 * 6);
      for (let y = 0; y < 6; y++) edge[y * 8] = 1;
      // A box: the texels of the first column go on to the left of the grid.
      const box = (x: number) => filmAt(edge, grid(8, 6), 0, [x, 3]).h;
      expect([box(0.5), box(0.2), box(0), box(-0.4), box(-3)].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([
        0.875, 0.98, 1, 1, 1,
      ]);
      // The dish has the same rule: the map ends at the edge of the grid.
      expect(filmAt(edge, grid(8, 6, 'dish'), 0, [-0.4, 3]).h).toBeCloseTo(1, 12);
      // The periodic grid: the last column lies beside the first, and the film falls toward it.
      const wrap = (x: number, y = 3) => filmAt(edge, grid(8, 6, 'wrap'), 0, [x, y]);
      expect(wrap(0.5).h).toBeCloseTo(0.75, 12);
      expect(wrap(0).h).toBeCloseTo(0.5, 12);
      expect(wrap(-0.5).h).toBeCloseTo(0.125, 12);
      // And it repeats with the grid, with its gradient.
      for (const [dx, dy] of [
        [8, 0],
        [0, 6],
        [-8, -6],
        [80, 60],
        [-800, 600],
      ] as const) {
        expect(wrap(0.3 + dx, 2.2 + dy).h).toBeCloseTo(wrap(0.3, 2.2).h, 9);
        expect(wrap(0.3 + dx, 2.2 + dy).g[0]).toBeCloseTo(wrap(0.3, 2.2).g[0], 9);
      }
    });

    it('reads a coarse map with texels of width / n cells, and gives the gradient per cell', () => {
      // 12 × 10 cells on the level 1: 6 × 5 texels of 2 cells. A map that rises by 0.1 per texel along x.
      const coarse = Float32Array.from({ length: 6 * 5 }, (_, t) => 0.1 * (t % 6));
      const film = filmAt(coarse, grid(12, 10), 1, [6, 5]);
      // The point (6, 5) lies at the edge between the texels 2 and 3: 0.25. Per cell the film rises by 0.05.
      expect(film.h).toBeCloseTo(0.25, 7);
      expect(film.g[0]).toBeCloseTo(0.05, 7);
      expect(film.g[1]).toBeCloseTo(0, 7);
      // 26 × 17 cells on the level 2: 7 × 5 texels of 26 / 7 by 17 / 5 cells.
      const odd = Float32Array.from({ length: 7 * 5 }, (_, t) => 0.1 * Math.floor(t / 7));
      const at = filmAt(odd, grid(26, 17), 2, [13, 8.5]);
      expect(at.h).toBeCloseTo(0.2, 7);
      expect(at.g[1]).toBeCloseTo(0.1 / (17 / 5), 7);
      // On the periodic grid the coarse map wraps too.
      const wrapped = filmAt(odd, grid(26, 17, 'wrap'), 2, [13 + 26, 8.5 - 17]);
      expect(wrapped.h).toBeCloseTo(0.2, 7);
    });
  });

  describe('the patterns of the film', () => {
    /** The hash of the shaders in whole numbers of any size, cut to 32 bits after every step. */
    const hash = (x: number, y: number) => {
      const bits = (v: bigint) => BigInt.asUintN(32, v);
      let v = bits(bits(BigInt(x)) * 1664525n + bits(BigInt(y)) * 1013904223n);
      v = bits((v ^ (v >> 16n)) * 0x7feb352dn);
      v = bits((v ^ (v >> 15n)) * 0x846ca68bn);
      return Number((v ^ (v >> 16n)) >> 8n) / 2 ** 24;
    };

    it('has the hash of the shaders, bit for bit in unsigned 32-bit integers', () => {
      expect(lattice(0, 0)).toBe(0);
      for (const [x, y] of [
        [1, 0],
        [0, 1],
        [3, 7],
        [12, 211],
        [57, 113],
        [191, 31],
        [65_535, 65_536],
        [2 ** 31 - 1, 2 ** 31 - 1],
        [-1, -1],
        [-7, 5],
      ] as const) {
        const v = lattice(x, y);
        expect(v, `${String(x)}, ${String(y)}`).toBe(hash(x, y));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
        // 24 bits: a 32-bit float holds the number exactly.
        expect(Number.isInteger(v * 2 ** 24)).toBe(true);
        expect(Math.fround(v)).toBe(v);
      }
      // The numbers spread over 0 to 1.
      const many = Array.from({ length: 4096 }, (_, i) => lattice(i % 64, Math.floor(i / 64)));
      const mean = many.reduce((sum, v) => sum + v, 0) / many.length;
      expect(mean).toBeGreaterThan(0.47);
      expect(mean).toBeLessThan(0.53);
      expect(new Set(many).size).toBeGreaterThan(4000);
    });

    it('has a whole number of steps of a lattice along each side of the grid, 1 at least', () => {
      expect([SLIME_WAVES, SLIME_BEADS, SLIME_RIPPLE]).toEqual([12, 7, 0.16]);
      // The side over the step, rounded to the nearest whole number.
      expect(patternSteps(64, 48, 12)).toEqual([5, 4]);
      expect(patternSteps(26, 17, 12)).toEqual([2, 1]);
      expect(patternSteps(64, 48, 7)).toEqual([9, 7]);
      expect(patternSteps(26, 17, 7)).toEqual([4, 2]);
      expect(patternSteps(1280, 720, 12)).toEqual([107, 60]);
      // Half way between two whole numbers: up. 30 / 12 = 2.5, 18 / 12 = 1.5, 42 / 12 = 3.5.
      expect(patternSteps(30, 18, 12)).toEqual([3, 2]);
      expect(patternSteps(42, 6, 12)).toEqual([4, 1]);
      // A grid that is smaller than half a step has one step.
      expect(patternSteps(5, 1, 12)).toEqual([1, 1]);
      expect(patternSteps(3, 2, 7)).toEqual([1, 1]);
    });

    it('has a noise that is the hash at the points of its lattice, flat there, and smooth between them', () => {
      const period = [5, 4] as const;
      for (const [x, y] of [
        [0, 0],
        [3, 2],
        [4, 3],
      ] as const) {
        const [v, gx, gy] = noiseSlope([x, y], period);
        expect(v).toBe(lattice(x, y));
        expect(gx === 0 && gy === 0).toBe(true);
      }
      // Half way between two points: their mean.
      expect(noiseSlope([3.5, 2], period)[0]).toBeCloseTo((lattice(3, 2) + lattice(4, 2)) / 2, 12);
      // The gradient is the change of the value: against the difference over a small step.
      const e = 1e-6;
      for (const [x, y] of [
        [0.3, 0.7],
        [2.91, 1.08],
        [4.5, 3.5],
        [-1.2, 7.7],
      ] as const) {
        const [, gx, gy] = noiseSlope([x, y], period);
        expect(gx).toBeCloseTo((noiseSlope([x + e, y], period)[0] - noiseSlope([x - e, y], period)[0]) / (2 * e), 5);
        expect(gy).toBeCloseTo((noiseSlope([x, y + e], period)[0] - noiseSlope([x, y - e], period)[0]) / (2 * e), 5);
      }
      // It repeats every `period` steps, and has no jump where it starts again.
      const [here, copy] = [noiseSlope([0.3, 0.7], period), noiseSlope([0.3 + 5, 0.7 - 8], period)];
      here.forEach((v, k) => {
        expect(copy[k]).toBeCloseTo(v, 9);
      });
      const [before, after] = [noiseSlope([5 - 1e-9, 1.3], period), noiseSlope([1e-9, 1.3], period)];
      before.forEach((v, k) => {
        expect(v).toBeCloseTo(after[k] ?? 0, 6);
      });
      // The value stays between the 4 hashes around a point: 0 to 1.
      for (let i = 0; i < 400; i++) {
        const [v] = noiseSlope([(i % 20) * 0.27, Math.floor(i / 20) * 0.23], period);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('has waves that are fixed in the grid, repeat with it and have no seam at its edge', () => {
      const [w, h] = [26, 17];
      const here = slimeWaves(w, h, [3.3, 4.4]);
      // 2 × 1 steps of the lattice on 26 × 17 cells: at a point of the lattice the wide noise is the hash, and the
      // waves are it and a quarter of the noise of twice the frequency, over 1.25.
      const fine = noiseSlope([19.7, 7.3], [4, 2])[0];
      expect(slimeWaves(w, h, [0, 0])[0]).toBeCloseTo((lattice(0, 0) + 0.25 * fine) / 1.25, 12);
      // The same point of the grid has the same waves, whatever a view shows.
      expect(slimeWaves(w, h, [3.3, 4.4])).toEqual(here);
      // They repeat with the grid, with their gradient.
      for (const [dx, dy] of [
        [w, 0],
        [0, h],
        [-3 * w, 2 * h],
      ] as const)
        slimeWaves(w, h, [3.3 + dx, 4.4 + dy]).forEach((v, k) => {
          expect(v).toBeCloseTo(here[k] ?? 0, 9);
        });
      // No seam: the value and the gradient just before the edge of the grid are those just after it.
      for (const [a, b] of [
        [
          [w - 1e-9, 5.2],
          [1e-9, 5.2],
        ],
        [
          [7.7, h - 1e-9],
          [7.7, 1e-9],
        ],
      ] as const)
        slimeWaves(w, h, a).forEach((v, k) => {
          expect(v).toBeCloseTo(slimeWaves(w, h, b)[k] ?? 0, 6);
        });
      // The gradient is the change per cell.
      const e = 1e-6;
      const [, gx, gy] = slimeWaves(w, h, [9.1, 11.6]);
      expect(gx).toBeCloseTo(
        (slimeWaves(w, h, [9.1 + e, 11.6])[0] - slimeWaves(w, h, [9.1 - e, 11.6])[0]) / (2 * e),
        5,
      );
      expect(gy).toBeCloseTo(
        (slimeWaves(w, h, [9.1, 11.6 + e])[0] - slimeWaves(w, h, [9.1, 11.6 - e])[0]) / (2 * e),
        5,
      );
      // The value stays within 0 to 1, and it is not flat.
      const values = Array.from(
        { length: 26 * 17 },
        (_, c) => slimeWaves(w, h, [(c % 26) + 0.5, Math.floor(c / 26) + 0.5])[0],
      );
      expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...values)).toBeLessThanOrEqual(1);
      expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.2);
    });

    it('has round beads at places that are fixed in the grid, in a quarter of the steps of their lattice', () => {
      // 210 × 140 cells: 30 × 20 steps of 7 cells.
      const [w, h] = [210, 140];
      const [nx, ny] = patternSteps(w, h, SLIME_BEADS);
      expect([nx, ny]).toEqual([30, 20]);
      const [sx, sy] = [w / nx, h / ny];
      /** Whether the step (x, y) of the lattice holds a bead. The lattice wraps with the grid. */
      const holds = (x: number, y: number) => lattice(((x + nx) % nx) + 7, ((y + ny) % ny) + 211) <= 0.25;
      const steps = Array.from({ length: nx * ny }, (_, i) => [i % nx, Math.floor(i / nx)] as const);
      const beads = steps.filter(([x, y]) => holds(x, y));
      // A quarter of the 600 steps, give or take.
      expect(beads.length).toBeGreaterThan(120);
      expect(beads.length).toBeLessThan(180);
      // The beads with no bead in a step beside theirs: no other bead lies over them.
      const around = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy] as const));
      const alone = beads.filter(([x, y]) =>
        around.every(([dx, dy]) => (dx === 0 && dy === 0) || !holds(x + dx, y + dy)),
      );
      expect(alone.length).toBeGreaterThan(5);
      for (const [x, y] of alone) {
        // The middle of the bead in cells, and its radius in steps of the lattice: 0.1 to 0.32.
        const middle = [(x + lattice(x, y)) * sx, (y + lattice(x + 57, y + 113)) * sy] as const;
        const r = 0.1 + 0.22 * lattice(x + 191, y + 31);
        expect(r).toBeGreaterThanOrEqual(0.1);
        expect(r).toBeLessThan(0.32);
        // In its middle the bead has the height 1 and no slope.
        const top = slimeBeads(w, h, middle);
        expect(top[0]).toBeCloseTo(1, 12);
        expect(Math.hypot(top[1], top[2])).toBeLessThan(1e-9);
        // Half way to its rim along x the height is (1 − 1/4)². It falls away from the middle by 1.5 / r per step
        // of the lattice, and a step is 7 cells.
        const side = slimeBeads(w, h, [middle[0] + 0.5 * r * sx, middle[1]]);
        expect(side[0]).toBeCloseTo(0.5625, 9);
        expect(side[1]).toBeCloseTo(-1.5 / r / sx, 9);
        expect(side[2]).toBeCloseTo(0, 9);
        // At its rim and beyond it: nothing.
        expect(slimeBeads(w, h, [middle[0] + 1.001 * r * sx, middle[1]])).toEqual([0, 0, 0]);
        expect(slimeBeads(w, h, [middle[0], middle[1] - 1.5 * r * sy])).toEqual([0, 0, 0]);
        // The bead repeats with the grid.
        expect(slimeBeads(w, h, [middle[0] - w, middle[1] + 2 * h])[0]).toBeCloseTo(1, 9);
      }
      // Most of the ground holds no bead, and there the height and the slope are 0.
      const points = Array.from({ length: w * h }, (_, c) =>
        slimeBeads(w, h, [(c % w) + 0.5, Math.floor(c / w) + 0.5]),
      );
      const bare = points.filter(([v]) => v === 0);
      expect(bare.length).toBeGreaterThan(points.length * 0.8);
      expect(bare.length).toBeLessThan(points.length);
      expect(bare.every(([, gx, gy]) => gx === 0 && gy === 0)).toBe(true);
      expect(points.every(([v]) => v >= 0 && v <= 1)).toBe(true);
    });
  });

  // Half way between the lamp, top left, and the eye, straight above: (−0.249, −0.332, 0.910).
  const toMid = Math.hypot(SUN[0], SUN[1], SUN[2] + 1);
  const mid = [SUN[0] / toMid, SUN[1] / toMid, (SUN[2] + 1) / toMid] as const;

  describe('the light on the film', () => {
    it('comes from the lamp of the gel and the walls', () => {
      expect(Math.hypot(...SUN)).toBeCloseTo(1, 12);
      expect(SUN[0] / SUN[2]).toBeCloseTo(-0.45 / 0.65, 12);
      expect(SUN[1] / SUN[2]).toBeCloseTo(-0.6 / 0.65, 12);
      expect(mid.map((v) => Math.round(v * 1000) / 1000)).toEqual([-0.249, -0.332, 0.91]);
    });

    it('is a small highlight and a wide light, which is 0 on a flat film', () => {
      // A flat film: the power 110 of 0.9097 is next to nothing, and the wide light is 0.
      const flat = wetShine([0, 0, 1]);
      expect(flat[0]).toBeCloseTo(mid[2] ** 110, 15);
      expect(flat[0]).toBeLessThan(1e-4);
      expect(flat[1]).toBe(0);
      // A slope that faces half way to the lamp: the full highlight, and the most of the wide light, 0.612.
      const lit = wetShine(mid);
      expect(lit[0]).toBeCloseTo(1, 12);
      expect(lit[1]).toBeCloseTo(1 - mid[2] ** 10, 12);
      expect(lit[1]).toBeCloseTo(0.612, 3);
      // A slope that faces away from the lamp: no highlight, and a wide light below 0, down to −0.388.
      const away = wetShine([0.6, 0.8, 0]);
      expect(away[0]).toBe(0);
      expect(away[1]).toBeCloseTo(-(mid[2] ** 10), 12);
      // The highlight is small: a normal 10 degrees beside that direction has less than a fifth of it, the power 110
      // of the cosine of 10 degrees, while the wide light still has three quarters of its most.
      const a = (10 * Math.PI) / 180;
      const beside = wetShine([
        mid[0] * Math.cos(a) + 0.8 * Math.sin(a),
        mid[1] * Math.cos(a) - 0.6 * Math.sin(a),
        mid[2] * Math.cos(a),
      ]);
      expect(beside[0]).toBeCloseTo(Math.cos(a) ** 110, 12);
      expect(beside[0]).toBeCloseTo(0.186, 3);
      expect(beside[1]).toBeCloseTo(Math.cos(a) ** 10 - mid[2] ** 10, 12);
      expect(beside[1] / lit[1]).toBeGreaterThan(0.75);
    });
  });

  describe('the ground with the film on it', () => {
    const size = [64, 48] as const;
    const p = [20.3, 11.7] as const;
    const bg: Rgb = [0.1, 0.2, 0.3];
    const dark: SlimeLook = {
      color: [0.5, 0.6, 0.7],
      body: 0.1,
      gloss: 0.5,
      wide: 0.2,
      relief: 2.5,
      bead: 0.11,
      stain: false,
    };
    const paper: SlimeLook = { ...dark, color: [0.3, 0.25, 0.2], body: 0.2, stain: true };
    const white: Rgb = [0.9, 0.85, 0.8];
    /** The waves at `p`: how many times as thick they make the film there, 0.84 to 1.16. */
    const wave = 1 + SLIME_RIPPLE * (2 * slimeWaves(size[0], size[1], p)[0] - 1);
    /** How much of its body a film of the thickness `h` shows at `p`: the thickness with its waves, to the power 1.6. */
    const depthOf = (h: number) => Math.min(h * wave, 1) ** 1.6;
    const flat = (h: number) => ({ h, g: [0, 0] as [number, number] });
    /**
     * A film of the thickness `h` whose surface faces half way to the lamp at `p`, zoomed out: the relief of 2.5 and
     * the waves make its gradient the slope of that direction.
     */
    const lit = (h: number) => ({
      h,
      g: [-mid[0] / (mid[2] * 2.5 * wave), -mid[1] / (mid[2] * 2.5 * wave)] as [number, number],
    });
    /** A film that rises toward the lamp, so that its surface faces away from it. */
    const away = (h: number) => ({ h, g: [-0.3, -0.4] as [number, number] });
    /** The highlight of a flat film: next to nothing. */
    const spark = mid[2] ** 110;
    const close = (got: Rgb, want: readonly number[], digits = 12) => {
      got.forEach((v, k) => {
        expect(v).toBeCloseTo(want[k] ?? 0, digits);
      });
    };

    it('has waves here that change the thickness by 16 % at most', () => {
      expect(wave).toBeGreaterThanOrEqual(0.84);
      expect(wave).toBeLessThanOrEqual(1.16);
      expect(wave).not.toBe(1);
    });

    it('is the ground itself without a film', () => {
      expect(slimed(bg, dark, flat(0), p, size, 1)).toEqual(bg);
      expect(slimed(white, paper, flat(0), p, size, 0.2)).toEqual(white);
      expect(slimed(bg, dark, { h: -0.1, g: [0.3, 0.3] }, p, size, 1)).toEqual(bg);
      // A new array: the ground that goes in stays as it is.
      expect(slimed(bg, dark, flat(0), p, size, 1)).not.toBe(bg);
    });

    it('adds the body of a flat film to a dark ground: thin slime is clear, and thick slime is milky', () => {
      // Zoomed out to 2 cells per pixel the waves have no slope and the beads are gone: the body alone, in the
      // colour of the film, and the little highlight of a flat film in white.
      for (const h of [1, 0.5, 0.1])
        close(
          slimed(bg, dark, flat(h), p, size, 2),
          bg.map((v, k) => v + (dark.color[k] ?? 0) * 0.1 * depthOf(h) + 0.5 * spark),
        );
      // Half the thickness shows a third of the body: 0.5 to the power 1.6.
      expect(0.5 ** 1.6).toBeCloseTo(0.33, 2);
      // The thickness with its waves counts up to 1: a film that is thicker shows the whole body.
      close(
        slimed(bg, dark, flat(1.5), p, size, 2),
        bg.map((v, k) => v + (dark.color[k] ?? 0) * 0.1 + 0.5 * spark),
      );
    });

    it('puts a highlight in white and a wide light in the colour of the film on a slope that faces the lamp', () => {
      // The full highlight, 0.5 of white for this look. The wide light is 0.612 there, and counts up to 0.5.
      close(
        slimed([0, 0, 0], dark, lit(1), p, size, 2),
        dark.color.map((c) => c * (0.1 * depthOf(1) + 0.2 * 0.5) + 0.5),
        9,
      );
      // The highlight is 0.8 at most, however strong a look makes it.
      close(
        slimed([0, 0, 0], { ...dark, gloss: 3 }, lit(1), p, size, 2),
        dark.color.map((c) => c * (0.1 * depthOf(1) + 0.2 * 0.5) + 0.8),
        9,
      );
      // Both lights fade in over the thinnest twentieth of the film: a film of 0.025 has half of each.
      close(
        slimed([0, 0, 0], dark, lit(0.025), p, size, 2),
        dark.color.map((c) => c * (0.1 * depthOf(0.025) + 0.2 * 0.5 * 0.5) + 0.25),
        9,
      );
      expect(depthOf(0.025)).toBeLessThan(0.004);
    });

    it('darkens a slope that faces away from the lamp, by 0.15 of the wide light at most, and never below black', () => {
      // The wide light is −0.388 there, and counts down to −0.15. No highlight.
      close(
        slimed(bg, dark, away(1), p, size, 2),
        bg.map((v, k) => v + (dark.color[k] ?? 0) * (0.1 * depthOf(1) - 0.2 * 0.15)),
        9,
      );
      // On a black ground a thin film on such a slope would go below black: it stays black.
      expect(0.1 * depthOf(0.06)).toBeLessThan(0.2 * 0.15);
      close(slimed([0, 0, 0], dark, away(0.06), p, size, 2), [0, 0, 0]);
    });

    it('draws the slope of the waves and the beads only up to 1.5 cells per pixel', () => {
      const [zoomed, between, out] = [1, 1.25, 1.5].map((scale) => slimed(bg, dark, flat(1), p, size, scale)) as [
        Rgb,
        Rgb,
        Rgb,
      ];
      // Zoomed out the film is flat to the light: the body, and the highlight of a flat film.
      close(
        out,
        bg.map((v, k) => v + (dark.color[k] ?? 0) * 0.1 * depthOf(1) + 0.5 * spark),
      );
      expect(slimed(bg, dark, flat(1), p, size, 4)).toEqual(out);
      // Up to 1 cell per pixel the waves tilt the surface, and the wide light shows it. Between, less of it.
      expect(slimed(bg, dark, flat(1), p, size, 0.1)).toEqual(zoomed);
      expect(Math.abs(zoomed[0] - out[0])).toBeGreaterThan(1e-4);
      expect(Math.sign(zoomed[0] - out[0])).toBe(Math.sign(between[0] - out[0]));
      expect(Math.abs(between[0] - out[0])).toBeLessThan(Math.abs(zoomed[0] - out[0]));
    });

    it('lets a bead only catch light, on slime that is thicker than 0.15', () => {
      // The first bead of the lattice of 64 × 48 cells, and a point on its slope toward the lamp, where it is a
      // quarter of its height.
      const [nx, ny] = patternSteps(64, 48, SLIME_BEADS);
      const steps = Array.from({ length: nx * ny }, (_, i) => [i % nx, Math.floor(i / nx)] as const);
      const [x, y] = at(
        steps.filter(([sx, sy]) => lattice(sx + 7, sy + 211) <= 0.25),
        0,
      );
      const r = 0.1 + 0.22 * lattice(x + 191, y + 31);
      const on = [
        ((x + lattice(x, y) - 0.5 * r) * 64) / nx,
        ((y + lattice(x + 57, y + 113) - 0.5 * r) * 48) / ny,
      ] as const;
      expect(slimeBeads(64, 48, on)[0]).toBeGreaterThanOrEqual(0.25 - 1e-9);
      const smooth = { ...dark, bead: 0 };
      const [beaded, plain] = [slimed(bg, dark, flat(1), on, size, 1), slimed(bg, smooth, flat(1), on, size, 1)];
      // The bead adds light and takes none away, and it adds the same white to every channel.
      expect(beaded[0]).toBeGreaterThan(plain[0] + 1e-3);
      expect(beaded[0] - plain[0]).toBeCloseTo(beaded[2] - plain[2], 12);
      // No bead on thin slime, and none from 1.5 cells per pixel on.
      expect(slimed(bg, dark, flat(0.15), on, size, 1)).toEqual(slimed(bg, smooth, flat(0.15), on, size, 1));
      expect(slimed(bg, dark, flat(1), on, size, 1.5)).toEqual(slimed(bg, smooth, flat(1), on, size, 1.5));
      // Thicker slime has more of the bead: at 0.3 it has half of its height.
      const half = slimed(bg, dark, flat(0.3), on, size, 1)[0] - slimed(bg, smooth, flat(0.3), on, size, 1)[0];
      expect(half).toBeGreaterThan(0);
    });

    it('is a wet stain on paper: its colour mixed into the paper, a tide line at its edge, and a darker side', () => {
      // A flat film zoomed out: the colour of the film mixed into the paper by the body, and the little highlight.
      const stain = (h: number, shade = 1) =>
        white.map((v, k) => (v + ((paper.color[k] ?? 0) - v) * 0.2 * depthOf(h)) * shade);
      for (const h of [1, 0.5])
        close(
          slimed(white, paper, flat(h), p, size, 2),
          stain(h).map((v) => v + (1 - v) * 0.5 * spark),
        );
      // The film darkens paper, and it lightens a dark ground.
      expect(slimed(white, paper, flat(1), p, size, 2)[0]).toBeLessThan(0.9);
      expect(slimed(bg, dark, flat(1), p, size, 2)[0]).toBeGreaterThan(0.1);
      // The tide line: a film of 0.04 to 0.05 is 4 % darker than its stain. The lights fade in up to 0.05: at
      // 0.045 the film has 0.972 of them.
      close(
        slimed(white, paper, flat(0.045), p, size, 2),
        stain(0.045, 0.96).map((v) => v + (1 - v) * 0.5 * spark * 0.972),
      );
      // From a thickness of 0.2 on the line is gone, and half way it is half as strong.
      close(
        slimed(white, paper, flat(0.2), p, size, 2),
        stain(0.2).map((v) => v + (1 - v) * 0.5 * spark),
      );
      close(
        slimed(white, paper, flat(0.125), p, size, 2),
        stain(0.125, 0.98).map((v) => v + (1 - v) * 0.5 * spark),
      );
      // The side away from the lamp is darker by the wide light, which counts down to −0.4 on paper: −0.388 here.
      close(slimed(white, paper, away(1), p, size, 2), stain(1, 1 - 0.2 * mid[2] ** 10), 6);
      // The side toward the lamp is lighter by 0.1 of the wide light at most, and has the highlight as white over
      // the stain; a highlight of 1 or more is white.
      close(
        slimed(white, paper, lit(1), p, size, 2),
        stain(1, 1 + 0.2 * 0.1).map((v) => v + (1 - v) * 0.5),
        9,
      );
      close(slimed(white, { ...paper, gloss: 3 }, lit(1), p, size, 2), [1, 1, 1], 9);
    });

    it('takes the numbers of a style from the renderer', () => {
      for (const style of STYLES) {
        const { color, body, gloss, wide } = SLIME_LOOK[style];
        expect(slimeLook(style)).toEqual({
          color: hexToLinear(color),
          body,
          gloss,
          wide,
          relief: SLIME_RELIEF,
          bead: SLIME_BEAD,
          stain: style === 'paper',
        });
      }
      expect([SLIME_RELIEF, SLIME_BEAD]).toEqual([2.5, 0.11]);
    });

    it('draws the film of the map of the level that a view reads, on the ground of the style', () => {
      const g = grid(64, 48);
      const cells = new Float32Array(64 * 48).fill(0.5);
      const coarse = new Float32Array(32 * 24).fill(1);
      for (const style of STYLES) {
        const ground = hexToLinear(BACKGROUND[style]);
        const look = slimeLook(style);
        // Up to 2 cells per pixel: the map of the cells.
        for (const scale of [0.25, 1, 1.9])
          close(slimeColour(style, g, cells, p, scale), slimed(ground, look, flat(0.5), p, size, scale));
        // From 2 cells per pixel on: the coarse map of the level 1, with texels of 2 cells.
        close(slimeColour(style, g, coarse, p, 2.5), slimed(ground, look, flat(1), p, size, 2.5));
        // Without slime: the ground of the style.
        expect(slimeColour(style, g, new Float32Array(64 * 48), p, 1)).toEqual(ground);
      }
    });
  });
});
