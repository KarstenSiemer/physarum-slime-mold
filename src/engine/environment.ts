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
   * The grid the edit was painted on or anchored to (width, height): positions and radius are in its cells. Without
   * it, they are in the canonical frame of the arena on screen (toFrame()): a preset's shapes.
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

/** An edit from a preset's shape, painted under `boundary`: the preset's arena, in whose canonical frame it is. */
export function fromShape(e: EnvShape, boundary: Boundary): EnvEdit {
  return { kind: e.kind, from: e.at, to: e.to ?? e.at, radius: e.r, boundary };
}

/** Long side over short side of the canonical frame of a box or a periodic grid: presets are laid out for 16:10. */
export const FRAME_ASPECT = 1.6;

/**
 * Cells per unit of the canonical frame along its long and its short axis. A dish is the circle on the grid's short
 * side, so its frame has that side as the unit on both axes: a similarity transform, and a square of food stays a
 * square on every screen. A box or a periodic grid is the arena itself, so its frame stretches with the grid: the
 * long side spans FRAME_ASPECT units and the short side one, and a layout keeps its place relative to the edges.
 * On a 16:10 grid both are the same.
 */
function units([w, h]: Point, boundary: Boundary): Point {
  const [long, short] = [Math.max(w, h), Math.min(w, h)];
  return boundary === 'dish' ? [short, short] : [long / FRAME_ASPECT, short];
}

/**
 * Grid cells to the canonical frame of an arena (units()): landscape, its origin at the grid's centre. On a portrait
 * grid (height above width) the frame is turned by 90°: its long axis runs down the grid, so a layout along the
 * long side of a wide screen stays along the long side of a tall one.
 */
export function toFrame([x, y]: Point, [w, h]: Point, boundary: Boundary): Point {
  const [su, sv] = units([w, h], boundary);
  const [lx, ly] = h > w ? [y - h / 2, w / 2 - x] : [x - w / 2, y - h / 2];
  return [lx / su, ly / sv];
}

/** The canonical frame to the cells of a `w` × `h` grid (the inverse of toFrame()). */
export function fromFrame([u, v]: Point, [w, h]: Point, boundary: Boundary): Point {
  const [su, sv] = units([w, h], boundary);
  const [lx, ly] = [u * su, v * sv];
  return h > w ? [w / 2 - ly, h / 2 + lx] : [w / 2 + lx, h / 2 + ly];
}

/**
 * The edit on a `w` × `h` grid through the canonical frame of `arena`: on the grid the edit has, its own coordinates.
 * The radius scales with the short side in every arena, so a dab stays round. No MIN_RADIUS and no skipping here.
 */
function mapped(e: EnvEdit, [w, h]: Point, arena: Boundary): Stroke {
  const { kind, boundary } = e;
  if (e.grid?.[0] === w && e.grid[1] === h) return { kind, from: e.from, to: e.to, radius: e.radius, boundary };
  const [from, to] = e.grid ? [toFrame(e.from, e.grid, arena), toFrame(e.to, e.grid, arena)] : [e.from, e.to];
  const r = e.grid ? e.radius / Math.min(...e.grid) : e.radius;
  return {
    kind,
    from: fromFrame(from, [w, h], arena),
    to: fromFrame(to, [w, h], arena),
    radius: r * Math.min(w, h),
    boundary,
  };
}

/**
 * The edit as a stroke on a `width` × `height` grid whose arena on screen is `arena`, with a radius of at least
 * MIN_RADIUS. On the grid the edit has, it is the stroke as painted, byte for byte; on another grid the canonical
 * frame of `arena` maps it. Under the periodic boundary the stroke is moved by whole periods into the grid, as
 * fromStroke() does, because such a grid has no outside. Any other stroke that lies completely outside the grid is
 * undefined: it paints nothing there and stays in the list for other grids.
 */
export function strokeOn(e: EnvEdit, width: number, height: number, arena: Boundary): Stroke | undefined {
  const s = mapped(e, [width, height], arena);
  s.radius = Math.max(MIN_RADIUS, s.radius);
  const [a, b] = [s.from, s.to];
  if (s.boundary === 'wrap') {
    const [dx, dy] = [periods(a[0], width), periods(a[1], height)];
    return { ...s, from: [a[0] - dx, a[1] - dy], to: [b[0] - dx, b[1] - dy] };
  }
  const outside =
    Math.max(a[0], b[0]) + s.radius < 0 ||
    Math.min(a[0], b[0]) - s.radius > width ||
    Math.max(a[1], b[1]) + s.radius < 0 ||
    Math.min(a[1], b[1]) - s.radius > height;
  return outside ? undefined : s;
}

/**
 * The edit in cells of a `width` × `height` grid whose arena on screen is `arena`. strokeOn() gives the same stroke
 * for it on that grid as for the edit, under any arena, so Engine.apply anchors every edit when the arena on screen
 * changes its frame. The radius keeps its exact value, so a finer grid later gets back a thin stroke.
 */
export function anchor(e: EnvEdit, width: number, height: number, arena: Boundary): EnvEdit {
  const { from, to, radius } = mapped(e, [width, height], arena);
  return { kind: e.kind, from, to, radius, grid: [width, height], boundary: e.boundary };
}
