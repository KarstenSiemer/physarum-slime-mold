// The measures of the scene Voronoi diagram (ADR 0048, README.md): the Voronoi diagram of the repellent dots inside
// the dish, and how well a network lies on it. No import: the harness runs this file in the browser, and the Node
// scripts and the unit test use the same code.

export type Point = readonly [x: number, y: number];

/** The dish of a run: its centre and the dots in cell coordinates (the centre of cell 0 is 0.5), and the lattice. */
export interface Dish {
  w: number;
  h: number;
  centre: Point;
  dots: readonly Point[];
}

/** A point of an edge of the diagram, with the number of its edge: the edge between the dots i and j has i · n + j. */
export type EdgePoint = readonly [x: number, y: number, edge: number];

/** A network cell counts as on an edge, and an edge point as covered, within this many cells. */
export const NEAR = 3;
/** The network draws an edge if it covers this share of the edge's length inside the circle. */
export const WHOLE = 0.5;
/** The edges are a chain of points this many cells apart. */
export const EDGE_STEP = 0.25;

/**
 * The edges of the Voronoi diagram of `dots` inside the circle of `radius` around `centre`, as points EDGE_STEP apart:
 * the points of the bisector of each pair of dots that lie no nearer to a third dot. The length of the edges is the
 * number of points times EDGE_STEP. Each point names its edge, the pair of dots that it lies between.
 */
export function voronoiEdges(dots: readonly Point[], centre: Point, radius: number): EdgePoint[] {
  const out: EdgePoint[] = [];
  for (let i = 0; i < dots.length; i++)
    for (let j = i + 1; j < dots.length; j++) {
      const [a, b] = [dots[i]!, dots[j]!];
      const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // The bisector runs through the middle of the two dots, across their line.
      const [ex, ey] = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
      const reach = Math.ceil((2 * radius + Math.hypot(mx - centre[0], my - centre[1])) / EDGE_STEP);
      for (let k = -reach; k <= reach; k++) {
        const [x, y] = [mx + k * EDGE_STEP * ex, my + k * EDGE_STEP * ey];
        if (Math.hypot(x - centre[0], y - centre[1]) > radius) continue;
        const own = Math.hypot(x - a[0], y - a[1]);
        if (dots.every((d) => Math.hypot(x - d[0], y - d[1]) >= own - 1e-9)) out.push([x, y, i * dots.length + j]);
      }
    }
  return out;
}

/** For each cell of a `w` × `h` lattice the distance from its centre to the nearest of `points`, in cells. */
export function distanceTo(points: readonly (Point | EdgePoint)[], w: number, h: number): Float32Array {
  const out = new Float32Array(w * h).fill(Infinity);
  // Buckets of 8 × 8 cells: a cell looks at the points of the buckets around it, in rings, until none can be nearer.
  const B = 8;
  const [bw, bh] = [Math.ceil(w / B), Math.ceil(h / B)];
  const buckets: (Point | EdgePoint)[][] = Array.from({ length: bw * bh }, () => []);
  for (const p of points) {
    const [bx, by] = [Math.floor(p[0] / B), Math.floor(p[1] / B)];
    if (bx >= 0 && by >= 0 && bx < bw && by < bh) buckets[by * bw + bx]?.push(p);
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [px, py] = [x + 0.5, y + 0.5];
      const [bx, by] = [Math.floor(x / B), Math.floor(y / B)];
      let best = Infinity;
      for (let ring = 0; ring < Math.max(bw, bh); ring++) {
        // Every point of a bucket `ring` buckets away lies at least (ring − 1) · B cells away.
        if (best <= (ring - 1) * B) break;
        for (let v = by - ring; v <= by + ring; v++)
          for (let u = bx - ring; u <= bx + ring; u++) {
            if (Math.max(Math.abs(u - bx), Math.abs(v - by)) !== ring) continue;
            if (u < 0 || v < 0 || u >= bw || v >= bh) continue;
            for (const q of buckets[v * bw + u] ?? []) best = Math.min(best, Math.hypot(q[0] - px, q[1] - py));
          }
      }
      out[y * w + x] = best;
    }
  return out;
}

