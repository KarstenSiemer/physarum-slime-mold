// The measures of Baumgarten, Jones and Hauser 2015 on a trail map (README.md): the vein mask, the smallest circle
// around it, the network coverage ρ = Av / Anet (their Eq. 2, p. 1208) and the lacunae. No import: the harness runs
// this file in the browser, and the Node scripts and the unit test use the same code.

/** A cell is part of a vein if its trail lies above this level, in units of one deposit (5 in the scene): the choice of README.md. */
export const LEVEL = 0.25;
/** A lacuna has at least this many cells, as in ADR 0027 (The scenes of Jones against their figures). */
export const LACUNA_CELLS = 20;

/** The vein mask of a trail map with `lanes` values per cell: 1 where lane 0 lies above `level`. */
export function veinMask(trail: ArrayLike<number>, cells: number, level: number, lanes = 4): Uint8Array {
  const mask = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) mask[c] = (trail[c * lanes] ?? 0) > level ? 1 : 0;
  return mask;
}

type Point = [x: number, y: number];
interface Circle {
  x: number;
  y: number;
  r: number;
}

const inside = (c: Circle, [x, y]: Point) => Math.hypot(x - c.x, y - c.y) <= c.r + 1e-7;
const through2 = ([ax, ay]: Point, [bx, by]: Point): Circle => ({
  x: (ax + bx) / 2,
  y: (ay + by) / 2,
  r: Math.hypot(ax - bx, ay - by) / 2,
});
function through3(a: Point, b: Point, c: Point): Circle {
  const [bx, by, cx, cy] = [b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]];
  const d = 2 * (bx * cy - by * cx);
  // Three points on a line: the circle of the two that lie farthest apart.
  if (Math.abs(d) < 1e-9) {
    const pairs = [through2(a, b), through2(a, c), through2(b, c)];
    return pairs.reduce((best, p) => (p.r > best.r ? p : best));
  }
  const [b2, c2] = [bx * bx + by * by, cx * cx + cy * cy];
  const [ux, uy] = [(cy * b2 - by * c2) / d, (bx * c2 - cx * b2) / d];
  return { x: a[0] + ux, y: a[1] + uy, r: Math.hypot(ux, uy) };
}

/** The convex hull of points (Andrew's chain): only its corners can lie on the smallest circle. */
function hull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half(p.reverse())];
}

/**
 * The smallest circle around the centres of the cells of a mask (the incremental algorithm of Welzl on the corners of
 * the convex hull, in a fixed order, so that a run gives the same circle each time). An empty mask gives r = 0.
 */
export function enclosingCircle(mask: Uint8Array, w: number, h: number): Circle {
  // The first and the last cell of each row hold every corner of the hull.
  const ends: Point[] = [];
  for (let y = 0; y < h; y++) {
    let [first, last] = [-1, -1];
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (first < 0) first = x;
        last = x;
      }
    if (first >= 0) {
      ends.push([first + 0.5, y + 0.5]);
      if (last > first) ends.push([last + 0.5, y + 0.5]);
    }
  }
  const p = hull(ends);
  if (p.length === 0) return { x: w / 2, y: h / 2, r: 0 };
  let c: Circle = { x: p[0]![0], y: p[0]![1], r: 0 };
  for (let i = 1; i < p.length; i++) {
    const pi = p[i]!;
    if (inside(c, pi)) continue;
    c = { x: pi[0], y: pi[1], r: 0 };
    for (let j = 0; j < i; j++) {
      const pj = p[j]!;
      if (inside(c, pj)) continue;
      c = through2(pi, pj);
      for (let k = 0; k < j; k++) {
        const pk = p[k]!;
        if (!inside(c, pk)) c = through3(pi, pj, pk);
      }
    }
  }
  return c;
}

/**
 * The lacunae of a mask: the parts of the rest (joined over 4 neighbours) that do not reach the edge of the lattice
 * and hold at least `min` cells. Their number and their cells.
 */
