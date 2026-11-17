// The layout of the Y-maze of Reid et al. 2012 (PNAS 109: 17490–17494), for the measurement of the avoidance of
// slime (ADR 0056, stage 2b). It is no scene of the app: y-maze.gpu.test.ts runs it in the real engine, and
// y-maze.test.ts checks it. This file runs in the browser too, so it imports nothing of Node.
//
// The paper gives a base of 1 cm², two arms of 4 cm and a food at the end of each arm. It gives no width of the arms
// and no angle. The choices of this layout, at the 0.537 mm per cell of the Tokyo scene:
//
// - The base is a square of 19 × 19 cells. No food lies on it: the colony is inoculated on its middle.
// - Each arm is a strip of 74 cells from the apex, at 45° to the axis of the Y. The apex is the middle of the cell
//   above the middle of the top row of the base. An arm is 19 cells wide, or 9 in one case.
// - On the grid an arm at 45° is a set of diagonals: 27 diagonals side by side are 19.09 cells wide (13 are 9.19),
//   and 105 diagonals along the arm are 74.25 cells long.
// - The two arms share the cells around the apex. The part of an arm beyond those cells is the arm's own part: the
//   slime of an arm covers it, and the measures of an arm count its cells.
// - The food of an arm is a disc at its end, with a radius of 6.2 cells (4.3 in the arm of 9 cells), as far out as it
//   fits. Every other cell of the lattice is a wall.
// - The axis of the Y is the middle column of a lattice of 129 × 90 cells, so the layout is its own mirror image.
//
// The shapes paint single rows of cells: a stroke along the middle of a row with the smallest radius of a brush
// (0.75 cells) paints the cells of the row between its ends, and no other cell.
import type { EnvShape } from '../../../src/model/presets';

/** The sizes of the layout in cells. `arm`: the length of an arm; `margin`: the walls around the Y. */
export const Y_MAZE = { mmPerCell: 0.537, lattice: [129, 90], base: 19, arm: 74, margin: 6 } as const;

export type Side = 'left' | 'right';
export const SIDES: readonly Side[] = ['left', 'right'];

/** The widths of an arm that the layout has, in cells, with the radius of the food of such an arm. */
const FOOD_RADIUS: Record<number, number> = { 19: 6.2, 9: 4.3 };

export interface YMaze {
  /** The width of an arm in cells, as asked for. */
  width: number;
  w: number;
  h: number;
  /** 1 for a cell without a wall. */
  open: Uint8Array;
  /** The cells of the base. */
  base: number[];
  /** The middle of the base in cells: where the colony is inoculated. */
  start: [number, number];
  /** Per arm: the cells of its own part, beyond the cells that the two arms share. */
  arm: Record<Side, number[]>;
  /** Per arm: the cells of its food. */
  food: Record<Side, number[]>;
  /** Per cell of an arm's own part: its distance from the apex along the arm, in cells; else 0. */
  along: Float32Array;
  /** The length of an arm along its middle line, and its width, both in cells as the grid has them. */
  size: { length: number; width: number };
  /**
   * The shapes for the engine, in the canonical frame of a box of the lattice: the food of the left arm, the food of
   * the right arm, the walls, then slime on the own part of each arm of `slimed`.
   */
  shapes: (slimed?: readonly Side[]) => EnvShape[];
  /** The slime of the arms of `slimed` alone, for a stroke of the Slime tool on the grid: cells, from and to. */
  slimeRuns: (slimed: readonly Side[]) => Run[];
}

/** The cells of one row from column `from` to column `to`, both included. */
export interface Run {
  y: number;
  from: number;
  to: number;
}

/** The runs of the cells of `mask` (1 for a cell of it), row by row. */
function runsOf(mask: Uint8Array, w: number, h: number): Run[] {
  const out: Run[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const from = x;
      while (x + 1 < w && mask[y * w + x + 1]) x++;
      out.push({ y, from, to: x });
    }
  return out;
}

/** The radius of the stroke of a run: the smallest radius of a brush (MIN_RADIUS in src/engine/environment.ts). */
export const RUN_RADIUS = 0.75;

