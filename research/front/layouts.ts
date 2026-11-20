// The grids of the prototype of stage 4: a dish with foods, a lane, and the Y-maze of Reid et al. 2012 as
// research/flow/engine/y-maze.ts lays it out (ADR 0056). Prototype code.
import { DISH_FILL } from '../../src/engine/brush';
import { yMaze, type Side } from '../flow/engine/y-maze';
import type { Layout } from './sim';

/** The cells of a disc, nearest its centre first (a site's port is its first cell with a tube, docs/model.md 8.2). */
function disc(w: number, h: number, open: Uint8Array, x: number, y: number, r: number): Int32Array {
  const cells: [number, number][] = [];
  for (let cy = Math.floor(y - r - 1); cy <= Math.ceil(y + r + 1); cy++)
    for (let cx = Math.floor(x - r - 1); cx <= Math.ceil(x + r + 1); cx++) {
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
      const c = cy * w + cx;
      if (d <= r && open[c]) cells.push([d, c]);
    }
  cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return Int32Array.from(cells, ([, c]) => c);
}

function withFoods(
  w: number,
  h: number,
  open: Uint8Array,
  wall: Uint8Array,
  foods: readonly (readonly [number, number, number])[],
  start: readonly [number, number],
): Layout {
  const food = new Uint8Array(w * h);
  const sites = foods.map(([x, y, r]) => disc(w, h, open, x, y, r));
  for (const site of sites) for (const c of site) food[c] = 1;
  return { w, h, open, wall, food, sites, start };
}

/** A dish of `side` × `side` cells (the app's dish: DISH_FILL of the short side). Foods as [x, y, radius] in cells. */
export function dish(side: number, foods: readonly (readonly [number, number, number])[]): Layout {
  const [w, h] = [side, side];
  const open = new Uint8Array(w * h);
  const radius = DISH_FILL * 0.5 * side;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= radius) open[y * w + x] = 1;
  const [first] = foods;
  return withFoods(w, h, open, new Uint8Array(w * h), foods, first ? [first[0], first[1]] : [w / 2, h / 2]);
}

/** A box of w × h cells without walls: a lane when one side is short. */
export function box(w: number, h: number, foods: readonly (readonly [number, number, number])[]): Layout {
  const open = new Uint8Array(w * h).fill(1);
  const [first] = foods;
  return withFoods(w, h, open, new Uint8Array(w * h), foods, first ? [first[0], first[1]] : [w / 2, h / 2]);
}

/**
 * A box of w × h cells whose first `long` rows are wall but for a channel of `wide` cells in the middle: a colony on a
 * food in the channel grows a tube through it and then meets open ground (ADR 0076). Foods as [x, y, radius] in cells.
 */
export function neck(
  w: number,
  h: number,
  wide: number,
  long: number,
  foods: readonly (readonly [number, number, number])[],
): Layout {
  const open = new Uint8Array(w * h).fill(1);
  const wall = new Uint8Array(w * h);
  const [a, b] = [Math.round((w - wide) / 2), Math.round((w + wide) / 2)];
  for (let y = 0; y < long; y++)
    for (let x = 0; x < w; x++)
      if (x < a || x >= b) {
        open[y * w + x] = 0;
        wall[y * w + x] = 1;
      }
  const [first] = foods;
  return withFoods(w, h, open, wall, foods, first ? [first[0], first[1]] : [w / 2, h / 2]);
}

/**
 * The Y-maze of ADR 0056 with slime on the own parts of the arms `slimed`, or on every open cell when `everywhere` is
 * true (ADR 0056, target 3: slime everywhere). The left food is site 0.
 */
export function yMazeLayout(slimed: readonly Side[], width = 19, everywhere = false) {
  const m = yMaze(width);
  const { w, h, open } = m;
  const wall = open.map((o) => 1 - o);
  const food = new Uint8Array(w * h);
  const centre = (cells: number[]) => {
    const xs = cells.map((c) => (c % w) + 0.5);
    const ys = cells.map((c) => Math.floor(c / w) + 0.5);
    return [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length] as const;
  };
  const sites = (['left', 'right'] as const).map((side) => {
    const [x, y] = centre(m.food[side]);
    const cells = [...m.food[side]].sort(
      (a, b) =>
        Math.hypot((a % w) + 0.5 - x, Math.floor(a / w) + 0.5 - y) -
          Math.hypot((b % w) + 0.5 - x, Math.floor(b / w) + 0.5 - y) || a - b,
    );
    for (const c of cells) food[c] = 1;
    return Int32Array.from(cells);
  });
  const slime = everywhere ? open.slice() : new Uint8Array(w * h);
  for (const side of slimed) for (const c of m.arm[side]) slime[c] = 1;
  const layout: Layout = { w, h, open, wall, food, sites, start: m.start, slime };
  return { layout, maze: m };
}
