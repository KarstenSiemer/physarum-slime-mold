import type { Boundary } from '../model/params';
import { periods } from './environment';
import type { Stroke } from './types';

type Point = [number, number];

/** Distance from (px, py) to the segment from `a` to `b`, as the paint passes measure it. */
export function segmentDistance(px: number, py: number, a: [number, number], b: [number, number]) {
  const [abx, aby] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.min(1, Math.max(0, ((px - a[0]) * abx + (py - a[1]) * aby) / Math.max(abx * abx + aby * aby, 1e-6)));
  return Math.hypot(px - a[0] - t * abx, py - a[1] - t * aby);
}

/**
 * Cells by which float32 on the GPU may decide a cell otherwise than the CPU, at the edge of a brush and at the rim
 * of a dish: a distance there is rounded to 24 bits, and on a 237 × 512 dish six rim cells lie exactly at its radius.
 * A judgement on the CPU that the GPU must share keeps this margin.
 */
export const SLACK = 0.01;

/**
 * Index of a cell, wrapped for the periodic boundary, or −1 outside a closed arena (common.wgsl `cellAt`). `slack`
 * moves the rim of a dish out by that many cells, or in if it is negative.
 */
export function cellIndex(x: number, y: number, w: number, h: number, boundary: Boundary, slack = 0) {
  if (boundary === 'wrap') return (((y % h) + h) % h) * w + (((x % w) + w) % w);
  if (x < 0 || y < 0 || x >= w || y >= h) return -1;
  if (boundary === 'dish' && Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) > Math.min(w, h) / 2 - 1 + slack) return -1;
  return y * w + x;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The light byte of a cell `d` cells from a light stroke of radius `r`: the soft edge of both paint passes, stored as
 * pack4x8unorm stores it. In the outer 1.8 % of the radius it rounds to 0, and the cell keeps its light.
 */
export function lightByte(d: number, r: number) {
  return Math.floor(0.5 + 255 * smoothstep(r, 0.3 * r, d));
}

/**
 * Whether `test` holds for a cell that a stroke paints on a `w` × `h` grid, under the stroke's boundary or else
 * `boundary`, like Array.prototype.some: it stops at the first such cell. A cell is painted by the rule of the paint
 * passes: a cell of the arena whose centre lies within the radius of the segment, on a periodic grid of its nearest
 * copy, and for light one whose byte is at least 1. `slack` moves the edge of the brush and the rim of a dish out by
 * that many cells, or in if it is negative. The cells under the two ends come first, and a cell can come twice.
 */
export function someCell(
  stroke: Stroke,
  w: number,
  h: number,
  boundary: Boundary,
  slack: number,
  test: (cell: number) => boolean,
): boolean {
  const { kind, radius: r } = stroke;
  const under = stroke.boundary ?? boundary;
  const paints = (d: number) => (kind === 'light' ? lightByte(d - slack, r) >= 1 : d <= r + slack);
  const at = (x: number, y: number, a: Point, b: Point) => {
    const c = cellIndex(x, y, w, h, under, slack);
    return c >= 0 && paints(segmentDistance(x + 0.5, y + 0.5, a, b)) && test(c);
  };
  const { from: a, to: b } = stroke;
  if (at(Math.floor(a[0]), Math.floor(a[1]), a, b) || at(Math.floor(b[0]), Math.floor(b[1]), a, b)) return true;
  const reach = r + Math.max(0, slack);
  if (under !== 'wrap') {
    const [x0, x1] = [Math.max(0, Math.floor(Math.min(a[0], b[0]) - reach)), Math.ceil(Math.max(a[0], b[0]) + reach)];
    const [y0, y1] = [Math.max(0, Math.floor(Math.min(a[1], b[1]) - reach)), Math.ceil(Math.max(a[1], b[1]) + reach)];
    for (let y = y0; y <= Math.min(h - 1, y1); y++)
      for (let x = x0; x <= Math.min(w - 1, x1); x++) if (at(x, y, a, b)) return true;
    return false;
  }
  // As the paint passes do: parts that start inside the grid and span at most half of it, each over one period at
  // most, with the distance to the nearest copy one period around.
  for (const part of paintSegments(stroke, w, h, true)) {
    const box = paintBox(part, w, h, true);
    if (!box) continue;
    const [bx, by, bw, bh] = box;
    const [p, q] = [part.from, part.to];
    // Where the brush stays inside the grid, no copy comes near enough to paint a cell (paint.wgsl).
    const inside =
      Math.min(p[0], q[0]) - reach >= 0 &&
      Math.min(p[1], q[1]) - reach >= 0 &&
      Math.max(p[0], q[0]) + reach <= w &&
      Math.max(p[1], q[1]) + reach <= h;
    for (let j = 0; j < bh; j++)
      for (let i = 0; i < bw; i++) {
        const [x, y] = [(((bx + i) % w) + w) % w, (((by + j) % h) + h) % h];
        let d = segmentDistance(x + 0.5, y + 0.5, p, q);
        if (!inside)
          for (let oy = -1; oy <= 1; oy++)
            for (let ox = -1; ox <= 1; ox++) d = Math.min(d, segmentDistance(x + 0.5 + ox * w, y + 0.5 + oy * h, p, q));
        if (paints(d) && test(y * w + x)) return true;
      }
  }
  return false;
}

/**
 * Whether a stroke clearly paints at least one cell of a `w` × `h` grid under `boundary` (someCell()): a cell inside
 * the brush and the rim of a dish by SLACK, and for light one whose byte is at least 1. A stroke that paints only
 * cells nearer the edge than that may paint none of them on the GPU in float32: it is neither recorded nor painted
 * (Engine.paint), so the simulation and the edit list agree.
 */
export function paintsCell(stroke: Stroke, w: number, h: number, boundary: Boundary): boolean {
  return someCell(stroke, w, h, boundary, -SLACK, () => true);
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
