// The sweep (docs/adr/0019): after a stroke that clears (an erase or a wall), the edits that later strokes cleared
// completely on the grid on screen leave the list, so an erased food stays gone on every screen shape. Deleting them
// changes no byte on that grid: an erase writes all four bytes of a cell and a wall writes [255, 0, 0, 0], so after
// the stroke that cleared a cell, it holds what that stroke and later ones wrote, and none of them reads the edit.
import { cellIndex, paintSegments, reaches, segmentDistance, SLACK, someCell } from './brush';
import { strokeOn, type EnvEdit, type Painted } from './environment';
import type { EnvTool, Stroke } from './types';

/** A box of cells: x0, y0, x1, y1, the ends excluded. */
type Box = [number, number, number, number];

/**
 * The cells a stroke can reach on a `w` × `h` grid: its bounding box grown by one cell, cut to the grid, and on a
 * periodic grid the whole axis where it crosses an edge.
 */
function boxOf({ from: a, to: b, radius: r, boundary }: Painted, w: number, h: number): Box {
  const axis = (p: number, q: number, n: number): [number, number] => {
    const [lo, hi] = [Math.floor(Math.min(p, q) - r) - 1, Math.ceil(Math.max(p, q) + r) + 1];
    if (boundary !== 'wrap') return [Math.max(0, lo), Math.min(n, hi)];
    const start = ((lo % n) + n) % n;
    return hi - lo < n && start + hi - lo <= n ? [start, start + hi - lo] : [0, n];
  };
  const [x0, x1] = axis(a[0], b[0], w);
  const [y0, y1] = axis(a[1], b[1], h);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : [0, 0, 0, 0];
}

/** Removes the items at the indices `gone` holds from `list`, in place and in order. */
export function compact(list: unknown[], gone: ReadonlySet<number>) {
  let n = Math.min(list.length, ...gone);
  for (let i = n; i < list.length; i++) if (!gone.has(i)) list[n++] = list[i];
  list.length = n;
}

/** Per edit in Placement: x0, y0, x1, y1 of its box, then the cell it leaves open (OPEN_UNKNOWN, PAINTS_NONE). */
const STRIDE = 5;
const OPEN_UNKNOWN = -1;
/** The edit paints no cell of the grid: the sweep keeps it there. */
const PAINTS_NONE = -2;

/**
 * The edits of a list on one `w` × `h` grid, for the sweep, kept in step with the list: each one's stroke there
 * (strokeOn(), undefined outside the grid), the box of cells it can reach, and a cell it paints that no stroke
 * recorded after it clears, as the last sweep found it. Cleared cells stay cleared (a stroke that clears goes only
 * when later strokes cover its cells, and an erase stays while an older edit paints its cells), so that cell stays
 * open until a new clearing stroke covers it, and the next sweep needs to look at the edit only then. The numbers
 * sit in one typed array, so that finding the edits near a stroke is one quick pass, also over 100,000 edits.
 */
export class Placement {
  readonly strokes: (Painted | undefined)[] = [];
  private data = new Int32Array(STRIDE * 1024);

  constructor(
    readonly w: number,
    readonly h: number,
    edits: readonly EnvEdit[] = [],
  ) {
    for (const e of edits) this.push(e);
  }

  get length() {
    return this.strokes.length;
  }

  push(e: EnvEdit) {
    this.add(strokeOn(e, this.w, this.h));
  }

  /** Adds the next edit by its stroke on this grid (strokeOn()). */
  add(s: Painted | undefined) {
    const i = this.strokes.length;
    this.strokes.push(s);
    if (STRIDE * (i + 1) > this.data.length) {
      const grown = new Int32Array(2 * this.data.length);
      grown.set(this.data);
      this.data = grown;
    }
    this.data.set([...(s ? boxOf(s, this.w, this.h) : [0, 0, 0, 0]), OPEN_UNKNOWN], STRIDE * i);
  }

  /** Keeps the edits whose index `gone` does not hold, in order. */
  remove(gone: ReadonlySet<number>) {
    let n = Math.min(this.length, ...gone);
    for (let i = n; i < this.length; i++)
      if (!gone.has(i)) this.data.copyWithin(STRIDE * n++, STRIDE * i, STRIDE * i + STRIDE);
    compact(this.strokes, gone);
  }

