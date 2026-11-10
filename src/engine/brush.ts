import type { Boundary } from '../model/params';
import { periods } from './environment';
import type { EnvTool, Stroke } from './types';

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
 * Whether a cell `d` cells from a stroke of `kind` and radius `r` gets painted, with the edge of the brush moved out
 * by `slack` cells (in, if negative): within the radius, and for light where its byte is at least 1.
 */
export function reaches(kind: EnvTool, d: number, r: number, slack: number) {
  return kind === 'light' ? lightByte(d - slack, r) >= 1 : d <= r + slack;
}

/**
 * The range of x in which the line at height `y` lies within `reach` of the segment from `a` to `b`, or undefined.
 * The points within reach form a convex capsule: two discs and the band between them.
 */
function rowSpan(y: number, a: Point, b: Point, reach: number): [number, number] | undefined {
  let [lo, hi] = [Infinity, -Infinity];
  for (const c of [a, b]) {
    const dy = y - c[1];
    if (Math.abs(dy) > reach) continue;
    const dx = Math.sqrt(reach * reach - dy * dy);
    [lo, hi] = [Math.min(lo, c[0] - dx), Math.max(hi, c[0] + dx)];
  }
  const [ux, uy] = [b[0] - a[0], b[1] - a[1]];
  const length = Math.hypot(ux, uy);
  if (length > 0) {
    // Along the segment 0 ≤ s ≤ length, across it |q| ≤ reach; both are linear in x on the line.
    const [sx, s0] = [ux / length, ((y - a[1]) * uy) / length];
    const [qx, q0] = [-uy / length, ((y - a[1]) * ux) / length];
    let [l, h] = [-Infinity, Infinity];
    for (const [k, v0, min, max] of [
      [sx, s0, 0, length],
      [qx, q0, -reach, reach],
    ] as const) {
      if (Math.abs(k) < 1e-12) {
        if (v0 < min || v0 > max) [l, h] = [Infinity, -Infinity];
        continue;
      }
      const [e0, e1] = [a[0] + (min - v0) / k, a[0] + (max - v0) / k];
      [l, h] = [Math.max(l, Math.min(e0, e1)), Math.min(h, Math.max(e0, e1))];
    }
    if (l <= h) [lo, hi] = [Math.min(lo, l), Math.max(hi, h)];
  }
  return lo <= hi ? [lo, hi] : undefined;
}

/**
 * Whether `test` holds for a cell that a stroke paints on a `w` × `h` grid, under the stroke's boundary or else
 * `boundary`, like Array.prototype.some: it stops at the first such cell. A cell is painted by the rule of the paint
 * passes: a cell of the arena whose centre lies within the radius of the segment, on a periodic grid of its nearest
 * copy, and for light one whose byte is at least 1. `slack` moves the edge of the brush and the rim of a dish out by
 * that many cells, or in if it is negative. The cells under the two ends come first, and those come again later.
 * Rows are visited where they cross the stroke, so a long diagonal stroke costs its own cells, not its bounding box.
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
  const reach = r + Math.max(0, slack);
  const at = (x: number, y: number, a: Point, b: Point) => {
    const c = cellIndex(x, y, w, h, under, slack);
    return c >= 0 && reaches(kind, segmentDistance(x + 0.5, y + 0.5, a, b), r, slack) && test(c);
  };
  // Every cell whose centre lies within reach of the segment in rows y0 to y1 and columns x0 to x1.
  const rows = (a: Point, b: Point, [x0, y0, x1, y1]: [number, number, number, number]) => {
    for (let y = y0; y <= y1; y++) {
      const span = rowSpan(y + 0.5, a, b, reach);
      if (!span) continue;
      for (let x = Math.max(x0, Math.floor(span[0] - 0.5)); x <= Math.min(x1, Math.ceil(span[1] - 0.5)); x++)
        if (at(x, y, a, b)) return true;
    }
    return false;
  };
  const { from: a, to: b } = stroke;
  if (at(Math.floor(a[0]), Math.floor(a[1]), a, b) || at(Math.floor(b[0]), Math.floor(b[1]), a, b)) return true;
  if (under !== 'wrap') {
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - reach));
    return rows(a, b, [0, y0, w - 1, Math.min(h - 1, Math.ceil(Math.max(a[1], b[1]) + reach))]);
  }
  // As the paint passes do: parts that start inside the grid and span at most half of it, each over a box of one
  // period at most (paintBox()).
  for (const part of paintSegments(stroke, w, h, true)) {
    const box = paintBox(part, w, h, true);
    if (!box) continue;
    const [bx, by, bw, bh] = box;
    const [p, q] = [part.from, part.to];
    if (bw < w && bh < h) {
      // The box holds the part and its brush once, so no two copies reach the same cell: the distance to the part
      // in the box's own coordinates is the distance to the nearest copy, and those coordinates wrap into the grid.
      const inBox = (x: number, y: number) =>
        reaches(kind, segmentDistance(x + 0.5, y + 0.5, p, q), r, slack) && test(cellIndex(x, y, w, h, 'wrap'));
      for (let y = by; y < by + bh; y++) {
        const span = rowSpan(y + 0.5, p, q, reach);
        if (!span) continue;
        for (let x = Math.max(bx, Math.floor(span[0] - 0.5)); x <= Math.min(bx + bw - 1, Math.ceil(span[1] - 0.5)); x++)
          if (inBox(x, y)) return true;
      }
      continue;
    }
    // A brush that spans the grid: every cell of the box, with the distance to the nearest copy one period around.
    for (let j = 0; j < bh; j++)
      for (let i = 0; i < bw; i++) {
        const [x, y] = [(((bx + i) % w) + w) % w, (((by + j) % h) + h) % h];
        let d = segmentDistance(x + 0.5, y + 0.5, p, q);
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) d = Math.min(d, segmentDistance(x + 0.5 + ox * w, y + 0.5 + oy * h, p, q));
        if (reaches(kind, d, r, slack) && test(y * w + x)) return true;
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
