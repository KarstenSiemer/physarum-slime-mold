// The sweep (docs/adr/0019): after a stroke that clears (an erase or a wall), the edits that later strokes cleared
// completely on the grid on screen leave the list, so an erased food stays gone on every screen shape. Deleting them
// changes no byte on that grid: an erase writes all four bytes of a cell and a wall writes [255, 0, 0, 0], so after
// the stroke that cleared a cell, it holds what that stroke and later ones wrote, and none of them reads the edit.
import { dishRadius, joinRuns, paintedAsIs, reachOf, Rows, segmentDistance, SLACK, someCell } from './brush';
import { strokeOn, type EnvEdit, type Painted } from './environment';
import type { EnvTool } from './types';

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

/** The smallest of `n` and the numbers in `set`, by a loop: spread into Math.min, V8 throws from 125,000 items. */
function least(n: number, set: Iterable<number>) {
  for (const v of set) if (v < n) n = v;
  return n;
}

/** Flags per index of `list` for the indices `gone` holds. */
function flags(length: number, gone: ReadonlySet<number>) {
  const out = new Uint8Array(length);
  for (const i of gone) if (i >= 0 && i < length) out[i] = 1;
  return out;
}

/** Removes the items at the indices `gone` holds from `list`, in place and in order. */
export function compact(list: unknown[], gone: ReadonlySet<number>, flagged = flags(list.length, gone)) {
  let n = least(list.length, gone);
  for (let i = n; i < list.length; i++) if (!flagged[i]) list[n++] = list[i];
  list.length = n;
}

/**
 * Per edit in Placement: x0, y0, x1, y1 of its box; the cell it leaves open (or OPEN_UNKNOWN, PAINTS_NONE) and the
 * first row whose cells are not known to be cleared; for an erase the serial of an older edit it clears a cell of
 * (its witness), or −1; its own serial.
 */
const STRIDE = 8;
const [OPEN, CURSOR, WITNESS, SERIAL] = [4, 5, 6, 7];
const OPEN_UNKNOWN = -1;
/** The edit paints no cell of the grid: the sweep keeps it there. */
const PAINTS_NONE = -2;
/** Cells per side of a tile of the index (Placement.scan()): 2^TILE_BITS. */
const TILE_BITS = 5;
const TILE = 1 << TILE_BITS;
/** Edits from which on the placement keeps the index of tiles: below, a pass over the list costs less. */
const INDEXED = 256;

/** The edits whose box reaches one tile: per edit its serial and box (x0, y0, x1, y1), oldest first. */
class Tile {
  data = new Int32Array(40);
  n = 0;

  push(serial: number, [x0, y0, x1, y1]: Box) {
    if (5 * (this.n + 1) > this.data.length) {
      const grown = new Int32Array(2 * this.data.length);
      grown.set(this.data);
      this.data = grown;
    }
    const [d, k] = [this.data, 5 * this.n++];
    [d[k], d[k + 1], d[k + 2], d[k + 3], d[k + 4]] = [serial, x0, y0, x1, y1];
  }
}

/** Whether a stroke of kind `by` resets what one of kind `kind` painted: an erase everything, a wall food and light. */
const clears = (by: EnvTool, kind: EnvTool) => by === 'erase' || (by === 'wall' && kind !== 'wall');

/**
 * The edits of a list on one `w` × `h` grid, for the sweep, kept in step with the list: each one's stroke there
 * (strokeOn(), undefined outside the grid), the box of cells it can reach, and what the last sweep found. For a food,
 * light or wall edit that is a cell it paints that no stroke recorded after it clears, and the first of its rows whose
 * cells are not all known to be cleared. Cleared cells stay cleared (a stroke that clears goes only when later strokes
 * cover its cells, and an erase stays while an older edit paints its cells), so that cell stays open until a new
 * clearing stroke covers it: the next sweep looks at the edit only then, from that row on. For an erase it is an older
 * edit under it that stays (its witness): the erase still clears that edit's cells until it goes. The numbers sit in
 * one typed array, and for a long list an index of tiles finds the clearing strokes and the painting ones near a
 * stroke without a pass over the list.
 */
