// The food sites of the flow in the tubes (ADR 0029, decision 17): a site is one painted food stroke, a dab or every
// segment of one drag together. The engine groups the food edits of its list into strokes (foodStrokes()), maps them
// onto the grid of the simulation, and the cells that each stroke paints become the cells of its site (SiteCells).
// In every step the passes of the flow find, for every site and strain, the port of the site: the first cell of its
// list that holds food and a tube of the strain (flow.wgsl `sites`, flow.frag PASS 2, flow-reference.ts flowPorts()).
// The list of a site is sorted by the distance to its centre, so that cell is the covered cell nearest the centre.
import type { Boundary } from '../model/params';
import { someCell } from './brush';
import type { EnvEdit } from './environment';
import { FLOW_SITES } from './flow';
import type { Stroke } from './types';

type Point = [number, number];

/**
 * Whether the edit `next` goes on with the stroke of `prev`, the edit just before it in the list: both are food, with
 * the same radius, grid and arena, and `next` starts exactly where `prev` ends. On a periodic grid it may also start
 * where a copy of the grid shows the end of `prev`: the list moves an edit that starts on a copy by whole periods into
 * the grid (fromStroke()). A drag of the brush makes such chains (BrushDrag): its first edit is a dab, and every later
 * one starts at the end of the one before. The rule reads only the geometry of the list, so a link made before it
 * gives the same strokes (ADR 0021).
 */
export function continues(prev: EnvEdit, next: EnvEdit): boolean {
  if (prev.kind !== 'food' || next.kind !== 'food') return false;
  if (prev.radius !== next.radius || prev.boundary !== next.boundary) return false;
  if (prev.grid?.[0] !== next.grid?.[0] || prev.grid?.[1] !== next.grid?.[1]) return false;
  const along = (d: number, n: number | undefined) =>
    d === 0 || (next.boundary === 'wrap' && n !== undefined && Number.isInteger(d / n));
  return along(next.from[0] - prev.to[0], next.grid?.[0]) && along(next.from[1] - prev.to[1], next.grid?.[1]);
}

/** The food strokes of an edit list, in its order: each one the food edits that continue each other (continues()). */
export function foodStrokes(edits: readonly EnvEdit[]): EnvEdit[][] {
  const strokes: EnvEdit[][] = [];
  let prev: EnvEdit | undefined;
  for (const e of edits) {
    const last = strokes[strokes.length - 1];
    if (e.kind === 'food') {
      if (prev && last && continues(prev, e)) last.push(e);
      else strokes.push([e]);
    }
    prev = e;
  }
  return strokes;
}

/** One food stroke on the grid of a simulation: its segments in the order of the list, in cells of that grid. */
export type FoodStroke = readonly Stroke[];

/** One food site: its first cell (x, y), and its cells in FlowSites.cells, `count` of them from `offset`. */
export interface FlowSite {
  x: number;
  y: number;
  offset: number;
  count: number;
  /** The stroke of the list that the site is (SiteCells.sites()). */
  stroke: number;
}

/**
 * The food sites of a simulation, at most FLOW_SITES: per site the run of its cells in `cells`. A cell is its index
 * y · width + x. The run of a site is sorted by the distance of the cell's centre to the centre of the site, ties by
 * the lower index. Each run starts at a multiple of SITE_BLOCK and is followed by NO_CELL up to the next multiple, so a
 * block of SITE_BLOCK entries holds the cells of one site only: the passes of the ports look at the blocks side by side
 * (flow.wgsl `blocks`).
 */
export interface FlowSites {
  list: readonly FlowSite[];
  cells: Uint32Array;
}

/** The entries of a block of the list of cells (FlowSites), and the entry that holds no cell. */
export const SITE_BLOCK = 64;
export const NO_CELL = 0xffffffff;

export const NO_SITES: FlowSites = { list: [], cells: new Uint32Array(0) };

/** A stroke and its cells on a grid, kept for the next call (SiteCells). */
interface Painted {
  w: number;
  h: number;
  boundary: Boundary;
  segments: readonly Stroke[];
  centre: Point;
  /** Every cell that a segment paints, each once, sorted by the distance to the centre, ties by the lower index. */
  cells: Uint32Array;
  /** The columns and rows that its cells span, both ends included: x0, x1, y0, y1. */
  box: [number, number, number, number];
}

/** A stroke's key among those kept: its grid, its arena and its first segment. */
const keyOf = (s: Stroke, w: number, h: number, boundary: Boundary) =>
  `${String(w)} ${String(h)} ${boundary} ${s.kind} ${String(s.radius)} ${String(s.from)} ${String(s.to)}`;

