import type { Stroke } from './types';

/** A rectangle of cells: x, y, width, height (rows from y = 0, as gl.scissor takes them). */
export type Rect = [number, number, number, number];

/**
 * The cells a brush stroke can paint, as rectangles inside a `w` × `h` grid: the stroke's bounding box grown by
 * one cell, cut at the grid's edges, or with `wrap` split at them and continued on the other side. WebGL2 scissors
 * the paint pass to them (gl/sim.ts), so a stroke costs fragments for its own cells and not for the whole grid.
 */
export function scissorRects({ from: a, to: b, radius: r }: Stroke, w: number, h: number, wrap: boolean): Rect[] {
  const span = (lo: number, hi: number, n: number): [number, number][] => {
    if (hi - lo >= n) return [[0, n]];
    if (!wrap) {
      const [s, e] = [Math.max(0, lo), Math.min(n, hi)];
      return e > s ? [[s, e]] : [];
    }
    const s = ((lo % n) + n) % n;
    const e = s + hi - lo;
    return e <= n
      ? [[s, e]]
      : [
          [s, n],
          [0, e - n],
        ];
  };
  const xs = span(Math.floor(Math.min(a[0], b[0]) - r) - 1, Math.ceil(Math.max(a[0], b[0]) + r) + 1, w);
  const ys = span(Math.floor(Math.min(a[1], b[1]) - r) - 1, Math.ceil(Math.max(a[1], b[1]) + r) + 1, h);
  return xs.flatMap(([x0, x1]) => ys.map(([y0, y1]): Rect => [x0, y0, x1 - x0, y1 - y0]));
}
