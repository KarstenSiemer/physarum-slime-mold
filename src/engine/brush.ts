import type { Boundary } from '../model/params';
import { periods } from './environment';
import type { Stroke } from './types';

/** Distance from (px, py) to the segment from `a` to `b`, as the paint passes measure it. */
export function segmentDistance(px: number, py: number, a: [number, number], b: [number, number]) {
  const [abx, aby] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.min(1, Math.max(0, ((px - a[0]) * abx + (py - a[1]) * aby) / Math.max(abx * abx + aby * aby, 1e-6)));
  return Math.hypot(px - a[0] - t * abx, py - a[1] - t * aby);
}

/** Index of a cell, wrapped for the periodic boundary, or −1 outside a closed arena (common.wgsl `cellAt`). */
export function cellIndex(x: number, y: number, w: number, h: number, boundary: Boundary) {
  if (boundary === 'wrap') return (((y % h) + h) % h) * w + (((x % w) + w) % w);
  if (x < 0 || y < 0 || x >= w || y >= h) return -1;
  if (boundary === 'dish' && Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) > Math.min(w, h) / 2 - 1) return -1;
  return y * w + x;
}

/**
 * Whether a stroke paints at least one cell of a `w` × `h` grid under `boundary`: a cell of the arena whose centre
 * lies within the radius of the segment, the rule of the paint passes. Under the periodic boundary every brush of
 * MIN_RADIUS (environment.ts) or more paints: every point lies within 0.71 cells of a cell centre.
 */
export function paintsCell(stroke: Stroke, w: number, h: number, boundary: Boundary): boolean {
  const { from: a, to: b, radius: r } = stroke;
  const under = stroke.boundary ?? boundary;
  if (under === 'wrap') return true;
  const [ax, ay] = [Math.floor(a[0]), Math.floor(a[1])];
  if (cellIndex(ax, ay, w, h, under) >= 0 && segmentDistance(ax + 0.5, ay + 0.5, a, b) <= r) return true;
  const [x0, x1] = [
    Math.max(0, Math.floor(Math.min(a[0], b[0]) - r)),
    Math.min(w - 1, Math.ceil(Math.max(a[0], b[0]) + r)),
  ];
  const [y0, y1] = [
    Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)),
    Math.min(h - 1, Math.ceil(Math.max(a[1], b[1]) + r)),
  ];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (cellIndex(x, y, w, h, under) >= 0 && segmentDistance(x + 0.5, y + 0.5, a, b) <= r) return true;
  return false;
}

/** A rectangle of cells: x, y, width, height (rows from y = 0, as gl.scissor takes them). */
export type Rect = [number, number, number, number];

/**
 * A stroke as segments that both paint passes paint exactly (shaders/paint.wgsl, gl/glsl/paint.frag). On a periodic
 * grid they measure each cell's distance to the stroke and to its copies one period away in every direction. That
 * finds the nearest copy when the segment starts inside the grid and spans at most half of it along each axis. So a
 * longer segment is cut into parts, and each part is moved by whole periods to start inside the grid. Painting the
 * parts paints the stroke: a cell's distance to the stroke is its smallest distance to a part. On a closed arena the
 * stroke is painted as it is.
 */
export function paintSegments(stroke: Stroke, w: number, h: number, wrap: boolean): Stroke[] {
  if (!wrap) return [stroke];
  const [a, b] = [stroke.from, stroke.to];
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const n = Math.max(1, Math.ceil(Math.abs(dx) / (w / 2)), Math.ceil(Math.abs(dy) / (h / 2)));
  if (n === 1 && a[0] >= 0 && a[0] < w && a[1] >= 0 && a[1] < h) return [stroke]; // the usual stroke
  const at = (k: number): [number, number] => (k === n ? b : [a[0] + (dx * k) / n, a[1] + (dy * k) / n]);
  return Array.from({ length: n }, (_, k) => {
    const [p, q] = [at(k), at(k + 1)];
    const [sx, sy] = [periods(p[0], w), periods(p[1], h)];
    return { ...stroke, from: [p[0] - sx, p[1] - sy], to: [q[0] - sx, q[1] - sy] };
  });
}

/**
 * The cells a segment from paintSegments() can paint, as one box to dispatch over (sim.ts paint()): its bounding box
 * grown by one cell, cut to the grid on a closed arena, and on a periodic grid to one period per axis, so that no
 * cell is visited twice and a brush larger than the grid costs one pass over the grid. The paint pass wraps the box's
 * cells into the grid. Undefined if the segment lies outside a closed arena.
 */
export function paintBox({ from: a, to: b, radius: r }: Stroke, w: number, h: number, wrap: boolean): Rect | undefined {
  const axis = (lo: number, hi: number, n: number): [number, number] | undefined => {
    if (wrap) return [lo, Math.min(hi - lo, n)];
    const [s, e] = [Math.max(0, lo), Math.min(n, hi)];
    return e > s ? [s, e - s] : undefined;
  };
  const x = axis(Math.floor(Math.min(a[0], b[0]) - r) - 1, Math.ceil(Math.max(a[0], b[0]) + r) + 1, w);
  const y = axis(Math.floor(Math.min(a[1], b[1]) - r) - 1, Math.ceil(Math.max(a[1], b[1]) + r) + 1, h);
  return x && y ? [x[0], y[0], x[1], y[1]] : undefined;
}

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