  box(i: number): Box {
    const [d, k] = [this.data, STRIDE * i];
    return [d[k] ?? 0, d[k + 1] ?? 0, d[k + 2] ?? 0, d[k + 3] ?? 0];
  }

  /** The indices of the edits whose box overlaps `box`, in order. An empty box overlaps none. */
  near([x0, y0, x1, y1]: Box): number[] {
    const found: number[] = [];
    const d = this.data;
    for (let i = 0, k = 0; i < this.length; i++, k += STRIDE)
      if ((d[k] ?? 0) < x1 && x0 < (d[k + 2] ?? 0) && (d[k + 1] ?? 0) < y1 && y0 < (d[k + 3] ?? 0)) found.push(i);
    return found;
  }

  overlaps(i: number, j: number) {
    const [d, a, b] = [this.data, STRIDE * i, STRIDE * j];
    return (
      (d[a] ?? 0) < (d[b + 2] ?? 0) &&
      (d[b] ?? 0) < (d[a + 2] ?? 0) &&
      (d[a + 1] ?? 0) < (d[b + 3] ?? 0) &&
      (d[b + 1] ?? 0) < (d[a + 3] ?? 0)
    );
  }

  /** Whether cell (x, y) lies in the box of edit `i`. */
  holds(i: number, x: number, y: number) {
    const [d, k] = [this.data, STRIDE * i];
    return (d[k] ?? 0) <= x && x < (d[k + 2] ?? 0) && (d[k + 1] ?? 0) <= y && y < (d[k + 3] ?? 0);
  }

  /** The cell edit `i` leaves open, as the last sweep found it, or OPEN_UNKNOWN, or PAINTS_NONE. */
  open(i: number) {
    return this.data[STRIDE * i + 4] ?? OPEN_UNKNOWN;
  }

  setOpen(i: number, cell: number) {
    this.data[STRIDE * i + 4] = cell;
  }
}

const hull = (boxes: readonly Box[]): Box => [
  Math.min(...boxes.map((b) => b[0])),
  Math.min(...boxes.map((b) => b[1])),
  Math.max(...boxes.map((b) => b[2])),
  Math.max(...boxes.map((b) => b[3])),
];

/** Whether a stroke of kind `by` resets what one of kind `kind` painted: an erase everything, a wall food and light. */
const clears = (by: EnvTool, kind: EnvTool) => by === 'erase' || (by === 'wall' && kind !== 'wall');

/** A stroke that tells for one cell whether it paints it, by the rule of someCell() (brush.ts). */
class Footprint {
  private readonly parts: Stroke[];
  /** Whether a copy one period away can come nearer than the part itself (a periodic stroke near an edge). */
  private readonly copies: boolean;

  constructor(
    readonly stroke: Painted,
    private readonly w: number,
    private readonly h: number,
  ) {
    const wrap = stroke.boundary === 'wrap';
    this.parts = paintSegments(stroke, w, h, wrap);
    const reach = stroke.radius + SLACK;
    this.copies =
      wrap &&
      this.parts.some(
        ({ from: a, to: b }) =>
          Math.min(a[0], b[0]) - reach < 0 ||
          Math.min(a[1], b[1]) - reach < 0 ||
          Math.max(a[0], b[0]) + reach > w ||
          Math.max(a[1], b[1]) + reach > h,
      );
  }

  /** Whether it paints cell (x, y), with the edge of its brush and the rim of a dish moved out by `slack`. */
  has(x: number, y: number, slack: number) {
    const { kind, radius, boundary } = this.stroke;
    if (cellIndex(x, y, this.w, this.h, boundary, slack) < 0) return false;
    const [px, py] = [x + 0.5, y + 0.5];
    let d = Infinity;
    for (const { from: a, to: b } of this.parts) {
      d = Math.min(d, segmentDistance(px, py, a, b));
      if (this.copies)
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) d = Math.min(d, segmentDistance(px + ox * this.w, py + oy * this.h, a, b));
    }
    return reaches(kind, d, radius, slack);
  }
}

