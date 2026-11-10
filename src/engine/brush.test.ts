import { describe, expect, it } from 'vitest';
import { scissorRects } from './brush';
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
