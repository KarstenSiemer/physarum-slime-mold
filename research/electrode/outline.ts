// The two tables of ADR 0058 on the outline of an electrode, computed on the CPU (README.md):
//
//  - how far the outline of a dab lies from the circle of its brush, when the outline comes from the cells of the
//    environment (the rule of ADR 0047, and three smoother ways) and when it comes from the distance to the stroke
//    (ADR 0058);
//  - how much of a pixel two poles cover on the seam between them, where a thin line of one pole lies over the other
//    pole, with the two ways to take the cells of the pole below;
//  - where a pole begins beside an erased line, with the same two ways;
//  - how much of the ground shows on the seam between a thin wall and the pole that it cuts.
//
// It uses the CPU model of the outline pass and of the spline of the view (src/engine/outline-reference.ts), which
// both backends are held to (src/engine/sim.gpu.test.ts, src/engine/electrode.gpu.test.ts).
// Usage: node --import ./research/flow/register.mjs research/electrode/outline.ts
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coverOf,
  outlineAt,
  outlineModel,
  POLE_SCHEME,
  SHAPE_SCHEME,
  type OutlineGrid,
  type OutlineScheme,
} from '../../src/engine/outline-reference.ts';
import type { Stroke } from '../../src/engine/types.ts';

const [W, H] = [64, 48];
const GRID: OutlineGrid = { width: W, height: H, boundary: 'box' };
/** Directions from the middle of a dab along which its outline is looked for. */
const RAYS = 72;

/**
 * The dabs of the first table: the name, the middle and the radius in cells. A dab of the scene Electrotaxis has a
 * radius of 1.5 cells and its middle on a corner of four cells. The wider dabs lie 0.3 and 0.2 cells off a corner, as
 * a dab of the brush does.
 */
export const DABS = [
  ['1.5 cells, on a corner of four cells', 32, 24, 1.5],
  ['1.5 cells, on the centre of a cell', 32.5, 24.5, 1.5],
  ['1.5 cells, between the two', 32.3, 24.2, 1.5],
  ['2.5 cells', 32.3, 24.2, 2.5],
  ['4 cells', 32.3, 24.2, 4],
  ['10 cells', 32.3, 24.2, 10],
] as const;

/** 1 where the centre of a cell lies within `r` cells of (cx, cy): the cells that a dab paints. */
function cellsOf(cx: number, cy: number, r: number): Float64Array {
  const cells = new Float64Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) cells[y * W + x] = 1;
  return cells;
}

/** `cells` after a blur with the weights `kernel` along each axis. */
function blurred(cells: Float64Array, kernel: readonly number[]): Float64Array {
  const half = (kernel.length - 1) / 2;
  const total = kernel.reduce((a, b) => a + b, 0);
  const pass = (from: Float64Array, dx: number, dy: number) => {
    const to = new Float64Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sum = 0;
        kernel.forEach((k, i) => {
          const [u, v] = [x + (i - half) * dx, y + (i - half) * dy];
          if (u >= 0 && v >= 0 && u < W && v < H) sum += k * from[v * W + u]!;
        });
        to[y * W + x] = sum / total;
      }
    return to;
  };
  return pass(pass(cells, 1, 0), 0, 1);
}

/** The bilinear mix of the 4 cells around a point: the rule of ADR 0047 for the cells of a pole. */
function bilinear(cells: Float64Array, px: number, py: number): number {
  const [qx, qy] = [px - 0.5, py - 0.5];
  const [i, j] = [Math.floor(qx), Math.floor(qy)];
  const [fx, fy] = [qx - i, qy - j];
  const at = (x: number, y: number) => cells[y * W + x] ?? 0;
  return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
}

/** The quadratic B-spline over the 3 × 3 cells around a point: the weights of `envAt` in render.wgsl. */
function spline(cells: Float64Array, px: number, py: number): number {
  const [cx, cy] = [Math.floor(px), Math.floor(py)];
  const weights = (u: number) => [0.5 * (0.5 - u) * (0.5 - u), 0.75 - u * u, 0.5 * (0.5 + u) * (0.5 + u)];
  const [wx, wy] = [weights(px - 0.5 - cx), weights(py - 0.5 - cy)];
  let sum = 0;
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) sum += wx[i]! * wy[j]! * (cells[(cy + j - 1) * W + cx + i - 1] ?? 0);
  return sum;
}

