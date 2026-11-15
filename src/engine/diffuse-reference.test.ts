import { describe, expect, it } from 'vitest';
import { BOUNDARIES } from '../model/params';
import { CellKind, meanGrid, meanStep, separableMean, windowMean } from './diffuse-reference';

// ADR 0046: the passes take the mean over a window above 3 × 3 as two sums, along the rows and then along the columns.
// That is the mean over the window as the papers state it, with the rules of this app at sinks, walls and edges.
describe('the CPU reference of the mean window', () => {
  const [w, h] = [40, 33];
  /** A wall column, a wall dash at the edge, and a block of walls. */
  const env = new Uint8Array(w * h * 4);
  for (let y = 4; y < 28; y++) env[(y * w + 17) * 4] = 255;
  for (let x = 0; x < 6; x++) env[(32 * w + x) * 4] = 255;
  for (let y = 10; y < 14; y++) for (let x = 28; x < 33; x++) env[(y * w + x) * 4] = 255;
  let r = 7;
  const rnd = () => (r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const map = Float64Array.from({ length: w * h }, () => 100 * rnd());
  const maxDiff = (a: Float64Array, b: Float64Array) => Math.max(...Array.from(a, (v, i) => Math.abs(v - (b[i] ?? 0))));

  it.each(BOUNDARIES.flatMap((b) => [false, true].map((wallsDiffuse) => [b, wallsDiffuse] as const)))(
    'sums the rows and then the columns to the mean over the window (%s, walls diffuse %s)',
    (boundary, wallsDiffuse) => {
      const g = meanGrid(env, w, h, boundary, wallsDiffuse);
      for (const window of [3, 5, 7, 9, 11, 13, 15]) {
        const direct = windowMean(map, g, window);
        expect(maxDiff(separableMean(map, g, window), direct), `${window}`).toBeLessThan(1e-11);
        // A sink holds 0.
        g.kinds.forEach((k, c) => {
          if (k === CellKind.sink) expect(direct[c]).toBe(0);
        });
      }
    },
  );

  it('is the 3 × 3 mean of 9 cells for a window of 3, and the map itself for a window of 1', () => {
    const g = meanGrid(env, w, h, 'wrap', true);
    const three = windowMean(map, g, 3);
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) sum += map[((dy + h) % h) * w + ((dx + w) % w)] ?? 0;
    expect(three[0]).toBeCloseTo(sum / 9, 12);
    expect(maxDiff(windowMean(map, g, 1), map)).toBe(0);
  });

  it('keeps the sum on the periodic grid, and loses trail at a closed edge', () => {
    const total = (m: Float64Array) => m.reduce((a, v) => a + v, 0);
    const none = new Uint8Array(w * h * 4);
    for (const window of [5, 15]) {
      const torus = meanGrid(none, w, h, 'wrap', true);
      expect(total(windowMean(map, torus, window)) / total(map)).toBeCloseTo(1, 12);
      const box = meanGrid(none, w, h, 'box', true);
      expect(total(windowMean(map, box, window))).toBeLessThan(0.99 * total(map));
      // A cell in the corner of a box divides by all cells of the window: a map of ones gives less than 1 there.
      const rim = windowMean(new Float64Array(w * h).fill(1), box, window);
      const half = (window + 1) / 2;
      expect(rim[0]).toBeCloseTo((half * half) / (window * window), 12);
      expect(rim[Math.floor(h / 2) * w + Math.floor(w / 2)]).toBeCloseTo(1, 12);
    }
  });

  it('adds the sources after the decay moving first, and before the mean sensing first, on open cells only', () => {
    const g = meanGrid(env, w, h, 'box', true);
    const zero = new Float64Array(w * h);
    const moved = meanStep(zero, g, 5, 0.9, () => 2, 'move-first');
    const sensed = meanStep(zero, g, 5, 0.9, () => 2, 'sense-first');
    const open = 20 * w + 5;
    const wall = 20 * w + 17;
    expect(moved[open]).toBe(2);
    expect(moved[wall]).toBe(0);
    expect(sensed[open]).toBeCloseTo(0.9 * 2, 12);
    // The wall takes no source, but the mean brings the sources of the cells around it: 4 of its 5 columns are open.
    expect(sensed[wall]).toBeCloseTo(0.9 * 2 * 0.8, 12);
    expect(meanStep(zero, g, 5, 0.9, () => 2, 'sense-first', separableMean)[wall]).toBeCloseTo(0.9 * 2 * 0.8, 12);
  });
});