const sameSegment = (a: Stroke, b: Stroke | undefined) =>
  a.kind === b?.kind &&
  a.radius === b.radius &&
  a.boundary === b.boundary &&
  a.from[0] === b.from[0] &&
  a.from[1] === b.from[1] &&
  a.to[0] === b.to[0] &&
  a.to[1] === b.to[1];

/**
 * Whether the box of each stroke meets the box of another (Painted.box), so that the two can share a cell: the boxes in
 * the order of their first column, each against those that start before it ends.
 */
function meetOthers(painted: readonly Painted[]): boolean[] {
  const meets = painted.map(() => false);
  const order = painted.map((_, i) => i).sort((a, b) => (painted[a]?.box[0] ?? 0) - (painted[b]?.box[0] ?? 0));
  order.forEach((i, k) => {
    const a = painted[i]?.box;
    if (!a) return;
    for (let m = k + 1; m < order.length; m++) {
      const j = order[m] ?? 0;
      const b = painted[j]?.box;
      if (!b || b[0] > a[1]) break;
      if (a[2] <= b[3] && b[2] <= a[3]) meets[i] = meets[j] = true;
    }
  });
  return meets;
}

/**
 * The food sites of a grid from its food strokes (ADR 0029, decision 17):
 *
 * - The cells of a stroke are the cells that its segments paint with food, by the rule of the paint passes
 *   (someCell()). Its centre is the start of its first segment: for a dab, the centre of the dab.
 * - A cell that two strokes paint belongs to the one whose centre is nearer, on a tie to the earlier one in the list,
 *   among all strokes of the list. So two strokes that touch or overlap stay two sites, and no two sites share a cell:
 *   a cell is the port of one site at most.
 * - A stroke left without a cell, or that paints none, is no site. With more than FLOW_SITES strokes that keep a cell,
 *   FLOW_SITES of them spread evenly over those take part, the first one always.
 *
 * It keeps the cells of each stroke for the next call: while a drag goes on, only its new segment is painted and
 * sorted into the cells of the drag. Strokes whose cells span boxes that meet no other box keep all their cells
 * without a look at each one.
 */
export class SiteCells {
  private kept = new Map<string, Painted[]>();
  /** Per cell: the number of the last pass that met it (extend()). */
  private stamps = new Int32Array(0);
  private marks = 0;
  /** The stroke whose cells hold the mark `marks` in `stamps`: the one that extend() made last. */
  private marked: Painted | undefined;
  /** Per cell: the site that owns it plus `round`, in the call whose `round` it is (sites()). */
  private owners = new Int32Array(0);
  private round = 0;

  sites(strokes: readonly FoodStroke[], width: number, height: number, boundary: Boundary): FlowSites {
    const n = width * height;
    if (this.stamps.length < n) {
      [this.stamps, this.owners] = [new Int32Array(n), new Int32Array(n)];
      [this.marks, this.round, this.marked] = [0, 0, undefined];
    }
    const kept = new Map<string, Painted[]>();
    const painted: Painted[] = [];
    for (const stroke of strokes) {
      const [first] = stroke;
      if (!first) continue;
      const under = first.boundary ?? boundary;
      const key = keyOf(first, width, height, under);
      // The kept stroke whose segments start this one, the longest such.
      const same = this.kept.get(key) ?? [];
      let best = -1;
      same.forEach((k, i) => {
        const longer = best < 0 || k.segments.length > (same[best]?.segments.length ?? 0);
        if (longer && k.segments.length <= stroke.length && k.segments.every((s, j) => sameSegment(s, stroke[j])))
          best = i;
      });
      const reused = best >= 0 ? same.splice(best, 1)[0] : undefined;
      const p = this.extend(reused, stroke, width, height, under);
      painted.push(p);
      kept.set(key, [...(kept.get(key) ?? []), p]);
    }
    this.kept = kept;
    // A cell of two strokes belongs to the one with the nearer centre, on a tie to the earlier one, among all strokes:
    // only those whose boxes meet can share a cell, and only they are walked.
    const all = painted.flatMap((p, stroke) => (p.cells.length > 0 ? [{ p, stroke }] : []));
    const shares = meetOthers(all.map(({ p }) => p));
    if (this.round > 2 ** 30) [this.owners, this.round] = [new Int32Array(this.owners.length), 0];
    const base = this.round + 1;
    this.round += all.length + 1;
    const owners = this.owners;
    all.forEach(({ p }, i) => {
      if (!shares[i]) return;
      for (const c of p.cells) {
        const other = all[(owners[c] ?? 0) - base]?.p;
        if (!other || distance(c, p) < distance(c, other)) owners[c] = base + i;
      }
    });
    // The strokes that keep a cell; with more than FLOW_SITES, those spread evenly over them.
    const owned = all.flatMap(({ p, stroke }, i) => {
      const own = shares[i] ? p.cells.filter((c) => owners[c] === base + i) : p.cells;
      return own.length > 0 ? [{ own, stroke }] : [];
    });
    const chosen =
      owned.length <= FLOW_SITES
        ? owned
        : Array.from({ length: FLOW_SITES }, (_, i) => owned[Math.floor((i * owned.length) / FLOW_SITES)]).filter(
            (c) => c !== undefined,
          );
    const list: FlowSite[] = [];
    const runs: Uint32Array[] = [];
    let offset = 0;
    for (const { own, stroke } of chosen) {
      const at = own[0] ?? 0;
      list.push({ x: at % width, y: Math.floor(at / width), offset, count: own.length, stroke });
      runs.push(own);
      offset += Math.ceil(own.length / SITE_BLOCK) * SITE_BLOCK;
    }
    const cells = new Uint32Array(offset).fill(NO_CELL);
    list.forEach((site, i) => {
      const run = runs[i];
      if (run) cells.set(run, site.offset);
    });
    return { list, cells };
  }