export function lacunae(mask: Uint8Array, w: number, h: number, min = LACUNA_CELLS): { count: number; cells: number } {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  /** Fills the part of the rest that holds `start`; gives its cells, or −1 if it reaches the edge. */
  const fill = (start: number) => {
    let [size, open] = [0, false];
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const c = stack.pop() ?? 0;
      size++;
      const [x, y] = [c % w, Math.floor(c / w)];
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) open = true;
      for (const d of [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, y > 0 ? c - w : -1, y < h - 1 ? c + w : -1])
        if (d >= 0 && !mask[d] && !seen[d]) {
          seen[d] = 1;
          stack.push(d);
        }
    }
    return open ? -1 : size;
  };
  let [count, cells] = [0, 0];
  for (let c = 0; c < w * h; c++) {
    if (mask[c] || seen[c]) continue;
    const size = fill(c);
    if (size >= min) {
      count++;
      cells += size;
    }
  }
  return { count, cells };
}

export interface Coverage {
  /** Av: the cells of the veins. */
  av: number;
  /** The radius of the smallest circle around the veins, in cells: to the centres of its cells plus half a cell. */
  r: number;
  /** ρ = Av / (π r²). */
  rho: number;
  /** The lacunae and their cells. */
  holes: number;
  holeCells: number;
}

/** The coverage and the lacunae of a vein mask. */
export function coverage(mask: Uint8Array, w: number, h: number): Coverage {
  let av = 0;
  for (let c = 0; c < w * h; c++) av += mask[c] ?? 0;
  const r = av > 0 ? enclosingCircle(mask, w, h).r + 0.5 : 0;
  const { count, cells } = lacunae(mask, w, h);
  const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
  return { av, r: round(r, 2), rho: av > 0 ? round(av / (Math.PI * r * r), 4) : 0, holes: count, holeCells: cells };
}

/** A mask as text: its bits, 8 cells per byte from the low bit, in base64. */
export function maskText(mask: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(mask.length / 8));
  for (let c = 0; c < mask.length; c++) if (mask[c]) bytes[c >> 3] = (bytes[c >> 3] ?? 0) | (1 << (c & 7));
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

/** The mask of maskText() with `cells` cells. */
export function maskOfText(text: string, cells: number): Uint8Array {
  const raw = atob(text);
  const mask = new Uint8Array(cells);
  for (let c = 0; c < cells; c++) mask[c] = (raw.charCodeAt(c >> 3) >> (c & 7)) & 1;
  return mask;
}

/** A link of a graph between the vertices `a` and `b`, with its length in cells. */
export interface Link {
  a: number;
  b: number;
  length: number;
}

/**
 * The veins of a skeleton graph. A chain that ends at no junction is no vein: it is cut off, again and again, until
 * none is left. A vertex with two link ends then joins its two links into one. What stays: the veins between
 * junctions, and for each junction the number of veins that end at it (its degree). A lone ring has no junction and
 * so gives no vein here.
 */
export function veins(links: readonly Link[]): { lengths: number[]; degrees: number[] } {
  let list = links.map((l) => ({ ...l }));
  const ends = () => {
    const d = new Map<number, number>();
    for (const l of list) for (const v of [l.a, l.b]) d.set(v, (d.get(v) ?? 0) + 1);
    return d;
  };
  for (;;) {
    const d = ends();
    const kept = list.filter((l) => l.a === l.b || ((d.get(l.a) ?? 0) > 1 && (d.get(l.b) ?? 0) > 1));
    if (kept.length < list.length) {
      list = kept;
      continue;
    }
    // A vertex with two ends of two different links: one link in place of the two.
    const through = [...d].find(([v, n]) => n === 2 && list.filter((l) => l.a === v || l.b === v).length === 2)?.[0];
    if (through === undefined) break;
    const [p, q] = list.filter((l) => l.a === through || l.b === through) as [Link, Link];
    const other = (l: Link) => (l.a === through ? l.b : l.a);
    list = [...list.filter((l) => l !== p && l !== q), { a: other(p), b: other(q), length: p.length + q.length }];
  }
  // A ring that hangs at no junction (one link from a vertex to itself, alone at it) is no vein between junctions.
  const d = ends();
  list = list.filter((l) => !(l.a === l.b && d.get(l.a) === 2));
  return { lengths: list.map((l) => l.length), degrees: [...ends().values()] };
}