export class Placement {
  readonly strokes: (Painted | undefined)[] = [];
  /** Each stroke's rows (Rows), made when a sweep first judges it. */
  private readonly rows: (Rows | undefined)[] = [];
  private data = new Int32Array(STRIDE * 1024);
  /** Index in the list of every serial given out, or −1 once its edit left. */
  private where = new Int32Array(1024).fill(-1);
  private serials = 0;
  private readonly cols: number;
  /** Per tile, the clearing strokes (erase, wall) whose box reaches it. */
  private clearing: (Tile | undefined)[] = [];
  /** The same for the strokes that paint (food, light, wall). */
  private painting: (Tile | undefined)[] = [];
  /** Entries in the tiles, and those of edits that left (skipped until the tiles are built again). */
  private entries = 0;
  private stale = 0;
  /** Whether the tiles hold the list: from `indexFrom` edits on. */
  private indexed = false;
  /** Edits and tile entries that scans passed, as a measure of their work (sweeping()). */
  visits = 0;

  /** `indexFrom`: from how many edits on the tiles hold the list. */
  constructor(
    readonly w: number,
    readonly h: number,
    edits: readonly EnvEdit[] = [],
    private readonly indexFrom = INDEXED,
  ) {
    this.cols = Math.ceil(w / TILE);
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
    this.rows.push(undefined);
    if (STRIDE * (i + 1) > this.data.length) {
      const grown = new Int32Array(2 * this.data.length);
      grown.set(this.data);
      this.data = grown;
    }
    const serial = this.serials++;
    if (serial >= this.where.length) {
      const grown = new Int32Array(2 * this.where.length).fill(-1);
      grown.set(this.where);
      this.where = grown;
    }
    this.where[serial] = i;
    const box = s ? boxOf(s, this.w, this.h) : ([0, 0, 0, 0] as Box);
    this.data.set([...box, OPEN_UNKNOWN, box[1], -1, serial], STRIDE * i);
    if (s && this.indexed) this.index(serial, s.kind, box);
    else if (!this.indexed && this.length >= this.indexFrom) this.reindex();
  }

  /** Builds the tiles from the list. */
  private reindex() {
    [this.clearing, this.painting, this.entries, this.stale, this.indexed] = [[], [], 0, 0, true];
    for (let i = 0; i < this.length; i++) {
      const s = this.strokes[i];
      if (s) this.index(this.data[STRIDE * i + SERIAL] ?? 0, s.kind, this.box(i));
    }
  }

  /** Enters `serial` in the tiles that `box` reaches, as a clearing stroke, a painting one or both. */
  private index(serial: number, kind: EnvTool, box: Box) {
    const [x0, y0, x1, y1] = box;
    for (let ty = y0 >> TILE_BITS; ty << TILE_BITS < y1; ty++)
      for (let tx = x0 >> TILE_BITS; tx << TILE_BITS < x1; tx++) {
        const t = ty * this.cols + tx;
        if (kind === 'erase' || kind === 'wall') (this.clearing[t] ??= new Tile()).push(serial, box);
        if (kind !== 'erase') (this.painting[t] ??= new Tile()).push(serial, box);
        this.entries += kind === 'wall' ? 2 : 1;
      }
  }

  /** Keeps the edits whose index `gone` does not hold, in order. */
  remove(gone: ReadonlySet<number>) {
    let n = least(this.length, gone);
    const flagged = flags(this.length, gone);
    const d = this.data;
    for (let i = n; i < this.length; i++) {
      const k = STRIDE * i;
      const serial = d[k + SERIAL] ?? 0;
      if (flagged[i]) {
        this.where[serial] = -1;
        if (this.indexed) this.stale += this.tiles(i);
        continue;
      }
      if (n < i) for (let c = 0, m = STRIDE * n; c < STRIDE; c++) d[m + c] = d[k + c] ?? 0;
      this.where[serial] = n++;
    }
    compact(this.strokes, gone, flagged);
    compact(this.rows, gone, flagged);
    // The tiles skip the serials of edits that left; once they make up half, the tiles are built again.
    if (this.indexed && 2 * this.stale > this.entries) this.reindex();
  }

