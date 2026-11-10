import type { Boundary } from '../model/params';
import { periods } from './environment';
import { SHAPE_RANGE, type EnvTool, type Stroke } from './types';

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
 * Light gets a byte of at least 1 within this share of its radius: there smoothstep's t falls to the t of byte 0.5,
 * the root of 3t² − 2t³ = 1/510 (lightByte()), and t = 1 − d / r over the soft edge's 0.7 of the radius.
 */
const LIT = (() => {
  let t = 0.0258;
  for (let k = 0; k < 8; k++) t -= (3 * t * t - 2 * t * t * t - 1 / 510) / (6 * t - 6 * t * t);
  return 1 - 0.7 * t;
})();

/** The distance within which a stroke of `kind` and radius `r` paints a cell by reaches(), with `slack`. */
export function reachOf(kind: EnvTool, r: number, slack: number) {
  return (kind === 'light' ? r * LIT : r) + slack;
}

/** A segment from (ax, ay) to (bx, by) for rowSpan(): its length, unit direction (ex, ey) and their reciprocals. */
interface Line {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  length: number;
  ex: number;
  ey: number;
  /** 1 / ex and −1 / ey, or 0 where the direction is within 1e-12 of an axis. */
  alongInv: number;
  acrossInv: number;
}

function lineOf([ax, ay]: Point, [bx, by]: Point): Line {
  const length = Math.hypot(bx - ax, by - ay);
  const [ex, ey] = length > 0 ? [(bx - ax) / length, (by - ay) / length] : [0, 0];
  return {
    ax,
    ay,
    bx,
    by,
    length,
    ex,
    ey,
    alongInv: Math.abs(ex) < 1e-12 ? 0 : 1 / ex,
    acrossInv: Math.abs(ey) < 1e-12 ? 0 : -1 / ey,
  };
}

/**
 * The range of x in which the line at height `y` lies within `reach` of segment `l`, written to `out`; false if there
 * is none. The points within reach form a convex capsule: two discs and the band between them. Scalars only: the
 * sweep calls it for every row it judges.
 */
