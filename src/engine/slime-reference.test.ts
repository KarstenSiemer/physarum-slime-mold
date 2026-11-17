import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings } from '../model/params';
import { at } from './at';
import { trailLevels } from './flow';
import type { FlowGrid } from './flow-reference';
import { stampOf, STEPS_PER_HOUR } from './slime';
import { hasSlime, holdsPlasm, slimeLayer, slimeStep, slimeStrength, type SlimeSettings } from './slime-reference';

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

  // Decision 8: how the picture reads the field between the cells and zoomed out. `step` 0 and a long life time: a
  // cell with the stamp of step 0 has the strength 1.
  describe('the strength of the layer at a point of the picture', () => {
    const life = 1000;
    /** A field with the stamp of step 0 in the cells of `at`, each a column and a row. */
    const field = (width: number, height: number, at: readonly (readonly [number, number])[]) => {
      const stamps = new Uint32Array(width * height);
      for (const [x, y] of at) stamps[y * width + x] = stampOf(0);
      return stamps;
    };
    const grid = (width: number, height: number, boundary: Settings['boundary'] = 'box') => ({
      width,
      height,
      boundary,
    });
    const one = field(8, 6, [[3, 2]]);

    it('is the strength of a cell at its centre, and bilinear between the centres of four cells', () => {
      const look = (x: number, y: number) => slimeLayer(one, grid(8, 6), 0, life, [x, y], 0.25, 0);
      expect(look(3.5, 2.5)).toBe(1);
      // Half way to the cell beside it, and at the corner of four cells.
      expect(look(4, 2.5)).toBe(0.5);
      expect(look(3.5, 2)).toBe(0.5);
      expect(look(4, 3)).toBe(0.25);
      expect(look(3.75, 2.5)).toBe(0.75);
      // From the centre of the next cell on: nothing.
      expect(look(4.5, 2.5)).toBe(0);
      expect(look(5.2, 2.5)).toBe(0);
      // The same at 1 cell per pixel.
      expect(slimeLayer(one, grid(8, 6), 0, life, [4, 3], 1, 0)).toBe(0.25);
    });

    it('blends the strengths of old and new slime, never their stamps', () => {
      const stamps = new Uint32Array(8 * 6);
      // New slime beside slime of three quarters of the life time, beside a cell without slime, after 750 steps.
      stamps.set([stampOf(750), stampOf(0), 0], 2 * 8 + 3);
      const look = (x: number) => slimeLayer(stamps, grid(8, 6), 750, life, [x, 2.5], 0.25, 0);
      expect([look(3.5), look(4.5), look(5.5)]).toEqual([1, 0.25, 0]);
      expect(look(4)).toBe(0.625);
      // Half of the old slime. The mean of the stamps 1 and 0 would be slime of 750 steps: 0.25 at this point.
      expect(look(5)).toBe(0.125);
    });

    it('is the mean over the square of the pixel from 1 to 2 cells per pixel', () => {
      // A pixel of 1.5 cells on the centre of the cell: the cell, and a quarter of each cell beside it, per axis.
      const middle = slimeLayer(one, grid(8, 6), 0, life, [3.5, 2.5], 1.5, 0);
      expect(middle).toBeCloseTo((1 / 1.5) ** 2, 12);
      // The same pixel one cell to the right holds a quarter of the cell in one axis.
      expect(slimeLayer(one, grid(8, 6), 0, life, [4.5, 2.5], 1.5, 0)).toBeCloseTo((0.25 / 1.5) * (1 / 1.5), 12);
      // The mean of a field with slime everywhere is 1, and that of two cells of four is one half.
      const all = field(
        8,
        6,
        Array.from({ length: 48 }, (_, c) => [c % 8, Math.floor(c / 8)] as const),
      );
      expect(slimeLayer(all, grid(8, 6, 'wrap'), 0, life, [0.3, 0.2], 1.7, 0)).toBeCloseTo(1, 12);
      const pair = field(8, 6, [
        [2, 2],
        [3, 3],
      ]);
      expect(slimeLayer(pair, grid(8, 6), 0, life, [3, 3], 1.999, 0)).toBeCloseTo(0.5, 2);
    });

    it('takes the cell in the middle of a texel for the texel, zoomed out past 2 cells per pixel', () => {
      // Level 1 on 8 × 6 cells: texels of 2 × 2 cells, and the cell (2 t + 1) stands for the texel t.
      const look = (stamps: Uint32Array, x: number, y: number) => slimeLayer(stamps, grid(8, 6), 0, life, [x, y], 2, 1);
      // A pixel of 2 cells on the texel (1, 1), the cells 2 to 3: its middle cell (3, 3) is the whole pixel.
      expect(look(field(8, 6, [[3, 3]]), 3, 3)).toBe(1);
      for (const other of [
        [2, 2],
        [3, 2],
        [2, 3],
      ] as const)
        expect(look(field(8, 6, [other]), 3, 3)).toBe(0);
      // The pixel on the corner of four texels holds a quarter of each.
      expect(look(field(8, 6, [[3, 3]]), 4, 4)).toBe(0.25);
      expect(look(field(8, 6, [[5, 3]]), 4, 4)).toBe(0.25);
      // A side that 4 does not divide: 26 cells are 7 texels of level 2, and the middle cells are whole numbers. The
      // 4 rows are one texel, with the row 2 in its middle.
      const middles = [1, 5, 9, 13, 16, 20, 24];
      middles.forEach((x, t) => {
        // A pixel of 26 / 7 cells on the texel t.
        const at = ((t + 0.5) * 26) / 7;
        const seen = (cell: number) => slimeLayer(field(26, 4, [[cell, 2]]), grid(26, 4), 0, life, [at, 2], 26 / 7, 2);
        expect(seen(x), `texel ${String(t)}`).toBeCloseTo(1, 12);
        expect(seen(x - 1) + seen(x + 1), `texel ${String(t)}`).toBeCloseTo(0, 12);
      });
    });

    it('repeats on the periodic grid, and is 0 outside a closed arena', () => {
      // The four cells in the corner of the grid: the texel (0, 0) of level 1, with the cell (1, 1) in its middle.
      const corner = field(8, 6, [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]);
      for (const [scale, level] of [
        [0.5, 0],
        [1.5, 0],
        [3, 1],
      ] as const) {
        const look = (boundary: Settings['boundary'], x: number, y: number) =>
          slimeLayer(corner, grid(8, 6, boundary), 0, life, [x, y], scale, level);
        const here = look('wrap', 0.4, 0.3);
        expect(here).toBeGreaterThan(0);
        for (const [dx, dy] of [
          [8, 0],
          [0, 6],
          [-8, -6],
          [80, 60],
          [-800, 600],
        ] as const)
          expect(look('wrap', 0.4 + dx, 0.3 + dy)).toBeCloseTo(here, 9);
        // The corner reaches across the seam to the last column and row of the periodic grid.
        expect(look('wrap', 7.9, 5.9)).toBeGreaterThan(0);
        expect(look('box', 7.9, 5.9)).toBe(0);
        expect(look('dish', 8.4, 0.3)).toBe(0);
        expect(look('box', -5, -5)).toBe(0);
      }
    });
  });
});