  /**
   * How many food, light and wall edits that `dead` does not flag have a box that reaches each tile of `box`: per tile
   * in rows, from the box's first tile.
   */
  alive([x0, y0, x1, y1]: Box, dead: Uint8Array): { count: Int32Array; tiles: Box } {
    const tiles: Box = [x0 >> TILE_BITS, y0 >> TILE_BITS, (x1 - 1) >> TILE_BITS, (y1 - 1) >> TILE_BITS];
    const [tx0, ty0, tx1, ty1] = tiles;
    const count = new Int32Array(Math.max(0, (tx1 - tx0 + 1) * (ty1 - ty0 + 1)));
    // Without the tiles, every tile counts as holding one.
    if (!this.indexed) return { count: count.fill(1), tiles };
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = this.painting[ty * this.cols + tx];
        this.visits += tile?.n ?? 0;
        let n = 0;
        for (let k = 0, end = 5 * (tile?.n ?? 0); tile && k < end; k += 5) {
          const i = this.where[tile.data[k] ?? 0] ?? -1;
          if (i >= 0 && !dead[i]) n++;
        }
        count[(ty - ty0) * (tx1 - tx0 + 1) + tx - tx0] = n;
      }
    return { count, tiles };
  }

  /** How many tile entries edit `i` has. */
  private tiles(i: number) {
    const [x0, y0, x1, y1] = this.box(i);
    if (x1 <= x0 || y1 <= y0) return 0;
    const n = (((x1 - 1) >> TILE_BITS) - (x0 >> TILE_BITS) + 1) * (((y1 - 1) >> TILE_BITS) - (y0 >> TILE_BITS) + 1);
    return this.strokes[i]?.kind === 'wall' ? 2 * n : n;
  }

  /** The runs of edit `i` in row `y`, with `slack`, written to `out` from pair `at` on (Rows.runs()). */
  runs(i: number, y: number, slack: number, outer: boolean, out: number[], at = 0): number {
    let rows = this.rows[i];
    if (!rows) {
      const s = this.strokes[i];
      if (!s) return 0;
      this.rows[i] = rows = new Rows(s, this.w, this.h, s.boundary);
    }
    return rows.runs(y, slack, outer, out, at);
  }

  /** Whether the box of edit `i` holds row `y` and reaches columns x0 … x1. */
  reaches(i: number, y: number, x0: number, x1: number): boolean {
    const [d, k] = [this.data, STRIDE * i];
    return (d[k + 1] ?? 0) <= y && y < (d[k + 3] ?? 0) && (d[k] ?? 0) <= x1 && x0 < (d[k + 2] ?? 0);
  }

  /** The first row of the box of edit `i`, and the row after its last. */
  top(i: number) {
    return this.data[STRIDE * i + 1] ?? 0;
  }

  bottom(i: number) {
    return this.data[STRIDE * i + 3] ?? 0;
  }

  box(i: number): Box {
    const [d, k] = [this.data, STRIDE * i];
    return [d[k] ?? 0, d[k + 1] ?? 0, d[k + 2] ?? 0, d[k + 3] ?? 0];
  }

  /** The indices of the edits whose box overlaps `box`, in order. An empty box overlaps none. */
  near([x0, y0, x1, y1]: Box): number[] {
    const found: number[] = [];
    const d = this.data;
    this.visits += this.length;
    for (let i = 0, k = 0; i < this.length; i++, k += STRIDE)
      if ((d[k] ?? 0) < x1 && x0 < (d[k + 2] ?? 0) && (d[k + 1] ?? 0) < y1 && y0 < (d[k + 3] ?? 0)) found.push(i);
    return found;
  }

  /**
   * Calls `visit` once for each clearing stroke (`clearing`) or painting one whose box overlaps `box` and whose edit
   * lies in the list from index `from` up to `to` (excluded), until it returns true; returns whether one did. Each
   * tile entry holds its edit's box, entries come oldest first, and an edit that reaches several tiles counts in the
   * first one of the scan. A box that reaches more tile entries than the list has edits is checked against the list.
   */
  scan(clearing: boolean, [x0, y0, x1, y1]: Box, visit: (i: number) => boolean, from = 0, to = this.length): boolean {
    if (x1 <= x0 || y1 <= y0 || from >= to) return false;
    const [tx0, ty0, tx1, ty1] = [x0 >> TILE_BITS, y0 >> TILE_BITS, (x1 - 1) >> TILE_BITS, (y1 - 1) >> TILE_BITS];
    const area = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
    const d = this.data;
    if (!this.indexed || area * (this.entries / (this.cols * Math.ceil(this.h / TILE))) > to - from) {
      this.visits += to - from;
      for (let i = from, k = STRIDE * from; i < to; i++, k += STRIDE) {
        const kind = this.strokes[i]?.kind;
        const listed = clearing ? kind === 'erase' || kind === 'wall' : kind !== undefined && kind !== 'erase';
        if (
          listed &&
          (d[k] ?? 0) < x1 &&
          x0 < (d[k + 2] ?? 0) &&
          (d[k + 1] ?? 0) < y1 &&
          y0 < (d[k + 3] ?? 0) &&
          visit(i)
        )
          return true;
      }
      return false;
    }
    // Serials grow with the index: the edits from `from` up to `to` hold the serials in this range.
    const first = d[STRIDE * from + SERIAL] ?? 0;
    const end = to < this.length ? (d[STRIDE * to + SERIAL] ?? 0) : Infinity;
    const { where } = this;
    const tiles = clearing ? this.clearing : this.painting;
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = tiles[ty * this.cols + tx];
        if (!tile) continue;
        const e = tile.data;
        let [lo, hi] = [0, tile.n];
        this.visits += tile.n;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if ((e[5 * mid] ?? 0) < first) lo = mid + 1;
          else hi = mid;
        }
        for (let k = 5 * lo, stop = 5 * tile.n; k < stop; k += 5) {
          const serial = e[k] ?? 0;
          if (serial >= end) break;
          const [ex0, ey0] = [e[k + 1] ?? 0, e[k + 2] ?? 0];
          if (ex0 >= x1 || x0 >= (e[k + 3] ?? 0) || ey0 >= y1 || y0 >= (e[k + 4] ?? 0)) continue;
          if (Math.max(ex0 >> TILE_BITS, tx0) !== tx || Math.max(ey0 >> TILE_BITS, ty0) !== ty) continue;
          const i = where[serial] ?? -1;
          if (i >= 0 && visit(i)) return true;
        }
      }
    return false;
  }

  /** The cell edit `i` leaves open, as the last sweep found it, or OPEN_UNKNOWN, or PAINTS_NONE. */
  open(i: number) {
    return this.data[STRIDE * i + OPEN] ?? OPEN_UNKNOWN;
  }

  /** The first row of edit `i` from which on its cells are not known to be cleared. */
  cursor(i: number) {
    return this.data[STRIDE * i + CURSOR] ?? 0;
  }

  setOpen(i: number, cell: number, cursor = this.cursor(i)) {
    this.data[STRIDE * i + OPEN] = cell;
    this.data[STRIDE * i + CURSOR] = cursor;
  }

  /** The index of the older edit that erase `i` was last found to clear a cell of, or −1. */
  witness(i: number) {
    const serial = this.data[STRIDE * i + WITNESS] ?? -1;
    return serial < 0 ? -1 : (this.where[serial] ?? -1);
  }

  setWitness(i: number, of: number) {
    this.data[STRIDE * i + WITNESS] = this.data[STRIDE * of + SERIAL] ?? -1;
  }
}