/** The edges of the diagram of a dish inside the circle of `radius`, and the distance of every cell from them. */
export function edgeField(dish: Dish, radius: number) {
  const edges = voronoiEdges(dish.dots, dish.centre, radius);
  return { edges, toEdge: distanceTo(edges, dish.w, dish.h) };
}

export interface Score {
  /** The cells of the network inside the circle of the measure. */
  cells: number;
  /** The share of those cells within NEAR cells of a Voronoi edge. */
  onEdge: number;
  /** The share of all cells inside the circle within NEAR cells of an edge: what cells at random would give. */
  chance: number;
  /** The share of the length of the edges inside the circle with a network cell within NEAR cells. */
  covered: number;
  /** The mean distance of a network cell inside the circle from the nearest edge, in cells. */
  distance: number;
  /** The edges of the diagram inside the circle, and those of them that the network draws: covered to WHOLE. */
  edges: number;
  drawn: number;
}

/**
 * How well the network `mask` lies on the Voronoi diagram of the dots, inside the circle of `radius` around the
 * centre of the dish (README.md, Definitions). The rim of the dish lies outside the circle: there the ring of
 * attractant holds a band of agents that belongs to no edge.
 */
export function score(mask: Uint8Array, dish: Dish, radius: number, near = NEAR, field = edgeField(dish, radius)) {
  const { w, h, centre } = dish;
  const { edges, toEdge } = field;
  let [cells, on, all, allOn, sum] = [0, 0, 0, 0, 0];
  for (let c = 0; c < w * h; c++) {
    const [x, y] = [(c % w) + 0.5, Math.floor(c / w) + 0.5];
    if (Math.hypot(x - centre[0], y - centre[1]) > radius) continue;
    const d = toEdge[c] ?? Infinity;
    all++;
    if (d <= near) allOn++;
    if (!mask[c]) continue;
    cells++;
    sum += d;
    if (d <= near) on++;
  }
  // An edge point is covered by a network cell of the whole lattice: a vein that leaves the circle still covers it.
  let covered = 0;
  const perEdge = new Map<number, [covered: number, points: number]>();
  for (const [x, y, edge] of edges) {
    // The cells around the point, far enough to hold every cell within `near` of it.
    let best = Infinity;
    const [cx, cy] = [Math.floor(x), Math.floor(y)];
    for (let v = cy - near - 1; v <= cy + near + 1; v++)
      for (let u = cx - near - 1; u <= cx + near + 1; u++)
        if (u >= 0 && v >= 0 && u < w && v < h && mask[v * w + u])
          best = Math.min(best, Math.hypot(u + 0.5 - x, v + 0.5 - y));
    const tally = perEdge.get(edge) ?? [0, 0];
    perEdge.set(edge, [tally[0] + (best <= near ? 1 : 0), tally[1] + 1]);
    if (best <= near) covered++;
  }
  const share = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1e4) / 1e4 : 0);
  const out: Score = {
    cells,
    onEdge: share(on, cells),
    chance: share(allOn, all),
    covered: share(covered, edges.length),
    distance: cells > 0 ? Math.round((sum / cells) * 100) / 100 : 0,
    edges: perEdge.size,
    drawn: [...perEdge.values()].filter(([n, of]) => n >= WHOLE * of).length,
  };
  return out;
}

export interface Cells {
  /** The parts of the rest of the mask that hold a dot (joined over 4 neighbours). */
  parts: number;
  /** The dots that are alone in their part, and whose part does not reach the edge of the lattice. */
  alone: number;
  /** The dots that lie on a cell of the network. */
  covered: number;
}

/**
 * The cells of the diagram that the network draws: each dot should lie alone in a part of the dish that the network
 * closes off. `open` marks the cells of the dish (1); a part that touches a cell outside it is not closed.
 */
