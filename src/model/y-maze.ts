// The layout of the Y-maze of Reid et al. 2012 (PNAS 109: 17490–17494), first made for the measurement of the
// avoidance of slime (ADR 0056, stage 2b). The scene Y-maze with slime runs it (ADR 0066), so it lives here; the
// research code of ADR 0056 imports it through research/flow/engine/y-maze.ts. research/flow/engine/y-maze.test.ts
// checks it as the paint passes paint it.
//
// The paper gives a base of 1 cm², two arms of 4 cm and a food at the end of each arm. It gives no width of the arms
// and no angle. The choices of this layout, at the 0.537 mm per cell of the Tokyo scene:
//
// - The base is a square of 19 × 19 cells. No food lies on it: the colony starts on its middle.
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
import type { EnvShape } from './presets';

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
  /** The middle of the base in cells: where the colony starts. */
  start: [number, number];
  /**
   * The start spot of the colony as a shape of a scene (ADR 0066): `start` in the canonical frame of a box of the
   * lattice. The start layout Food places the colony there, and the spot paints nothing.
   */
  startShape: EnvShape;
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
  /**
   * The film of the slime of the arms of `slimed`, for the picture (ADR 0066): per arm one stroke of slime along the
   * middle line of its own part. The runs of `shapes()` stamp the cells of the slime, but a stroke of the smallest radius
   * gives a cell a fifth of the full amount of slime (docs/model.md, 6.9), and the picture draws it hardly. This stroke
   * gives the own part the full amount, but for the cells near the apex, and it stamps no cell that the runs do not.
   */
  film: (slimed: readonly Side[]) => EnvShape[];
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

/**
 * Cells inside the edge of a stroke of slime from which on it gives the full amount of slime: the ramp of
 * paintedAmount() in src/engine/slime-reference.ts is SLIME_RIM = 4 cells wide, from half a cell outside the edge.
 */
const FILM_FULL = 3.5;
/** Cells between the edge of the stroke of a film and the nearest cell that it must not stamp, for float32 on the GPU. */
const FILM_SLACK = 0.1;

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
  // A point (x, y) in cells, and the middle of the cell (x, y), in the canonical frame of a box of the lattice
  // (EnvShape, toFrame()).
  const point = (x: number, y: number): [number, number] => [(x - w / 2) / (w / 1.6), (y - h / 2) / h];
  const at = (x: number, y: number) => point(x + 0.5, y + 0.5);
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
  // The film: the middle line of the right arm runs through the cells (cx + t, cy − t), t·√2 cells from the apex. Its
  // stroke reaches FILM_FULL cells past the cells of the arm that lie farthest from that line, so that every cell of
  // the own part beyond the cap of the stroke gets the full amount. The stroke starts so far out that it stamps no cell
  // of the diagonal `half`, the last one that the arms share, whose nearest cells lie √0.5 cells off the middle line;
  // it ends on the last diagonal of the arm, where walls follow.
  const filmRadius = half / Math.SQRT2 + FILM_FULL;
  const filmFrom = (half / Math.SQRT2 + Math.sqrt((filmRadius + FILM_SLACK) ** 2 - 0.5)) / Math.SQRT2;
  const filmShape = (side: Side): EnvShape => {
    const sign = side === 'right' ? 1 : -1;
    const to = far / 2;
    return {
      kind: 'slime',
      at: at(cx + sign * filmFrom, cy - filmFrom),
      to: at(cx + sign * to, cy - to),
      r: filmRadius / h,
    };
  };
  const start: [number, number] = [cx + 0.5, cy + (Y_MAZE.base + 1) / 2 + 0.5];
  return {
    width,
    w,
    h,
    open,
    base,
    start,
    // A start spot has no size: the colony takes the disc of the start layout Food (Engine.seedAtFood()).
    startShape: { kind: 'start', at: point(...start), r: 0 },
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
    film: (slimed) => slimed.map(filmShape),
  };
}