/**
 * Whether stroke `C`, recorded after `S`, clears every cell that S paints, exactly: the same segment on this grid,
 * bit for bit, a radius of at least S's and an arena that holds S's. Both paint passes decide every cell of every
 * kind by the same distance to the segment and `d > radius` (shaders/paint.wgsl, gl/glsl/paint.frag), so C's distance
 * to a cell is S's, or less where a periodic C also measures its copies, and its float32 radius is at least S's.
 * Light paints only within its radius. A periodic C over a closed arena's S must be painted as it is
 * (paintedAsIs()), so that its segment is S's.
 */
export function coversExactly(C: Painted | undefined, S: Painted, w: number, h: number): boolean {
  if (!C || !clears(C.kind, S.kind) || C.radius < S.radius) return false;
  const [a, b, p, q] = [C.from, C.to, S.from, S.to];
  if (a[0] !== p[0] || a[1] !== p[1] || b[0] !== q[0] || b[1] !== q[1]) return false;
  if (C.boundary === S.boundary) return true;
  if (C.boundary === 'wrap') return paintedAsIs(C, w, h, true);
  return C.boundary === 'box' && S.boundary === 'dish';
}

/** HAIR of brush.ts for a distance of `r` cells: Rows.runs() moves an edge of that radius by it. */
const hair = (r: number) => 1e-9 * (1 + Math.abs(r));

/**
 * Whether every cell that `S` paints with its brush and arena moved out by SLACK lies in `C`'s with both moved in by
 * SLACK, from their capsules alone: both of S's ends lie within C's reach less S's of C's segment, so S's capsule
 * lies in C's (both are convex), and in a dish both lie within its rim less S's reach. A segment shorter than 1e-3
 * cells is measured from its start (Rows.runs()). A periodic stroke paints every cell near a copy of it one period
 * away, so a periodic C also paints the copies of S's cells; under another C, S's capsule must lie inside the grid.
 * A shortcut for a stroke that one stroke covers.
 */