export function yMaze(width = 19): YMaze {
  const foodRadius = FOOD_RADIUS[width];
  if (foodRadius === undefined) throw new Error(`no Y-maze with arms of ${String(width)} cells`);
  const [w, h] = Y_MAZE.lattice;
  // The apex: the cell above the middle of the top row of the base.
  const cx = (w - 1) / 2;
  const cy = h - 1 - Y_MAZE.margin - Y_MAZE.base;
  const reach = (Y_MAZE.base - 1) / 2;
  // An arm in diagonals: `half` on each side of its middle diagonal, and `far` along it from the apex.
  const half = Math.floor((width * Math.SQRT2) / 2);
  const far = Math.floor(Y_MAZE.arm * Math.SQRT2);
  // Cell (x, y) seen from the apex: `a` to the right and `b` down. Along the right arm p = a − b counts the diagonals
  // from the apex, and q = a + b those across it; the left arm is its mirror image.
  const coords = (c: number) => ({ a: (c % w) - cx, b: Math.floor(c / w) - cy });
  const inArm = (p: number, q: number) => p >= 0 && p <= far && Math.abs(q) <= half;
  const inBase = (a: number, b: number) => Math.abs(a) <= reach && b >= 1 && b <= Y_MAZE.base;
  const n = w * h;
  const open = new Uint8Array(n);
  const base: number[] = [];
  const arm: Record<Side, number[]> = { left: [], right: [] };
  const along = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const { a, b } = coords(c);
    const [right, left] = [inArm(a - b, a + b), inArm(-a - b, -a + b)];
    if (inBase(a, b)) base.push(c);
    if (inBase(a, b) || right || left) open[c] = 1;
    // The own part of an arm starts where the strip of the other arm ends: `half` diagonals from the apex.
    if (right && a - b > half) arm.right.push(c);
    if (left && -a - b > half) arm.left.push(c);
    if ((right && a - b > half) || (left && -a - b > half)) along[c] = (Math.abs(a) - b) / Math.SQRT2;
  }
  // The food of the right arm: a disc around the middle of a cell of the middle diagonal, as far out as it fits.
  const disc = (ax: number) => {
    const cells: number[] = [];
    const r = Math.ceil(foodRadius);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (dx * dx + dy * dy <= foodRadius * foodRadius) cells.push((cy - ax + dy) * w + cx + ax + dx);
    return cells;
  };
  let out = Math.floor(far / 2);
  while (!disc(out).every((c) => arm.right.includes(c))) out--;
  const mirror = (c: number) => Math.floor(c / w) * w + (w - 1 - (c % w));
  const food: Record<Side, number[]> = { right: disc(out), left: disc(out).map(mirror) };
  // The middle of the cell (x, y) in the canonical frame of a box of the lattice (EnvShape, toFrame()).
  const at = (x: number, y: number): [number, number] => [(x + 0.5 - w / 2) / (w / 1.6), (y + 0.5 - h / 2) / h];
  const runShape = (kind: 'wall' | 'slime', run: Run): EnvShape => ({
    kind,
    at: at(run.from, run.y),
    to: at(run.to, run.y),
    r: RUN_RADIUS / h,
  });
  const foodShape = (side: Side): EnvShape => {
    const sign = side === 'right' ? 1 : -1;
    return { kind: 'food', at: at(cx + sign * out, cy - out), r: foodRadius / h };
  };
  const slimeRuns = (slimed: readonly Side[]) => {
    const mask = new Uint8Array(n);
    for (const side of slimed) for (const c of arm[side]) mask[c] = 1;
    return runsOf(mask, w, h);
  };
  const walls = runsOf(
    open.map((o) => 1 - o),
    w,
    h,
  );
  return {
    width,
    w,
    h,
    open,
    base,
    start: [cx + 0.5, cy + (Y_MAZE.base + 1) / 2 + 0.5],
    arm,
    food,
    along,
    size: { length: (far + 1) / Math.SQRT2, width: (2 * half + 1) / Math.SQRT2 },
    shapes: (slimed = []) => [
      foodShape('left'),
      foodShape('right'),
      ...walls.map((run) => runShape('wall', run)),
      ...slimeRuns(slimed).map((run) => runShape('slime', run)),
    ],
    slimeRuns,
  };
}

/** The layout as text: `#` a wall, `.` open ground, `b` the base, `l` and `r` the own parts of the arms, `F` food. */
export function drawing(maze: YMaze): string {
  const { w, h } = maze;
  const mark = new Map<number, string>();
  for (const c of maze.base) mark.set(c, 'b');
  for (const c of maze.arm.left) mark.set(c, 'l');
  for (const c of maze.arm.right) mark.set(c, 'r');
  for (const side of SIDES) for (const c of maze.food[side]) mark.set(c, 'F');
  const lines: string[] = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    for (let x = 0; x < w; x++) line += maze.open[y * w + x] ? (mark.get(y * w + x) ?? '.') : '#';
    lines.push(line);
  }
  return lines.join('\n');
}