/**
 * How far the outline of a dab lies from the circle of its brush, in cells: the least and the largest value over
 * RAYS directions, below 0 inside the circle. `inside`: whether a point lies inside the outline. Along each direction
 * the outline is the outermost point that lies inside, to 0.001 cells.
 */
function offCircle(cx: number, cy: number, r: number, inside: (px: number, py: number) => boolean): [number, number] {
  let [least, most] = [Infinity, -Infinity];
  for (let k = 0; k < RAYS; k++) {
    const [dx, dy] = [Math.cos((k / RAYS) * 2 * Math.PI), Math.sin((k / RAYS) * 2 * Math.PI)];
    let at = NaN;
    for (let t = r + 2; t > 0 && Number.isNaN(at); t -= 0.001) if (inside(cx + dx * t, cy + dy * t)) at = t;
    least = Math.min(least, at - r);
    most = Math.max(most, at - r);
  }
  return [least, most];
}

const signed = (v: number) => `${v < -0.005 ? '−' : v > 0.005 ? '+' : ''}${Math.abs(v).toFixed(2)}`;
/** A dab that the blur took away has no outline. */
const range = ([least, most]: [number, number]) =>
  Number.isNaN(least) ? 'no outline' : `${signed(least)} to ${signed(most)}`;

/** The first table: one row per dab, one column per way to make the outline. */
export function outlineTable(): string[] {
  const rows = [
    '| Dab | Cells, bilinear (ADR 0047) | Cells, spline | Cells, blur 1-2-1, spline | Cells, blur 1-4-6-4-1, spline | Distance to the stroke (ADR 0058) |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const [name, cx, cy, r] of DABS) {
    const cells = cellsOf(cx, cy, r);
    const [soft, softer] = [blurred(cells, [1, 2, 1]), blurred(cells, [1, 4, 6, 4, 1])];
    const bytes = outlineModel(
      [{ kind: 'cathode', from: [cx, cy], to: [cx, cy], radius: r }],
      'box',
      W,
      H,
      POLE_SCHEME,
    );
    const columns = [
      offCircle(cx, cy, r, (px, py) => bilinear(cells, px, py) >= 0.5),
      offCircle(cx, cy, r, (px, py) => spline(cells, px, py) >= 0.5),
      offCircle(cx, cy, r, (px, py) => spline(soft, px, py) >= 0.5),
      offCircle(cx, cy, r, (px, py) => spline(softer, px, py) >= 0.5),
      // Where the pole covers half of a pixel: the distance of the view passes 0.
      offCircle(cx, cy, r, (px, py) => outlineAt(bytes, GRID, px, py, 2).layers[0].coverSd >= 0),
    ];
    rows.push(`| ${name} | ${columns.map(range).join(' | ')} |`);
  }
  return rows;
}

/** The radii of the line of the second table, and the cells per pixel of its views. */
export const SEAM_RADII = [0.75, 1, 1.5, 2, 2.25, 3] as const;
export const SEAM_SCALES = [1 / 8, 1 / 3, 1] as const;

/** POLE_SCHEME with the subtraction of a pole and of a wall at the plain distance of the stroke: the rule of before. */
const PLAIN: OutlineScheme = Object.fromEntries(
  Object.entries(POLE_SCHEME).map(([kind, rule]) => [kind, { unite: rule.unite, subtract: rule.subtract }]),
);

/**
 * The least share of a pixel that the two poles cover together near the seam of an anode line of radius `r` over a
 * wide cathode, at `scale` cells per pixel: 1 where no ground shows. Over the points within 6 cells of the middle
 * part of the line, 0.02 cells apart.
 */