function inside(S: Painted, C: Painted, w: number, h: number): boolean {
  const s = reachOf(S.kind, S.radius, SLACK);
  const rs = s + hair(s);
  const c = reachOf(C.kind, C.radius, -SLACK);
  const room = c - hair(c) - rs;
  if (room < 0) return false;
  const ends = [S.from, S.to];
  if (S.boundary === 'wrap' && C.boundary !== 'wrap')
    if (ends.some((p) => p[0] - rs < 0 || p[0] + rs > w || p[1] - rs < 0 || p[1] + rs > h)) return false;
  if (C.boundary === 'dish') {
    const d0 = dishRadius(w, h) - SLACK;
    const rim = d0 - hair(d0) - rs;
    if (ends.some((p) => Math.hypot(p[0] - w / 2, p[1] - h / 2) > rim)) return false;
  }
  const [a, b] = [C.from, C.to];
  const short = (b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]) < 1e-6;
  return ends.every((p) => (short ? Math.hypot(p[0] - a[0], p[1] - a[1]) : segmentDistance(p[0], p[1], a, b)) <= room);
}

/**
 * Whether no cell centre lies within both strokes' reach with SLACK: their middles lie farther apart than both half
 * lengths and reaches, and a cell more. A periodic stroke reaches across the edges, so it is never apart.
 */
function apart(S: Painted, E: Painted): boolean {
  if (S.boundary === 'wrap' || E.boundary === 'wrap') return false;
  const half = (s: Painted) =>
    Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]) / 2 + reachOf(s.kind, s.radius, SLACK);
  const [mx, my] = [(S.from[0] + S.to[0] - E.from[0] - E.to[0]) / 2, (S.from[1] + S.to[1] - E.from[1] - E.to[1]) / 2];
  return Math.hypot(mx, my) > half(S) + half(E) + 1;
}

/** The first column of the runs `s` (`ns` of them) that the runs `c` (`nc`, sorted and apart) do not hold, or −1. */
function uncovered(s: readonly number[], ns: number, c: readonly number[], nc: number): number {
  let k = 0;
  for (let j = 0; j < ns; j++) {
    const [x0, x1] = [s[2 * j] ?? 0, s[2 * j + 1] ?? 0];
    while (k < nc && (c[2 * k + 1] ?? 0) < x0) k++;
    if (k === nc || (c[2 * k] ?? 0) > x0) return x0;
    const end = c[2 * k + 1] ?? 0;
    if (end < x1) return end + 1;
  }
  return -1;
}

/** Whether two lists of runs, each sorted and apart, share a column. */
function meet(a: readonly number[], na: number, b: readonly number[], nb: number): boolean {
  for (let i = 0, j = 0; i < na && j < nb;) {
    if ((a[2 * i + 1] ?? 0) < (b[2 * j] ?? 0)) i++;
    else if ((b[2 * j + 1] ?? 0) < (a[2 * i] ?? 0)) j++;
    else return true;
  }
  return false;
}

/**
 * The indices of the edits to delete after the last one of `placement`, a stroke that clears, was recorded on its
 * grid. The GPU computes in float32, so every judgement keeps SLACK: the cells of an edit count with its brush and
 * the dish's rim moved out by it, the cells a clearing stroke surely clears with both moved in. A stroke with the same
 * segment, a radius at least as large and an arena that holds the edit's clears it exactly (coversExactly()).
 *
 * 1. An older food, light or wall edit goes when every cell it paints is cleared by a stroke recorded after it: an
 *    erase clears every kind, a wall food and light. An edit that paints no cell of this grid is kept: the grid cannot
 *    judge it, and on another one it may show.
 * 2. Then an erase goes when no older food, light or wall edit that stays paints a cell it erases: before it those
 *    cells hold zeros, so it changes nothing. The erases looked at are the new stroke and those over an edit that
 *    went, whose work just ended.
 *
 * Both judge a row at a time by its runs of cells (Rows), so a large brush costs its rows, not its cells. Only edits
 * under the new stroke can be cleared by it, so they are the candidates, found by their boxes; the strokes that clear
 * a candidate and the edits under an erase come from the tiles of the placement.
 */
