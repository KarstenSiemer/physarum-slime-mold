import { describe, expect, it } from 'vitest';
import { paintBox, paintSegments, scissorRects } from './brush';
import { paintReference } from './paint-reference';
import type { Stroke } from './types';

const stroke = (from: [number, number], to: [number, number], radius: number): Stroke => ({
  kind: 'food',
  from,
  to,
  radius,
});

describe('scissorRects', () => {
  it('covers the bounding box grown by one cell', () => {
    expect(scissorRects(stroke([10.5, 20.2], [14.1, 18], 2), 64, 48, true)).toEqual([[7, 15, 11, 9]]);
  });

  it('splits at the edges of a periodic grid and continues on the other side', () => {
    expect(scissorRects(stroke([1, 47], [1, 47], 2), 64, 48, true)).toEqual([
      [62, 44, 2, 4],
      [62, 0, 2, 2],
      [0, 44, 4, 4],
      [0, 0, 4, 2],
    ]);
  });

  it('cuts at the edges of a closed arena, and is empty outside it', () => {
    expect(scissorRects(stroke([1, 47], [1, 47], 2), 64, 48, false)).toEqual([[0, 44, 4, 4]]);
    expect(scissorRects(stroke([-9, 10], [-6, 10], 2), 64, 48, false)).toEqual([]);
  });

  it('takes the whole axis when the stroke is wider than the grid', () => {
    expect(scissorRects(stroke([-10, 5], [80, 5], 1), 64, 48, true)).toEqual([[0, 3, 64, 4]]);
  });

  // Every cell the reference paints lies in a rectangle, also across the edges.
  it('holds every cell the brush paints', () => {
    const [w, h] = [40, 30];
    for (const [from, to, r] of [
      [[0.3, 0.2], [0.3, 0.2], 5.5],
      [[39.9, 15], [2, 29.7], 3.2],
      [[20, -1], [21, 31], 0.75],
    ] as const) {
      const s = stroke([...from], [...to], r);
      const env = new Uint8Array(w * h * 4);
      paintReference(env, w, h, s, 'wrap');
      const rects = scissorRects(s, w, h, true);
      for (let c = 0; c < w * h; c++) {
        if (!env[c * 4 + 1]) continue;
        const [x, y] = [c % w, Math.floor(c / w)];
        expect(
          rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh),
          `${x}, ${y}`,
        ).toBe(true);
      }
    }
  });
});

describe('paintSegments', () => {
  it('keeps a stroke that starts inside the grid and spans at most half of it, and any stroke on a closed arena', () => {
    const s = stroke([60.5, 3.25], [90.25, 20], 2);
    expect(paintSegments(s, 64, 48, true)).toEqual([s]);
    const far = stroke([-300, 500], [-100, 900], 2);
    expect(paintSegments(far, 64, 48, false)).toEqual([far]);
  });

  it('moves a stroke on a copy of the grid by whole periods to start inside it', () => {
    expect(paintSegments(stroke([-130.5, 100], [-126.5, 98], 3), 64, 48, true)).toEqual([
      stroke([61.5, 4], [65.5, 2], 3),
    ]);
  });

  // The paint passes look for the nearest copy one period around a cell: exact for such parts (brush.ts).
  it('cuts a longer stroke into parts that each start inside the grid and span at most half of it', () => {
    const [w, h] = [64, 48];
    const s = stroke([-70.25, 10.5], [140.75, -60.5], 1.5);
    const parts = paintSegments(s, w, h, true);
    expect(parts).toHaveLength(Math.ceil(211 / 32));
    let end: [number, number] | undefined;
    for (const p of parts) {
      expect(p.from[0]).toBeGreaterThanOrEqual(0);
      expect(p.from[0]).toBeLessThan(w);
      expect(p.from[1]).toBeGreaterThanOrEqual(0);
      expect(p.from[1]).toBeLessThan(h);
      expect(Math.abs(p.to[0] - p.from[0])).toBeLessThanOrEqual(w / 2);
      expect(Math.abs(p.to[1] - p.from[1])).toBeLessThanOrEqual(h / 2);
      // Each part starts where the last one ended, up to whole periods.
      if (end)
        for (const [a, b, n] of [
          [p.from[0], end[0], w],
          [p.from[1], end[1], h],
        ] as const)
          expect((((a - b) % n) + n) % n).toBeCloseTo(0, 9);
      end = p.to;
    }
    // Together they paint what the stroke paints.
    const [whole, cut] = [new Uint8Array(w * h * 4), new Uint8Array(w * h * 4)];
    paintReference(whole, w, h, s, 'wrap');
    for (const p of parts) paintReference(cut, w, h, p, 'wrap');
    expect(Array.from(cut)).toEqual(Array.from(whole));
  });
});

describe('paintBox', () => {
  it('is the bounding box grown by one cell, cut to a closed arena and undefined outside it', () => {
    expect(paintBox(stroke([10.5, 20.2], [14.1, 18], 2), 64, 48, true)).toEqual([7, 15, 11, 9]);
    expect(paintBox(stroke([1, 47], [1, 47], 2), 64, 48, false)).toEqual([0, 44, 4, 4]);
    expect(paintBox(stroke([-9, 10], [-6, 10], 2), 64, 48, false)).toBeUndefined();
  });

  // A brush mapped from a coarse grid to a fine one can be many times the grid: one pass over the grid, not over the
  // brush's box, and on a periodic grid no cell twice.
  it('spans at most the grid', () => {
    expect(paintBox(stroke([32, 24], [32, 24], 5000), 64, 48, false)).toEqual([0, 0, 64, 48]);
    expect(paintBox(stroke([32, 24], [32, 24], 5000), 64, 48, true)).toEqual([-4969, -4977, 64, 48]);
  });

  // Every cell the reference paints lies in the box, wrapped into the grid on the periodic one.
  it('holds every cell the brush paints', () => {
    const [w, h] = [40, 30];
    for (const [from, to, r, wrap] of [
      [[0.3, 0.2], [0.3, 0.2], 5.5, true],
      [[39.9, 15], [22, 29.7], 3.2, true],
      [[20, 1], [21, 14], 30, true],
      [[38, 28], [41, 33], 4, false],
    ] as const) {
      const s = stroke([...from], [...to], r);
      const env = new Uint8Array(w * h * 4);
      paintReference(env, w, h, s, wrap ? 'wrap' : 'box');
      const box = paintBox(s, w, h, wrap);
      if (!box) throw new Error('no box');
      const [bx, by, bw, bh] = box;
      const inside = (v: number, lo: number, n: number, size: number) =>
        wrap ? (((v - lo) % size) + size) % size < n : v >= lo && v < lo + n;
      for (let c = 0; c < w * h; c++) {
        if (!env[c * 4 + 1]) continue;
        const [x, y] = [c % w, Math.floor(c / w)];
        expect(inside(x, bx, bw, w) && inside(y, by, bh, h), `${x}, ${y}`).toBe(true);
      }
    }
  });
});