function rowSpan(y: number, l: Line, reach: number, out: [number, number]): boolean {
  let lo = Infinity;
  let hi = -Infinity;
  const da = y - l.ay;
  const db = y - l.by;
  if (Math.abs(da) <= reach) {
    const dx = Math.sqrt(reach * reach - da * da);
    lo = l.ax - dx;
    hi = l.ax + dx;
  }
  if (Math.abs(db) <= reach) {
    const dx = Math.sqrt(reach * reach - db * db);
    lo = Math.min(lo, l.bx - dx);
    hi = Math.max(hi, l.bx + dx);
  }
  if (l.length > 0) {
    // Along the segment 0 ≤ s ≤ length, across it |q| ≤ reach; both are linear in x on the line.
    let lb = -Infinity;
    let hb = Infinity;
    const s0 = da * l.ey;
    if (l.alongInv === 0) {
      if (s0 < 0 || s0 > l.length) [lb, hb] = [Infinity, -Infinity];
    } else {
      const [e0, e1] = [l.ax - s0 * l.alongInv, l.ax + (l.length - s0) * l.alongInv];
      lb = Math.min(e0, e1);
      hb = Math.max(e0, e1);
    }
    const q0 = da * l.ex;
    if (l.acrossInv === 0) {
      if (q0 < -reach || q0 > reach) [lb, hb] = [Infinity, -Infinity];
    } else {
      const [e0, e1] = [l.ax + (-reach - q0) * l.acrossInv, l.ax + (reach - q0) * l.acrossInv];
      lb = Math.max(lb, Math.min(e0, e1));
      hb = Math.min(hb, Math.max(e0, e1));
    }
    if (lb <= hb) {
      lo = Math.min(lo, lb);
      hi = Math.max(hi, hb);
    }
  }
  out[0] = lo;
  out[1] = hi;
  return lo <= hi;
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
  const span: [number, number] = [0, 0];
  const at = (x: number, y: number, a: Point, b: Point) => {
    const c = cellIndex(x, y, w, h, under, slack);
    return c >= 0 && reaches(kind, segmentDistance(x + 0.5, y + 0.5, a, b), r, slack) && test(c);
  };
  const { from: a, to: b } = stroke;
  if (at(Math.floor(a[0]), Math.floor(a[1]), a, b) || at(Math.floor(b[0]), Math.floor(b[1]), a, b)) return true;
  if (under !== 'wrap') {
    const line = lineOf(a, b);
    const y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1]) + reach));
    for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1]) - reach)); y <= y1; y++) {
      if (!rowSpan(y + 0.5, line, reach, span)) continue;
      for (let x = Math.max(0, Math.floor(span[0] - 0.5)); x <= Math.min(w - 1, Math.ceil(span[1] - 0.5)); x++)
        if (at(x, y, a, b)) return true;
    }
    return false;
  }
  // As the paint passes do: parts that start inside the grid and span at most half of it, each over a box of one
  // period at most (paintBox()).
  for (const part of paintSegments(stroke, w, h, true)) {
    const box = paintBox(part, w, h, true);
    if (!box) continue;
    const [bx, by, bw, bh] = box;
    const [p, q] = [part.from, part.to];
    const line = lineOf(p, q);
    if (bw < w && bh < h) {
      // The box holds the part and its brush once, so no two copies reach the same cell: the distance to the part
      // in the box's own coordinates is the distance to the nearest copy, and those coordinates wrap into the grid.
      for (let y = by; y < by + bh; y++) {
        if (!rowSpan(y + 0.5, line, reach, span)) continue;
        for (let x = Math.max(bx, Math.floor(span[0] - 0.5)); x <= Math.min(bx + bw - 1, Math.ceil(span[1] - 0.5)); x++)
          if (reaches(kind, segmentDistance(x + 0.5, y + 0.5, p, q), r, slack) && test(cellIndex(x, y, w, h, 'wrap')))
            return true;
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
 * Float64 rounding at the edge of a brush or the rim of a dish, in cells per cell of radius: Rows.runs() moves every
 * edge by it, so that its runs hold every cell someCell() visits, or only such cells.
 */
const HAIR = 1e-9;

/** Writes the run x0 … x1 to pair `k` of `out` if it holds a cell; returns how many runs it wrote. */
function put(out: number[], k: number, x0: number, x1: number) {
  if (x0 > x1) return 0;
  out[2 * k] = x0;
  out[2 * k + 1] = x1;
  return 1;
}

/** Sorts the runs `from` … `to` of `out` and joins those that overlap or touch; returns the end of the joined ones. */
export function joinRuns(out: number[], from: number, to: number) {
  for (let k = from + 1; k < to; k++) {
    const x0 = out[2 * k] ?? 0;
    const x1 = out[2 * k + 1] ?? 0;
    let j = k - 1;
    for (; j >= from && (out[2 * j] ?? 0) > x0; j--) {
      out[2 * j + 2] = out[2 * j] ?? 0;
      out[2 * j + 3] = out[2 * j + 1] ?? 0;
    }
    out[2 * j + 2] = x0;
    out[2 * j + 3] = x1;
  }
  let n = from;
  for (let k = from; k < to; k++) {
    const x0 = out[2 * k] ?? 0;
    const x1 = out[2 * k + 1] ?? 0;
    if (n > from && x0 <= (out[2 * n - 1] ?? 0) + 1) out[2 * n - 1] = Math.max(out[2 * n - 1] ?? 0, x1);
    else n += put(out, n, x0, x1);
  }
  return n;
}

/**
 * A stroke on a `w` × `h` grid, for the cells it paints by the rule of someCell(), row by row. The cell centres
 * within a distance of a segment cut a row in one interval (the brush is convex), and so do those within the rim of
 * a dish; on a periodic grid each part of the stroke (paintSegments()) and each copy one period around cuts one. So a
 * row costs a few square roots, however many cells the brush covers.
 */
export class Rows {
  private readonly under: Boundary;
  /**
   * The parts as the passes paint them, and for a segment shorter than 1e-3 cells, which both passes measure from a
   * point between its start and the nearest point (segmentDistance()), the disc around its start.
   */
  private readonly parts: { line: Line; start: Line | undefined }[];
  private readonly span: [number, number] = [0, 0];
  /** The reach with ±SLACK, moved out and in by the hair: the sweep asks only for these two. */
  private readonly out: number;
  private readonly in: number;

  constructor(
    readonly stroke: Stroke,
    private readonly w: number,
    private readonly h: number,
    boundary: Boundary,
  ) {
    this.under = stroke.boundary ?? boundary;
    [this.out, this.in] = [this.reach(SLACK, true), this.reach(-SLACK, false)];
    this.parts = paintSegments(stroke, w, h, this.under === 'wrap').map(({ from: a, to: b }) => {
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      return { line: lineOf(a, b), start: dx * dx + dy * dy < 1e-6 ? lineOf(a, a) : undefined };
    });
  }

  /**
   * The cells of row `y` painted with `slack`, as pairs of columns x0, x1 (both included) written to `out` from pair
   * `at` on, sorted and apart; returns how many. With `outer` every edge moves out by a hair of float64 rounding, so
   * the runs hold every cell someCell() visits with that slack; without, in, so they hold only such cells. Without
   * `outer`, a segment shorter than 1e-3 cells counts only the disc around its start.
   */
  runs(y: number, slack: number, outer: boolean, out: number[], at = 0): number {
    const { w, h, span } = this;
    if (y < 0 || y >= h) return 0;
    const r = slack === SLACK && outer ? this.out : slack === -SLACK && !outer ? this.in : this.reach(slack, outer);
    if (r < 0) return 0;
    const cy = y + 0.5;
    if (this.under !== 'wrap') {
      const part = this.parts[0];
      if (!part) return 0;
      if (!rowSpan(cy, (outer ? undefined : part.start) ?? part.line, r, span)) return 0;
      let lo = span[0];
      let hi = span[1];
      if (this.under === 'dish') {
        const d0 = Math.min(w, h) / 2 - 1 + slack;
        const d = outer ? d0 + HAIR * (1 + Math.abs(d0)) : d0 - HAIR * (1 + Math.abs(d0));
        const dy = cy - h / 2;
        if (d < Math.abs(dy)) return 0;
        const c = Math.sqrt(d * d - dy * dy);
        lo = Math.max(lo, w / 2 - c);
        hi = Math.min(hi, w / 2 + c);
      }
      return put(out, at, Math.max(0, Math.ceil(lo - 0.5)), Math.min(w - 1, Math.floor(hi - 0.5)));
    }
    let n = at;
    for (const part of this.parts) {
      const line = (outer ? undefined : part.start) ?? part.line;
      for (let oy = -1; oy <= 1; oy++) {
        if (!rowSpan(cy + oy * h, line, r, span)) continue;
        for (let ox = -1; ox <= 1; ox++)
          n += put(
            out,
            n,
            Math.max(0, Math.ceil(span[0] - ox * w - 0.5)),
            Math.min(w - 1, Math.floor(span[1] - ox * w - 0.5)),
          );
      }
    }
    return joinRuns(out, at, n) - at;
  }

  /** The stroke's reach with `slack` (reachOf()), moved out or in by the hair. */
  private reach(slack: number, outer: boolean) {
    const r0 = reachOf(this.stroke.kind, this.stroke.radius, slack);
    return outer ? r0 + HAIR * (1 + Math.abs(r0)) : r0 - HAIR * (1 + Math.abs(r0));
  }
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

/** How many parts paintSegments() cuts a periodic stroke into: each spans at most half the grid along each axis. */
function partCount({ from: a, to: b }: Stroke, w: number, h: number) {
  return Math.max(1, Math.ceil(Math.abs(b[0] - a[0]) / (w / 2)), Math.ceil(Math.abs(b[1] - a[1]) / (h / 2)));
}

/**
 * Whether both paint passes paint a stroke as it is, in one segment with its own coordinates (paintSegments()): on a
 * closed arena always, on a periodic grid when it starts inside the grid and spans at most half of it (the usual
 * stroke).
 */
export function paintedAsIs(stroke: Stroke, w: number, h: number, wrap: boolean): boolean {
  const a = stroke.from;
  return !wrap || (partCount(stroke, w, h) === 1 && a[0] >= 0 && a[0] < w && a[1] >= 0 && a[1] < h);
}

/**
 * A stroke as segments that both paint passes paint exactly (shaders/paint.wgsl, gl/glsl/paint.frag). On a periodic
 * grid they measure each cell's distance to the stroke and to its copies one period away in every direction. That
 * finds the nearest copy when the segment starts inside the grid and spans at most half of it along each axis. So a
 * longer segment is cut into parts, and each part is moved by whole periods to start inside the grid. Painting the
 * parts paints the stroke: a cell's distance to the stroke is its smallest distance to a part. On a closed arena the
 * stroke is painted as it is.
 */
export function paintSegments(stroke: Stroke, w: number, h: number, wrap: boolean): Stroke[] {
  if (paintedAsIs(stroke, w, h, wrap)) return [stroke];
  const [a, b] = [stroke.from, stroke.to];
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const n = partCount(stroke, w, h);
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
 * Whether the outline pass needs no search of a segment's own cells anywhere (shaders/paint.wgsl `ownHeld`): with a
 * radius of 0.75 cells or more, on the periodic grid, in a box for a segment inside the grid, and in the dish for a
 * brush inside the dish (both are convex, so the ends decide). There every cell's byte is at most the hold of the
 * cells the segment paints, and WebGPU outlines the segment with a pipeline without the search (sim.ts paint()).
 */
export function ownHeldEverywhere({ from, to, radius }: Stroke, w: number, h: number, boundary: Boundary): boolean {
  if (radius < 0.75) return false;
  if (boundary === 'wrap') return true;
  if (boundary === 'box') return [from, to].every(([x, y]) => x >= 0 && y >= 0 && x <= w && y <= h);
  const rim = 0.5 * Math.min(w, h) - 1 - radius;
  return [from, to].every(([x, y]) => Math.hypot(x - w / 2, y - h / 2) <= rim);
}

/**
 * The cells the outline pass of a segment from paintSegments() updates (shaders/paint.wgsl `outline`): its paint
 * box grown by SHAPE_RANGE, cut to the grid on a closed arena and to one period on a periodic grid. It holds every
 * cell within SHAPE_RANGE of the segment's brush and every cell whose HOLD_RINGS rings (5, paint.wgsl) hold a cell
 * the segment paints, so every byte whose distance or hold the segment can change. Undefined like paintBox().
 */
export function outlineBox(segment: Stroke, w: number, h: number, wrap: boolean): Rect | undefined {
  return paintBox({ ...segment, radius: segment.radius + SHAPE_RANGE }, w, h, wrap);
}

/**
 * The cells a brush stroke can paint, as rectangles inside a `w` × `h` grid: the cells of paintBox(). The stroke's
 * bounding box grown by one cell is cut at the grid's edges, or with `wrap` split at them and continued on the other
 * side, at most one period per axis. WebGL2 scissors the paint pass to them (gl/sim.ts), so a stroke costs fragments
 * for its own cells and not for the whole grid, and it skips a stroke outside a closed arena as WebGPU does.
 */
export function scissorRects({ from: a, to: b, radius: r }: Stroke, w: number, h: number, wrap: boolean): Rect[] {
  const span = (lo: number, hi: number, n: number): [number, number][] => {
    if (!wrap) {
      const [s, e] = [Math.max(0, lo), Math.min(n, hi)];
      return e > s ? [[s, e]] : [];
    }
    if (hi - lo >= n) return [[0, n]];
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

/** The cells of outlineBox() as scissor rectangles (gl/sim.ts): split at the edges of a periodic grid. */
export function outlineRects(segment: Stroke, w: number, h: number, wrap: boolean): Rect[] {
  return scissorRects({ ...segment, radius: segment.radius + SHAPE_RANGE }, w, h, wrap);
}

/** The bits of unionRects(), kept between calls: a row of 32-bit words per cell row of the union's bounding box. */
let unionBits = new Uint32Array(0);

/** The runs of set bits of `words` words from `offset`: [first, end) bit indices. Bits past the union are 0. */
function bitRuns(bits: Uint32Array, offset: number, words: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let k = 0; k < words; k++) {
    const v = bits[offset + k] ?? 0;
    if (v === (start < 0 ? 0 : 0xffffffff)) continue; // a whole word that neither starts nor ends a run
    for (let i = 0; i < 32; i++) {
      const on = (v >>> i) & 1;
      if (on && start < 0) start = 32 * k + i;
      else if (!on && start >= 0) {
        out.push([start, 32 * k + i]);
        start = -1;
      }
    }
  }
  if (start >= 0) out.push([start, 32 * words]);
  return out;
}

/**
 * The cells of some rectangles as rectangles that do not overlap: each cell of the union once (gl/sim.ts draws the
 * hold, the light and the shadow of a run of outlines once per cell). Bands of rows that hold the same cells, each
 * with its spans of cells. The rectangles are marked as bits over their bounding box, so the cost grows with their
 * cells, not with how much they overlap (a replay's drags overlap many times).
 */
export function unionRects(rects: readonly Rect[]): Rect[] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y, w, h] of rects)
    if (w > 0 && h > 0) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + w), Math.max(y1, y + h)];
  if (x0 >= x1) return [];
  const [words, rows] = [(x1 - x0 + 31) >>> 5, y1 - y0];
  if (unionBits.length < words * rows) unionBits = new Uint32Array(words * rows);
  const bits = unionBits;
  bits.fill(0, 0, words * rows);
  for (const [x, y, w, h] of rects) {
    if (w <= 0 || h <= 0) continue;
    const [a, b] = [x - x0, x + w - x0 - 1]; // the first and the last bit
    const [first, last] = [a >>> 5, b >>> 5];
    const [head, tail] = [(0xffffffff << (a & 31)) >>> 0, 0xffffffff >>> (31 - (b & 31))];
    for (let row = y - y0; row < y - y0 + h; row++) {
      const o = row * words;
      if (first === last) bits[o + first] = ((bits[o + first] ?? 0) | (head & tail)) >>> 0;
      else {
        bits[o + first] = ((bits[o + first] ?? 0) | head) >>> 0;
        bits.fill(0xffffffff, o + first + 1, o + last);
        bits[o + last] = ((bits[o + last] ?? 0) | tail) >>> 0;
      }
    }
  }
  const out: Rect[] = [];
  const same = (r: number, s: number) => {
    for (let k = 0; k < words; k++) if (bits[r * words + k] !== bits[s * words + k]) return false;
    return true;
  };
  let top = 0;
  for (let row = 1; row <= rows; row++) {
    if (row < rows && same(row, top)) continue;
    for (const [s, e] of bitRuns(bits, top * words, words)) out.push([x0 + s, y0 + top, e - s, row - top]);
    top = row;
  }
  return out;
}

/** Cells per side of a bucket of PendingOutlines. */
const BUCKET = 16;

/** Buckets [first, last] that cover cells lo … hi − 1 of an axis of `n` cells: wrapped on a periodic grid, else cut. */
function bucketSpans(lo: number, hi: number, n: number, wrap: boolean): [number, number][] {
  let cells: [number, number][];
  if (!wrap) cells = [[Math.max(0, lo), Math.min(n, hi)]];
  else if (hi - lo >= n) cells = [[0, n]];
  else {
    const s = ((lo % n) + n) % n;
    const e = s + hi - lo;
    cells =
      e <= n
        ? [[s, e]]
        : [
            [s, n],
            [0, e - n],
          ];
  }
  return cells.filter(([s, e]) => e > s).map(([s, e]) => [Math.floor(s / BUCKET), Math.floor((e - 1) / BUCKET)]);
}

/**
 * The outlines that WebGL2 has not drawn yet (gl/sim.ts paint()), by kind of brush, in buckets of 16 × 16 cells of a
 * `width` × `height` grid. WebGL2 draws the outlines of a run of segments after the run's paint draws: one switch of
 * render target per run instead of two per segment. A new segment of another kind ends the run when its outline box
 * meets the outline box of a segment of the run (meets()). Boxes that do not meet change no cell that the other
 * reads or writes: a segment's outline box holds every cell within 5 rings (HOLD_RINGS) of a cell it paints
 * (outlineBox()), and the outline of a cell reads `env` only within 5 rings of it (the holds; the shadow within 3).
 * Segments of one kind may meet, because their outlines give the same bytes after the run's paint as after each
 * segment's (ADR 0009). The buckets make meets() err on the side of meeting: a run then ends earlier, never later.
 */
export class PendingOutlines {
  private readonly kinds: Uint8Array;
  private readonly columns: number;
  private readonly touched: number[] = [];

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.columns = Math.ceil(width / BUCKET);
    this.kinds = new Uint8Array(this.columns * Math.ceil(height / BUCKET));
  }

  /** Whether the outline rectangles of a segment of `kind` (EnvKind) meet a pending segment of another kind. */
  meets(rects: readonly Rect[], kind: number, wrap: boolean): boolean {
    const others = 0xff & ~(1 << kind);
    for (const [x, y, w, h] of rects)
      for (const [x0, x1] of bucketSpans(x, x + w, this.width, wrap))
        for (const [y0, y1] of bucketSpans(y, y + h, this.height, wrap))
          for (let by = y0; by <= y1; by++)
            for (let bx = x0; bx <= x1; bx++) if ((this.kinds[by * this.columns + bx] ?? 0) & others) return true;
    return false;
  }

  /** Adds a pending segment of `kind`: its outline rectangles. */
  add(rects: readonly Rect[], kind: number, wrap: boolean) {
    for (const [x, y, w, h] of rects)
      for (const [x0, x1] of bucketSpans(x, x + w, this.width, wrap))
        for (const [y0, y1] of bucketSpans(y, y + h, this.height, wrap))
          for (let by = y0; by <= y1; by++)
            for (let bx = x0; bx <= x1; bx++) {
              const b = by * this.columns + bx;
              if (!this.kinds[b]) this.touched.push(b);
              this.kinds[b] = (this.kinds[b] ?? 0) | (1 << kind);
            }
  }

  /** Forgets every pending segment (their outlines are drawn). */
  clear() {
    for (const b of this.touched) this.kinds[b] = 0;
    this.touched.length = 0;
  }
}