export function sweep(placement: Placement): Set<number> {
  const run = sweeping(placement);
  for (let step = run.next(); ; step = run.next()) if (step.done) return step.value;
}

/** Rows a sweep judges between two pauses (sweeping()); a scan passing 32 edits counts as one. */
const STEP = 32;

/**
 * sweep() for edit `x` of `placement`, which later edits may follow, in steps: it pauses after about STEP rows of
 * work and yields their number, so that a long sweep can wait for the next frame (Engine). While it pauses the list
 * may grow but nothing leaves it; later strokes then count as recorded after the edits they follow.
 */
export function* sweeping(placement: Placement, x = placement.length - 1): Generator<number, Set<number>, void> {
  const { strokes, w, h } = placement;
  const gone = new Set<number>();
  const last = x;
  const X = strokes[last];
  if (!X || (X.kind !== 'erase' && X.kind !== 'wall')) return gone;
  let work = 0;
  let visits = placement.visits;
  /** Rows judged and edits scanned since the last pause. */
  const done = () => {
    const scanned = (placement.visits - visits) / 32;
    visits = placement.visits;
    return (work += scanned) >= STEP;
  };
  const kind = (i: number) => strokes[i]?.kind ?? 'erase';
  /** The edits deleted so far, as flags: the scans ask for every edit they pass. */
  const dead = new Uint8Array(strokes.length);
  const drop = (i: number) => {
    gone.add(i);
    dead[i] = 1;
  };
  const runs = placement.runs.bind(placement);
  const [own, one, all]: [number[], number[], number[]] = [[], [], []];

  /**
   * The first column of the runs `own` (`n` of them, of row `y`) that no stroke of `by` surely clears, or −1. The
   * strokes that cleared the row before (`recent`) usually clear this one, and the new stroke most rows it reaches:
   * they come first, alone.
   */
  const openIn = (y: number, n: number, by: readonly number[], recent: number[]): number => {
    const [x0, x1] = [own[0] ?? 0, own[2 * n - 1] ?? 0];
    let m = 0;
    for (const j of recent.length > 0 ? recent : [last])
      if (placement.reaches(j, y, x0, x1)) m += runs(j, y, -SLACK, false, all, m);
    if (m > 0 && uncovered(own, n, all, joinRuns(all, 0, m)) < 0) return -1;
    // Of all of them, those whose box holds this row and reaches its runs.
    m = 0;
    recent.length = 0;
    for (const j of by)
      if (placement.reaches(j, y, x0, x1)) {
        const k = runs(j, y, -SLACK, false, all, m);
        if (k > 0 && (all[2 * m] ?? 0) <= x1 && (all[2 * (m + k) - 1] ?? 0) >= x0) recent.push(j);
        m += k;
      }
    return uncovered(own, n, all, joinRuns(all, 0, m));
  };

  // 1. Food, light and walls under the new stroke, each against the clearing strokes recorded after it.
  const candidates = placement
    .near(placement.box(last))
    .filter((i) => i < last && kind(i) !== 'erase' && clears(X.kind, kind(i)));
  for (const i of candidates) {
    work++;
    if (done()) {
      yield work;
      work = 0;
    }
    const S = strokes[i];
    const open = placement.open(i);
    if (!S || open === PAINTS_NONE) continue;
    if (open === OPEN_UNKNOWN && !someCell(S, w, h, S.boundary, SLACK, () => true)) {
      placement.setOpen(i, PAINTS_NONE);
      continue;
    }
    if (coversExactly(X, S, w, h) || inside(S, X, w, h)) {
      drop(i);
      continue;
    }
    // A cell left open at the last sweep stays open unless the new stroke clears it.
    const [ox, oy] = [open % w, Math.floor(open / w)];
    if (open >= 0 && uncovered([ox, ox], 1, one, runs(last, oy, -SLACK, false, one)) >= 0) continue;
    const by: number[] = [];
    placement.scan(
      true,
      placement.box(i),
      (j) => {
        if (clears(kind(j), kind(i))) by.push(j);
        return false;
      },
      i + 1,
    );
    if (by.some((j) => coversExactly(strokes[j], S, w, h))) {
      drop(i);
      continue;
    }
    // A row through S's start is wide, and in a dense list often open: it comes first. The rows before the cursor are
    // known to be cleared and stay so; the visit goes on from there.
    const cursor = placement.cursor(i);
    const probe = Math.floor(S.from[1]);
    const recent: number[] = [];
    if (probe >= cursor && probe < placement.bottom(i)) {
      const n = runs(i, probe, SLACK, true, own);
      const x = n > 0 ? openIn(probe, n, by, recent) : -1;
      if (x >= 0) {
        placement.setOpen(i, probe * w + x);
        continue;
      }
    }
    let found = false;
    for (let y = cursor, end = placement.bottom(i); y < end && !found; y++) {
      work++;
      if (done()) {
        yield work;
        work = 0;
      }
      const n = y === probe ? 0 : runs(i, y, SLACK, true, own);
      const x = n > 0 ? openIn(y, n, by, recent) : -1;
      if (x >= 0) placement.setOpen(i, y * w + x, y);
      found = x >= 0;
    }
    if (!found) drop(i);
  }

  // 2. Erases that clear nothing here any more: the new stroke, and those over an edit that went. One scan of the
  // edits under an erase tells both whether one of them went and which older ones stay.
  const erases: [number, number[]][] = [];
  const looked = (j: number, all = false) => {
    let over = all;
    const older: number[] = [];
    const box = placement.box(j);
    placement.scan(
      false,
      box,
      (i) => {
        if (dead[i]) over = true;
        else older.push(i);
        return false;
      },
      0,
      j,
    );
    if (!over) over = placement.scan(false, box, (i) => dead[i] === 1, j + 1);
    if (over) erases.push([j, older]);
  };
  if (X.kind === 'erase') looked(last, true);
  if (gone.size > 0) {
    const area: Box = [w, h, 0, 0];
    for (const i of gone) {
      const [x0, y0, x1, y1] = placement.box(i);
      [area[0], area[1], area[2], area[3]] = [
        Math.min(area[0], x0),
        Math.min(area[1], y0),
        Math.max(area[2], x1),
        Math.max(area[3], y1),
      ];
    }
    if (done()) {
      yield work;
      work = 0;
    }
    // Where every food, light and wall went, an erase over one that went clears nothing: one deleted edit under it
    // is enough to know.
    const { count, tiles } = placement.alive(area, dead);
    if (done()) {
      yield work;
      work = 0;
    }
    const empty = ([x0, y0, x1, y1]: Box) => {
      const [tx0, ty0, tx1, ty1] = tiles;
      for (let ty = y0 >> TILE_BITS; ty <= (y1 - 1) >> TILE_BITS; ty++)
        for (let tx = x0 >> TILE_BITS; tx <= (x1 - 1) >> TILE_BITS; tx++)
          if (tx < tx0 || tx > tx1 || ty < ty0 || ty > ty1 || count[(ty - ty0) * (tx1 - tx0 + 1) + tx - tx0])
            return false;
      return true;
    };
    for (const j of placement.near(area)) {
      if (j === last || kind(j) !== 'erase') continue;
      work++;
      if (done()) {
        yield work;
        work = 0;
      }
      // An erase keeps clearing its witness until that goes.
      const witness = placement.witness(j);
      if (witness >= 0 && !dead[witness]) continue;
      if (!empty(placement.box(j))) looked(j);
      else if (placement.scan(false, placement.box(j), (i) => dead[i] === 1)) drop(j);
    }
  }
  /** Whether erase `j` and edit `i` share a cell, both with brush and rim moved out by SLACK; the rows of i's ends first. */
  const share = (j: number, i: number) => {
    const [S, E] = [strokes[i], strokes[j]];
    if (!S || !E) return false;
    if (apart(S, E)) return false;
    const [y0, y1] = [Math.max(placement.top(j), placement.top(i)), Math.min(placement.bottom(j), placement.bottom(i))];
    const meets = (y: number) => {
      if (y < y0 || y >= y1) return false;
      work++;
      const n = runs(i, y, SLACK, true, own);
      return n > 0 && meet(own, n, one, runs(j, y, SLACK, true, one));
    };
    if (meets(Math.floor(S.from[1])) || meets(Math.floor(S.to[1]))) return true;
    for (let y = y0; y < y1; y++) if (meets(y)) return true;
    return false;
  };
  for (const [j, older] of erases) {
    work++;
    if (done()) {
      yield work;
      work = 0;
    }
    const found = older.find((i) => share(j, i));
    if (found === undefined) drop(j);
    else placement.setWitness(j, found);
  }
  return gone;
}