function seamCover(r: number, scale: number, scheme: OutlineScheme): number {
  const strokes: Stroke[] = [
    { kind: 'cathode', from: [32, 24], to: [32, 24], radius: 16 },
    { kind: 'anode', from: LINE[0], to: LINE[1], radius: r },
  ];
  const bytes = outlineModel(strokes, 'box', W, H, scheme);
  let least = Infinity;
  for (let y = 16; y < 32; y += 0.02)
    for (let x = 26; x < 39; x += 0.02) {
      const { layers } = outlineAt(bytes, GRID, x, y, 2);
      least = Math.min(least, coverOf(layers[0].coverSd, scale) + coverOf(layers[1].coverSd, scale));
    }
  return Math.min(least, 1);
}

/** The middle line of the thin stroke of the second and the third table. */
const LINE: [[number, number], [number, number]] = [
  [24.3, 20.2],
  [40.7, 27.9],
];

/**
 * Calls `visit` for 200 places along the middle part of LINE and for both sides of it, with a function that gives
 * the point `d` cells from the middle line at that place and side.
 */
function across(visit: (at: (d: number) => [number, number]) => void) {
  const [a, b] = LINE;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const along = [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as const;
  for (let k = 0; k < 200; k++) {
    const t = 3 + ((length - 6) * k) / 199;
    for (const side of [1, -1])
      visit((d) => [a[0] + along[0] * t - side * along[1] * d, a[1] + along[1] * t + side * along[0] * d]);
  }
}

/**
 * The widest gap between an anode line of radius `r` and the wide cathode below it, in cells: from the outermost
 * point of the anode to the first point of the cathode, across the line.
 */
function seamGap(r: number, scheme: OutlineScheme): number {
  const strokes: Stroke[] = [
    { kind: 'cathode', from: [32, 24], to: [32, 24], radius: 16 },
    { kind: 'anode', from: LINE[0], to: LINE[1], radius: r },
  ];
  const bytes = outlineModel(strokes, 'box', W, H, scheme);
  const layer = (l: 0 | 1, [x, y]: [number, number]) => outlineAt(bytes, GRID, x, y, 2).layers[l].coverSd;
  let widest = 0;
  across((at) => {
    let [anode, cathode] = [0, NaN];
    for (let d = r + 2; d > 0; d -= 0.001)
      if (layer(1, at(d)) >= 0) {
        anode = d;
        break;
      }
    for (let d = 0; d < r + 2 && Number.isNaN(cathode); d += 0.001) if (layer(0, at(d)) > 0) cathode = d;
    widest = Math.max(widest, cathode - anode);
  });
  return widest;
}

/** The second table: one row per radius of the line, the two rules at each zoom, and the gap of each rule. */
export function seamTable(): string[] {
  const zooms = SEAM_SCALES.map((s) => `${String(Math.round(1 / s))} px per cell`);
  const head = (rule: string) => [...zooms.map((z) => `${rule}, ${z}`), `${rule}, gap in cells`];
  const rows = [
    `| Radius of the line, cells | ${[...head('Plain'), ...head('Rounded')].join(' | ')} |`,
    `| --- |${' --- |'.repeat(2 * (SEAM_SCALES.length + 1))}`,
  ];
  for (const r of SEAM_RADII) {
    const of = (scheme: OutlineScheme) => [
      ...SEAM_SCALES.map((scale) => seamCover(r, scale, scheme).toFixed(2)),
      seamGap(r, scheme).toFixed(2),
    ];
    rows.push(`| ${String(r)} | ${[...of(PLAIN), ...of(POLE_SCHEME)].join(' | ')} |`);
  }
  return rows;
}

/** The radii of the wall of the fourth table, and the cells per pixel of its views. */
export const WALL_RADII = [0.75, 1, 1.5, 2, 3] as const;
export const WALL_SCALES = [1 / 8, 1 / 3] as const;

/**
 * The largest share of the ground that shows on the seam between a wall line of radius `r` and the wide cathode that
 * it cuts, at `scale` cells per pixel. The view draws the wall over the ground and then the pole over both, each by
 * the share of the pixel that it covers: the ground keeps the share that neither covers.
 */
function wallSeam(r: number, scale: number, scheme: OutlineScheme): number {
  const strokes: Stroke[] = [
    { kind: 'cathode', from: [32, 24], to: [32, 24], radius: 16 },
    { kind: 'wall', from: LINE[0], to: LINE[1], radius: r },
  ];
  const [walls, poles] = [outlineModel(strokes, 'box', W, H, SHAPE_SCHEME), outlineModel(strokes, 'box', W, H, scheme)];
  let most = 0;
  for (let y = 16; y < 32; y += 0.02)
    for (let x = 26; x < 39; x += 0.02) {
      const wall = coverOf(outlineAt(walls, GRID, x, y, 2).layers[0].coverSd, scale);
      const pole = coverOf(outlineAt(poles, GRID, x, y, 2).layers[0].coverSd, scale);
      most = Math.max(most, (1 - wall) * (1 - pole));
    }
  return most;
}

/** The fourth table: one row per radius of the wall, the two rules at each zoom. */
export function wallTable(): string[] {
  const zooms = WALL_SCALES.map((s) => `${String(Math.round(1 / s))} px per cell`);
  return [
    `| Radius of the wall, cells | ${zooms.map((z) => `Plain, ${z}`).join(' | ')} | ${zooms.map((z) => `Rounded, ${z}`).join(' | ')} |`,
    `| --- |${' --- |'.repeat(2 * WALL_SCALES.length)}`,
    ...WALL_RADII.map((r) => {
      const of = (scheme: OutlineScheme) => WALL_SCALES.map((scale) => wallSeam(r, scale, scheme).toFixed(2));
      return `| ${String(r)} | ${[...of(PLAIN), ...of(POLE_SCHEME)].join(' | ')} |`;
    }),
  ];
}

/** The radii of the erased line of the third table. */
export const EDGE_RADII = [0.75, 1, 1.5] as const;

/**
 * Where a wide cathode begins beside an erased line of radius `r`, as the distance from the middle of the line in
 * cells: the least and the largest value over 200 places along the middle part of the line, on both sides of it.
 */
function edgeOfErase(r: number, scheme: OutlineScheme): [number, number] {
  const strokes: Stroke[] = [
    { kind: 'cathode', from: [32, 24], to: [32, 24], radius: 16 },
    { kind: 'erase', from: LINE[0], to: LINE[1], radius: r },
  ];
  const bytes = outlineModel(strokes, 'box', W, H, scheme);
  let [least, most] = [Infinity, -Infinity];
  across((at) => {
    let edge = NaN;
    for (let d = 0; d < r + 2 && Number.isNaN(edge); d += 0.001) {
      const [x, y] = at(d);
      if (outlineAt(bytes, GRID, x, y, 2).layers[0].coverSd > 0) edge = d;
    }
    least = Math.min(least, edge);
    most = Math.max(most, edge);
  });
  return [least, most];
}

/** The third table: one row per radius of the erased line, with the plain and with the rounded distance. */
export function edgeTable(): string[] {
  const rounded: OutlineScheme = { ...POLE_SCHEME, erase: { subtract: [0, 1], cut: 1.5 } };
  const text = ([least, most]: [number, number]) => `${least.toFixed(2)} to ${most.toFixed(2)}`;
  return [
    '| Radius of the erased line, cells | Plain (ADR 0058) | Rounded as a union |',
    '| --- | --- | --- |',
    ...EDGE_RADII.map(
      (r) => `| ${String(r)} | ${text(edgeOfErase(r, POLE_SCHEME))} | ${text(edgeOfErase(r, rounded))} |`,
    ),
  ];
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  console.log('The outline of a dab against the circle of its brush, in cells (below 0: inside the circle):\n');
  console.log(outlineTable().join('\n'));
  console.log('\nThe least share of a pixel that both poles cover on the seam of an anode line over a cathode:\n');
  console.log(seamTable().join('\n'));
  console.log('\nWhere a cathode begins beside an erased line, in cells from the middle of the line:\n');
  console.log(edgeTable().join('\n'));
  console.log('\nThe largest share of the ground on the seam of a wall line through a cathode:\n');
  console.log(wallTable().join('\n'));
}