export function cellsOfDots(mask: Uint8Array, open: Uint8Array, dish: Dish): Cells {
  const { w, h, dots } = dish;
  const part = new Int32Array(w * h).fill(-1);
  const closed: boolean[] = [];
  const stack: number[] = [];
  const cellOf = ([x, y]: Point) => Math.floor(y) * w + Math.floor(x);
  let covered = 0;
  for (const dot of dots) {
    const start = cellOf(dot);
    if (mask[start]) {
      covered++;
      continue;
    }
    if ((part[start] ?? -1) >= 0) continue;
    const id = closed.length;
    let shut = true;
    part[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const c = stack.pop() ?? 0;
      const [x, y] = [c % w, Math.floor(c / w)];
      for (const d of [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, y > 0 ? c - w : -1, y < h - 1 ? c + w : -1]) {
        if (d < 0 || !open[d]) {
          shut = false;
          continue;
        }
        if (mask[d] || (part[d] ?? -1) >= 0) continue;
        part[d] = id;
        stack.push(d);
      }
    }
    closed.push(shut);
  }
  const perPart = new Map<number, number>();
  for (const dot of dots) {
    const id = part[cellOf(dot)] ?? -1;
    if (id >= 0) perPart.set(id, (perPart.get(id) ?? 0) + 1);
  }
  let alone = 0;
  for (const [id, n] of perPart) if (n === 1 && closed[id]) alone++;
  return { parts: perPart.size, alone, covered };
}

/** The mask of the cells that hold an agent: `agents` as readAgents() gives them, alive by `alive`. */
export function occupancy(
  agents: readonly { x: number; y: number; bits: number }[],
  w: number,
  h: number,
  alive: (bits: number) => boolean,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (const a of agents) {
    if (!alive(a.bits)) continue;
    const [x, y] = [Math.floor(a.x), Math.floor(a.y)];
    if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1;
  }
  return mask;
}

/** The cells of the app's dish on a `w` × `h` lattice: 1 where the centre lies within 0.945 of half the short side. */
export function dishCells(w: number, h: number, fill = 0.945): Uint8Array {
  const open = new Uint8Array(w * h);
  const r = (fill * Math.min(w, h)) / 2;
  for (let c = 0; c < w * h; c++)
    open[c] = Math.hypot((c % w) + 0.5 - w / 2, Math.floor(c / w) + 0.5 - h / 2) <= r ? 1 : 0;
  return open;
}

/**
 * The run of deflect.gpu.test.ts, read from Fig. 8 of Jones and Adamatzky 2015 in cells from the centre of its
 * lattice of 200 × 200 cells: the two attractants, and the three repellents in the order in which the figure adds
 * them (y grows downward, so the first one lies below the path). A repellent of the figure has about 80 cells; a
 * smooth dot with a radius of 7.6 cells releases as much (README.md).
 */
export const DEFLECT = {
  side: 200,
  density: 0.05,
  foods: [
    [-82.5, -0.5],
    [77.5, -0.5],
  ],
  foodRadius: 2.5,
  repellents: [
    [4.5, 11],
    [4.5, -3],
    [4.5, -20],
  ],
  repellentRadius: 7.6,
  /** The figure's path at the middle of the dish after 0, 1, 2 and 3 repellents: cells above the line of the foods. */
  paper: [0, 16.5, 32.5, 51],
} as const;

/**
 * Where the network crosses the columns `from` to `to` (cells from the centre of the lattice): the mean height of
 * its cells above the line y = `line`, and the span from the lowest to the highest of them. One path has a small
 * span; a loop around a repellent has a large one.
 */
export function crossing(mask: Uint8Array, w: number, h: number, from: number, to: number, line: number) {
  let [n, sum, low, high] = [0, 0, Infinity, -Infinity];
  for (let y = 0; y < h; y++)
    for (let x = Math.floor(w / 2 + from); x <= Math.floor(w / 2 + to); x++) {
      if (!mask[y * w + x]) continue;
      const up = line - (y + 0.5 - h / 2);
      n++;
      sum += up;
      [low, high] = [Math.min(low, up), Math.max(high, up)];
    }
  return n > 0 ? { cells: n, up: sum / n, span: high - low } : { cells: 0, up: 0, span: 0 };
}
