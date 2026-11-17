import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings } from '../model/params';
import { at } from './at';
import { trailLevels } from './flow';
import type { FlowGrid } from './flow-reference';
import { stampOf, STEPS_PER_HOUR } from './slime';
import { hasSlime, holdsPlasm, slimeStep, type SlimeSettings } from './slime-reference';

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
});