  /** `stroke` with its cells: those of `kept`, whose segments start it, and those of its other segments. */
  private extend(kept: Painted | undefined, stroke: FoodStroke, w: number, h: number, boundary: Boundary): Painted {
    const first = stroke[0];
    const centre: Point = kept?.centre ?? [first?.from[0] ?? 0, first?.from[1] ?? 0];
    const out: Painted = {
      w,
      h,
      boundary,
      segments: [...stroke],
      centre,
      cells: kept?.cells ?? new Uint32Array(0),
      box: kept ? [...kept.box] : [Infinity, -Infinity, Infinity, -Infinity],
    };
    const done = kept?.segments.length ?? 0;
    if (done === stroke.length) return out;
    const stamps = this.stamps;
    // The cells kept carry the mark of their stroke when extend() made that stroke last, as while a drag goes on.
    if (!kept || kept !== this.marked) {
      if (this.marks > 2 ** 30) [this.stamps, this.marks] = [new Int32Array(this.stamps.length), 0];
      this.marks++;
      for (const c of out.cells) this.stamps[c] = this.marks;
    }
    const mark = this.marks;
    this.marked = out;
    const found: number[] = [];
    for (const segment of stroke.slice(done))
      someCell(segment, w, h, boundary, 0, (c) => {
        if (stamps[c] !== mark) {
          stamps[c] = mark;
          found.push(c);
        }
        return false;
      });
    if (found.length === 0) return out;
    const added = Uint32Array.from(found);
    for (const c of added) {
      const [x, y] = [c % w, Math.floor(c / w)];
      out.box = [Math.min(out.box[0], x), Math.max(out.box[1], x), Math.min(out.box[2], y), Math.max(out.box[3], y)];
    }
    const near = Float64Array.from(added, (c) => distance(c, out));
    const order = Array.from(added.keys()).sort(
      (a, b) => (near[a] ?? 0) - (near[b] ?? 0) || (added[a] ?? 0) - (added[b] ?? 0),
    );
    // The new cells sorted into the cells kept: each one after the kept cells before it, found by halving.
    const old = out.cells;
    const cells = new Uint32Array(old.length + added.length);
    let [from, k] = [0, 0];
    for (const j of order) {
      const [b, db] = [added[j] ?? 0, near[j] ?? 0];
      let [lo, hi] = [from, old.length];
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const a = old[mid] ?? 0;
        const da = distance(a, out);
        if (da < db || (da === db && a < b)) lo = mid + 1;
        else hi = mid;
      }
      cells.set(old.subarray(from, lo), k);
      k += lo - from;
      from = lo;
      cells[k++] = b;
    }
    cells.set(old.subarray(from), k);
    out.cells = cells;
    return out;
  }
}

/**
 * The squared distance of the centre of cell `c` to the centre of a stroke, in cells; on a periodic grid to the
 * nearest copy of the centre.
 */
function distance(c: number, { w, h, boundary, centre }: Painted): number {
  let dx = (c % w) + 0.5 - centre[0];
  let dy = Math.floor(c / w) + 0.5 - centre[1];
  if (boundary === 'wrap') {
    dx = ((dx % w) + w) % w;
    dy = ((dy % h) + h) % h;
    dx = Math.min(dx, w - dx);
    dy = Math.min(dy, h - dy);
  }
  return dx * dx + dy * dy;
}

/** The food sites of a grid from its food strokes, without cells kept from a call before (SiteCells). */
export function flowSites(
  strokes: readonly FoodStroke[],
  width: number,
  height: number,
  boundary: Boundary,
): FlowSites {
  return new SiteCells().sites(strokes, width, height, boundary);
}