/**
 * The indices of the edits to delete after the last one of `placement`, a stroke that clears, was recorded on its
 * grid. The GPU computes in float32, so every judgement keeps SLACK: the cells of an edit count with its brush and
 * the dish's rim moved out by it, the cells a clearing stroke surely clears with both moved in.
 *
 * 1. An older food, light or wall edit goes when every cell it paints is cleared by a stroke recorded after it: an
 *    erase clears every kind, a wall food and light. An edit that paints no cell of this grid is kept: the grid cannot
 *    judge it, and on another one it may show.
 * 2. Then an erase goes when no older food, light or wall edit that stays paints a cell it erases: before it those
 *    cells hold zeros, so it changes nothing. The erases looked at are the new stroke and those over an edit that
 *    went, whose work just ended.
 *
 * Only edits under the new stroke can be cleared by it, so they are the candidates, found by their boxes.
 */
export function sweep(placement: Placement): Set<number> {
  const { strokes, w, h } = placement;
  const gone = new Set<number>();
  const last = strokes.length - 1;
  const X = strokes[last];
  if (!X || (X.kind !== 'erase' && X.kind !== 'wall')) return gone;
  const kind = (i: number) => strokes[i]?.kind ?? 'erase';
  const footprints = new Map<number, Footprint | undefined>();
  /** Whether edit `i` paints cell (x, y), with `slack`: its box first, then its exact cells. */
  const paints = (i: number, x: number, y: number, slack: number) => {
    if (i < 0 || !placement.holds(i, x, y)) return false;
    if (!footprints.has(i)) {
      const s = strokes[i];
      footprints.set(i, s && new Footprint(s, w, h));
    }
    return footprints.get(i)?.has(x, y, slack) ?? false;
  };
  const cellOf = (c: number): [number, number] => [c % w, Math.floor(c / w)];

  // 1. Food, light and walls under the new stroke, each against the clearing strokes recorded after it.
  const candidates = placement
    .near(placement.box(last))
    .filter((i) => i < last && kind(i) !== 'erase' && clears(X.kind, kind(i)));
  let clearing: number[] | undefined;
  for (const i of candidates) {
    const S = strokes[i];
    const known = placement.open(i);
    if (!S || known === PAINTS_NONE) continue;
    // A cell left open at the last sweep stays open unless the new stroke clears it.
    if (known >= 0 && !paints(last, ...cellOf(known), -SLACK)) continue;
    clearing ??= placement
      .near(hull(candidates.map((c) => placement.box(c))))
      .filter((j) => kind(j) === 'erase' || kind(j) === 'wall');
    const by = clearing.filter((j) => j > i && clears(kind(j), kind(i)) && placement.overlaps(i, j));
    let [any, hit, left] = [false, by[0] ?? -1, OPEN_UNKNOWN];
    someCell(S, w, h, S.boundary, SLACK, (c) => {
      any = true;
      const [x, y] = cellOf(c);
      // The stroke that cleared the last cell usually clears the next one too.
      if (paints(hit, x, y, -SLACK)) return false;
      const other = by.find((j) => j !== hit && paints(j, x, y, -SLACK));
      if (other !== undefined) hit = other;
      else left = c;
      return other === undefined;
    });
    if (!any) placement.setOpen(i, PAINTS_NONE);
    else if (left >= 0) placement.setOpen(i, left);
    else gone.add(i);
  }

  // 2. Erases that clear nothing here any more: the new stroke, and those over an edit that went.
  const went = candidates.filter((i) => gone.has(i));
  const erases = (clearing ?? []).filter((j) => kind(j) === 'erase' && went.some((i) => placement.overlaps(i, j)));
  if (X.kind === 'erase' && !erases.includes(last)) erases.push(last);
  if (erases.length === 0) return gone;
  const under = placement
    .near(hull(erases.map((j) => placement.box(j))))
    .filter((i) => kind(i) !== 'erase' && !gone.has(i));
  for (const j of erases) {
    const E = strokes[j];
    const older = under.filter((i) => i < j && placement.overlaps(i, j));
    const clearsSome =
      E !== undefined &&
      older.length > 0 &&
      someCell(E, w, h, E.boundary, SLACK, (c) => {
        const [x, y] = cellOf(c);
        return older.some((i) => paints(i, x, y, SLACK));
      });
    if (!clearsSome) gone.add(j);
  }
  return gone;
}
