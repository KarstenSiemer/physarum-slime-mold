// Food, light and walls as a list of edits that every new simulation paints again (docs/adr/0019).
import type { Boundary } from '../model/params';
import type { EnvShape } from '../model/presets';
import type { EnvTool, Stroke } from './types';

/**
 * Smallest brush radius in cells. A cell that a stroke's segment passes through has its centre at most half a cell
 * diagonal (0.71 cells) from the segment, so a brush of 0.75 paints every such cell: painted walls stay closed on
 * any grid, also where they run diagonally, and a small food source does not vanish on a coarse grid.
 */
export const MIN_RADIUS = 0.75;

type Point = [number, number];

/** One food, light, wall or erase edit, kept so that a new simulation can paint it again. */
export interface EnvEdit {
  kind: EnvTool;
  from: Point;
  to: Point;
  radius: number;
  /**
   * The grid the edit was painted on (width, height): positions and radius are in its cells. Without it, they are
   * in the canonical frame (frame()): a preset's shapes.
   */
  grid?: Point;
  /** The boundary it was painted under: whether the stroke wrapped around the edges. */
  boundary: Boundary;
}

/** Whole periods of `n` to subtract from `v` so that it lies in [0, n). */
export function periods(v: number, n: number): number {
  const k = Math.floor(v / n) * n;
  return v - k >= n ? k + n : k;
}

/**
 * An edit from a stroke painted on a `grid` (cells) under `boundary`, unless the stroke names its own. On a periodic
 * grid the view shows copies of the grid around it, and a stroke on a copy paints the grid where the copy shows it.
 * So the stroke is moved by whole periods until it starts inside the grid: the same cells there, and on another grid
 * the canonical frame finds it where it was painted instead of beside the grid.
 */
export function fromStroke(s: Stroke, grid: Point, boundary: Boundary): EnvEdit {
  const under = s.boundary ?? boundary;
  let { from, to } = s;
  if (under === 'wrap') {
    const [dx, dy] = [periods(from[0], grid[0]), periods(from[1], grid[1])];
    [from, to] = [
      [from[0] - dx, from[1] - dy],
      [to[0] - dx, to[1] - dy],
    ];
  }
  return { kind: s.kind, from, to, radius: s.radius, grid, boundary: under };
}

/** An edit from a preset's shape, which is in the canonical frame, painted under `boundary`. */
export function fromShape(e: EnvShape, boundary: Boundary): EnvEdit {
  return { kind: e.kind, from: e.at, to: e.to ?? e.at, radius: e.r, boundary };
}

/**
 * Grid cells to the canonical frame: landscape, its origin at the grid's centre and its unit the grid's short side.
 * On a portrait grid (height above width) the frame is turned by 90°: its long axis runs down the grid, so a
 * layout along the long side of a wide screen stays along the long side of a tall one.
 */
export function toFrame([x, y]: Point, [w, h]: Point): Point {
  const s = Math.min(w, h);
  const [u, v] = [(x - w / 2) / s, (y - h / 2) / s];
  return h > w ? [v, -u] : [u, v];
}

/** The canonical frame to the cells of a `w` × `h` grid (the inverse of toFrame()). */
export function fromFrame([u, v]: Point, [w, h]: Point): Point {
  const s = Math.min(w, h);
  return h > w ? [w / 2 - s * v, h / 2 + s * u] : [w / 2 + s * u, h / 2 + s * v];
}

/**
 * The edit as a stroke on a `width` × `height` grid, or undefined if it lies completely outside that grid (it stays
 * in the list for other grids). On the grid it was painted on, it is the stroke as painted, byte for byte. On
 * another grid it goes through the canonical frame: a similarity transform, so circles stay circles and a food
 * source keeps its size relative to the dish, with a radius of at least MIN_RADIUS.
 */
export function strokeOn(e: EnvEdit, width: number, height: number): Stroke | undefined {
  const grid: Point = [width, height];
  const { kind, boundary } = e;
  if (e.grid?.[0] === width && e.grid[1] === height)
    return { kind, from: e.from, to: e.to, radius: e.radius, boundary };
  const [from, to] = e.grid ? [toFrame(e.from, e.grid), toFrame(e.to, e.grid)] : [e.from, e.to];
  const r = e.grid ? e.radius / Math.min(...e.grid) : e.radius;
  const stroke: Stroke = {
    kind,
    from: fromFrame(from, grid),
    to: fromFrame(to, grid),
    radius: Math.max(MIN_RADIUS, r * Math.min(width, height)),
    boundary,
  };
  const [a, b] = [stroke.from, stroke.to];
  const outside =
    Math.max(a[0], b[0]) + stroke.radius < 0 ||
    Math.min(a[0], b[0]) - stroke.radius > width ||
    Math.max(a[1], b[1]) + stroke.radius < 0 ||
    Math.min(a[1], b[1]) - stroke.radius > height;
  return outside ? undefined : stroke;
}
