// The Tokyo layout of Tero et al. 2010 on a square grid with a dish, and Tero's three measures on a trail network.
// Prototype code. Positions: `../data/tokyo_scene.json` (stations from Wikidata, CC0; coast © OpenStreetMap
// contributors, ODbL), in the dish frame: unit = the grid's short side, origin at the centre, x east, y south.
import { readFileSync } from 'node:fs';
import type { EnvShape } from '../../../src/model/presets.ts';
import { buildWorld, type World } from './world.ts';

const DATA = new URL('../data/tokyo_scene.json', import.meta.url).pathname;
/**
 * Two layouts of the map. 'campaign': the map as the prototype ran it on 2026-11-12 (table (b) of ADR 0029). 'app':
 * the map of the app's scene (src/model/tokyo.ts), a little smaller and with the coast farther from Tokyo's seven
 * food sources; the measures of the real engine use it.
 */
export type Layout = 'campaign' | 'app';
/** The map is scaled by this, so that the corners of its rectangle lie inside the dish (radius 0.4725). */
export const mapScale = (layout: Layout = 'campaign') => (layout === 'app' ? 0.965 : 0.975);
const FOOD_R = 0.009;
const WALL_R = 0.004;
/** The three food sources of Fig. 1 that Fig. 2 and the statistics of the paper do not have. */
const EXTRA = ['Utsunomiya', 'Hitachi', 'Ito'];

export interface Tokyo {
  world: World;
  /** One entry per city: its name, its centre in cells, whether it is one of the 33 of Fig. 2. */
  cities: { name: string; x: number; y: number; stat: boolean; reach: number }[];
  /** The city of each food site of the world (Tokyo has seven sites). */
  siteCity: number[];
  /** 1 on land: the open cells joined to Tokyo. */
  land: Uint8Array;
  landCells: number;
}

export function tokyoWorld(n: number, layout: Layout = 'campaign'): Tokyo {
  const d = JSON.parse(readFileSync(DATA, 'utf8')) as {
    arena_rect: [number, number, number, number];
    coast_wall_polyline: [number, number][];
    foods: Record<string, [number, number]>;
  };
  const k = mapScale(layout);
  const sc = ([x, y]: [number, number]): [number, number] => [x * k, y * k];
  const shapes: EnvShape[] = [];
  const wall = (a: [number, number], b: [number, number]) =>
    shapes.push({ kind: 'wall', at: sc(a), to: sc(b), r: WALL_R * k });
  // The coast as OpenStreetMap gives it, simplified to 2 km, passes over some harbour cities. Where the line comes
  // nearer to a city than CLEAR, the part of the line inside that circle becomes the arc of the circle on the seaward
  // side. The line runs from south to north with the land on its left, so the arc keeps the city on the left: in
  // these coordinates (y down) its angle falls.
  let coast: [number, number][] = d.coast_wall_polyline.map((q) => [q[0], q[1]]);
  for (const [cityName, c] of Object.entries(d.foods)) {
    // Tokyo is seven food sources: six lie 0.018 from the station, so in the app its circle is wider
    // (src/model/tokyo.ts).
    const wide = layout === 'app' && cityName === 'Tokyo';
    const CLEAR = wide ? FOOD_R + 0.018 + WALL_R + 0.002 : FOOD_R + WALL_R + 0.006;
    const hits: { i: number; t: number; p: [number, number] }[] = [];
    for (let i = 0; i + 1 < coast.length; i++) {
      const [a, b] = [coast[i]!, coast[i + 1]!];
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const [fx, fy] = [a[0] - c[0], a[1] - c[1]];
      const qa = dx * dx + dy * dy;
      const qb = 2 * (fx * dx + fy * dy);
      const qc = fx * fx + fy * fy - CLEAR * CLEAR;
      const disc = qb * qb - 4 * qa * qc;
      if (disc <= 0) continue;
      for (const t of [(-qb - Math.sqrt(disc)) / (2 * qa), (-qb + Math.sqrt(disc)) / (2 * qa)])
        if (t >= 0 && t <= 1) hits.push({ i, t, p: [a[0] + t * dx, a[1] + t * dy] });
    }
    if (hits.length < 2) continue;
    const [first, last] = [hits[0]!, hits[hits.length - 1]!];
    const a0 = Math.atan2(first.p[1] - c[1], first.p[0] - c[0]);
    let a1 = Math.atan2(last.p[1] - c[1], last.p[0] - c[0]);
    if (a1 > a0) a1 -= 2 * Math.PI;
    const arc: [number, number][] = [];
    const parts = Math.max(2, Math.ceil((a0 - a1) / 0.35));
    for (let j = 0; j <= parts; j++) {
      const ang = a0 + ((a1 - a0) * j) / parts;
      arc.push([c[0] + CLEAR * Math.cos(ang), c[1] + CLEAR * Math.sin(ang)]);
    }
    coast = [...coast.slice(0, first.i + 1), ...arc, ...coast.slice(last.i + 1)];
  }
  for (let i = 0; i + 1 < coast.length; i++) wall(coast[i]!, coast[i + 1]!);
  const [x0, y0, , y1] = d.arena_rect;
  const north = coast[coast.length - 1]!;
  const south = coast[0]!;
  wall([x0, y0], [north[0], y0]);
  wall([x0, y0], [x0, y1]);
  wall([x0, y1], [south[0], y1]);
  const names = Object.keys(d.foods);
  const siteCity: number[] = [];
  const cities: Tokyo['cities'] = [];
  names.forEach((name, ci) => {
    const p = d.foods[name]!;
    // Tokyo is an aggregate of seven food sources (Tero 2010, Fig. 4): a centre and a hexagon around it.
    const dabs: [number, number][] =
      name === 'Tokyo'
        ? [
            [0, 0],
            [0.018, 0],
            [-0.018, 0],
            [0.009, 0.0156],
            [0.009, -0.0156],
            [-0.009, 0.0156],
            [-0.009, -0.0156],
          ]
        : [[0, 0]];
    for (const [dx, dy] of dabs) {
      shapes.push({ kind: 'food', at: sc([p[0] + dx, p[1] + dy]), r: FOOD_R * k });
      siteCity.push(ci);
    }
    // Skeleton pixels within `reach` of the centre belong to the city: its disc (Tokyo: its seven discs) plus 2 cells.
    const reach = ((name === 'Tokyo' ? 0.018 : 0) + FOOD_R) * k * n + 2;
    cities.push({ name, x: n / 2 + p[0] * k * n, y: n / 2 + p[1] * k * n, stat: !EXTRA.includes(name), reach });
  });
  const world = buildWorld(n, n, 'dish', shapes);
  // Land: the open cells joined to Tokyo.
  const land = new Uint8Array(n * n);
  const start = Math.floor(cities[0]!.y) * n + Math.floor(cities[0]!.x);
  const stack = [start];
  land[start] = 1;
  let landCells = 1;
  while (stack.length > 0) {
    const c = stack.pop()!;
    const x = c % n;
    for (const nc of [x > 0 ? c - 1 : -1, x < n - 1 ? c + 1 : -1, c - n, c + n]) {
      if (nc < 0 || nc >= n * n || land[nc] || !world.open[nc]) continue;
      land[nc] = 1;
      landCells++;
      stack.push(nc);
    }
  }
  return { world, cities, siteCity, land, landCells };
}

// --- The network of a trail map as a graph -------------------------------------------------------------------

/** Zhang–Suen thinning of a mask, in place. */
export function thin(mask: Uint8Array, w: number, h: number) {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]!);
  let changed = true;
  const del: number[] = [];
  while (changed) {
    changed = false;
    for (const phase of [0, 1]) {
      del.length = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!mask[y * w + x]) continue;
          const p = [
            at(x, y - 1),
            at(x + 1, y - 1),
            at(x + 1, y),
            at(x + 1, y + 1),
            at(x, y + 1),
            at(x - 1, y + 1),
            at(x - 1, y),
            at(x - 1, y - 1),
          ];
          const b = p.reduce((s, v) => s + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
          if (a !== 1) continue;
          const [n0, e, s0, wv] = [p[0]!, p[2]!, p[4]!, p[6]!];
          if (phase === 0 ? n0 * e * s0 === 0 && e * s0 * wv === 0 : n0 * e * wv === 0 && n0 * s0 * wv === 0)
            del.push(y * w + x);
        }
      for (const c of del) mask[c] = 0;
      if (del.length > 0) changed = true;
    }
  }
}

/**
 * Length of a chain of points: the chain is simplified first (Douglas–Peucker, 1.5 cells), so that the steps of the
 * pixels do not count. Tero's graphs have straight pieces between junctions too.
 */
function chainLength(pts: [number, number][]): number {
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a]!;
    const [bx, by] = pts[b]!;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let [far, at] = [0, -1];
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      const dist =
        len > 1e-9 ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
      if (dist > far) [far, at] = [dist, i];
    }
    if (far > 1.5 && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  let total = 0;
  let last = pts[0]!;
  for (let i = 1; i < pts.length; i++) {
    if (!keep[i]) continue;
    total += Math.hypot(pts[i]![0] - last[0], pts[i]![1] - last[1]);
    last = pts[i]!;
  }
  return total;
}

export interface Network {
  /** Vertices: the cities first (index = city), then junctions. */
  vertices: number;
  links: { a: number; b: number; length: number }[];
}

/**
 * The graph of a network mask: one vertex per city (the skeleton pixels within `reach` cells of its centre), one per
 * cluster of junction pixels; a link is a chain of skeleton pixels between two vertices. Dangling chains stay: the
 * measures prune them. Lengths are in cells (chainLength).
 */
export function network(
  mask: Uint8Array,
  w: number,
  h: number,
  cities: { x: number; y: number; reach: number }[],
): Network {
  const skel = mask.slice();
  // The discs of the cities are part of the network where a tube touches them: fill them, so that the skeleton passes
  // through the centre region, then thin.
  thin(skel, w, h);
  const n = w * h;
  // Vertex of each skeleton pixel: a city, or −1.
  const owner = new Int32Array(n).fill(-1);
  for (let c = 0; c < n; c++) {
    if (!skel[c]) continue;
    const [x, y] = [c % w, Math.floor(c / w)];
    for (let i = 0; i < cities.length; i++) {
      if (Math.hypot(x + 0.5 - cities[i]!.x, y + 0.5 - cities[i]!.y) <= cities[i]!.reach) {
        owner[c] = i;
        break;
      }
    }
  }
  // Pixel adjacency: 4-neighbours, and diagonal neighbours that share no 4-neighbour on the skeleton.
  const nb = (c: number): number[] => {
    const [x, y] = [c % w, Math.floor(c / w)];
    const out: number[] = [];
    const on = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < w && yy < h && skel[yy * w + xx] === 1;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      if (on(x + dx, y + dy)) out.push((y + dy) * w + x + dx);
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const)
      if (on(x + dx, y + dy) && !on(x + dx, y) && !on(x, y + dy)) out.push((y + dy) * w + x + dx);
    return out;
  };
  // Junction pixels (3 or more neighbours) outside the cities, in clusters.
  let vertices = cities.length;
  for (let c = 0; c < n; c++) {
    if (!skel[c] || owner[c] !== -1 || nb(c).length < 3) continue;
    const id = vertices++;
    const stack = [c];
    owner[c] = id;
    while (stack.length > 0) {
      const u = stack.pop()!;
      for (const v of nb(u))
        if (owner[v] === -1 && nb(v).length >= 3) {
          owner[v] = id;
          stack.push(v);
        }
    }
  }
  // End pixels of dangling chains are vertices too, so that every chain has two ends.
  for (let c = 0; c < n; c++) if (skel[c] && owner[c] === -1 && nb(c).length <= 1) owner[c] = vertices++;
  // Where each vertex lies: a city at its centre, a junction or an end at the mean of its pixels.
  const pos: { x: number; y: number; k: number }[] = cities.map((c) => ({ x: c.x, y: c.y, k: -1 }));
  for (let c = 0; c < n; c++) {
    const o = owner[c]!;
    if (o < cities.length) continue;
    const q = (pos[o] ??= { x: 0, y: 0, k: 0 });
    q.x += (c % w) + 0.5;
    q.y += Math.floor(c / w) + 0.5;
    q.k++;
  }
  for (const q of pos) if (q.k > 0) [q.x, q.y] = [q.x / q.k, q.y / q.k];
  const at = (c: number): [number, number] => [(c % w) + 0.5, Math.floor(c / w) + 0.5];
  const vertexAt = (c: number): [number, number] => [pos[owner[c]!]!.x, pos[owner[c]!]!.y];
  // Chains: from every vertex pixel, walk each neighbour that belongs to no vertex until a vertex pixel. The length of
  // a link is that of the chain from vertex to vertex.
  const links: Network['links'] = [];
  const direct = new Map<string, number>();
  const seen = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    if (!skel[c] || owner[c] === -1) continue;
    for (const first of nb(c)) {
      if (owner[first] !== -1) {
        // Two vertex pixels side by side: one link between the two vertices, the shortest of such pairs.
        if (owner[first] !== owner[c]) {
          const key = `${Math.min(owner[c]!, owner[first]!)},${Math.max(owner[c]!, owner[first]!)}`;
          const len = chainLength([vertexAt(c), at(c), at(first), vertexAt(first)]);
          if (len < (direct.get(key) ?? Infinity)) direct.set(key, len);
        }
        continue;
      }
      if (seen[first]) continue;
      let [prev, cur] = [c, first];
      const pts: [number, number][] = [vertexAt(c), at(c), at(first)];
      seen[cur] = 1;
      for (let guard = 0; guard < n; guard++) {
        const next = nb(cur).filter((v) => v !== prev);
        // Prefer a vertex pixel; a chain pixel has one way on.
        const to = next.find((v) => owner[v] !== -1) ?? next.find((v) => !seen[v]);
        if (to === undefined) break;
        pts.push(at(to));
        prev = cur;
        cur = to;
        if (owner[cur] !== -1) break;
        seen[cur] = 1;
      }
      // A chain that comes back to its own vertex is no link.
      if (owner[cur] !== -1 && owner[cur] !== owner[c]) {
        pts.push(vertexAt(cur));
        links.push({ a: owner[c]!, b: owner[cur]!, length: chainLength(pts) });
      }
    }
  }
  for (const [key, length] of direct) {
    const [a, b] = key.split(',').map(Number) as [number, number];
    links.push({ a, b, length });
  }
  return { vertices, links };
}

export interface Measures {
  /** Cities of the set that the network joins to the first city of the set, and the size of the set. */
  joined: number;
  cities: number;
  links: number;
  /** Total length, mean shortest distance between two cities and fault tolerance, each over the value of the MST. */
  tl: number;
  md: number;
  ft: number;
}

function dijkstra(n: number, adj: [number, number][][], s: number): Float64Array {
  const dist = new Float64Array(n).fill(Infinity);
  dist[s] = 0;
  const done = new Uint8Array(n);
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = 1;
    for (const [v, wgt] of adj[u]!) if (dist[u]! + wgt < dist[v]!) dist[v] = dist[u]! + wgt;
  }
  return dist;
}

/** The MST of points (Prim): its length and its links. */
export function mst(points: { x: number; y: number }[]) {
  const n = points.length;
  const inTree = new Uint8Array(n);
  const best = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  best[0] = 0;
  let length = 0;
  const links: { a: number; b: number; length: number }[] = [];
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i]! < best[u]!)) u = i;
    inTree[u] = 1;
    length += best[u]!;
    if (parent[u]! >= 0) links.push({ a: parent[u]!, b: u, length: best[u]! });
    for (let v = 0; v < n; v++) {
      const d = Math.hypot(points[u]!.x - points[v]!.x, points[u]!.y - points[v]!.y);
      if (!inTree[v] && d < best[v]!) {
        best[v] = d;
        parent[v] = u;
      }
    }
  }
  return { length, links };
}

/**
 * Tero's measures (2010, p. 440) of a network for the cities in `set` (indices): TL over the MST's, MD over the MST's
 * (mean shortest way between two cities of the set), and FT, the share of the links whose loss leaves all cities of the
 * set joined. Chains that end at no city of the set are pruned first: they add length and nothing else.
 */
export function measures(net: Network, cities: { x: number; y: number }[], set: number[]): Measures {
  const inSet = new Uint8Array(net.vertices);
  for (const i of set) inSet[i] = 1;
  let links = net.links.slice();
  // Prune: remove links at vertices of degree 1 that are no city of the set, again and again.
  for (;;) {
    const deg = new Int32Array(net.vertices);
    for (const l of links) {
      deg[l.a]!++;
      deg[l.b]!++;
    }
    const keep = links.filter((l) => (deg[l.a]! > 1 || inSet[l.a]) && (deg[l.b]! > 1 || inSet[l.b]) && l.a !== l.b);
    if (keep.length === links.length) break;
    links = keep;
  }
  // Merge chains through vertices of degree 2 that are no city: a link runs from city or junction to city or junction.
  for (;;) {
    const at: number[][] = Array.from({ length: net.vertices }, () => []);
    links.forEach((l, i) => {
      at[l.a]!.push(i);
      at[l.b]!.push(i);
    });
    const v = at.findIndex((ls, i) => ls.length === 2 && !inSet[i] && ls[0] !== ls[1]);
    if (v < 0) break;
    const [i, j] = at[v] as [number, number];
    const [l1, l2] = [links[i]!, links[j]!];
    const a = l1.a === v ? l1.b : l1.a;
    const b = l2.a === v ? l2.b : l2.a;
    links = links.filter((_, k) => k !== i && k !== j);
    if (a !== b) links.push({ a, b, length: l1.length + l2.length });
  }
  const adjOf = (ls: typeof links) => {
    const adj: [number, number][][] = Array.from({ length: net.vertices }, () => []);
    for (const l of ls) {
      adj[l.a]!.push([l.b, l.length]);
      adj[l.b]!.push([l.a, l.length]);
    }
    return adj;
  };
  const adj = adjOf(links);
  const from0 = dijkstra(net.vertices, adj, set[0]!);
  const joinedSet = set.filter((i) => Number.isFinite(from0[i]!));
  let [sum, pairs] = [0, 0];
  for (let i = 0; i < joinedSet.length; i++) {
    const d = dijkstra(net.vertices, adj, joinedSet[i]!);
    for (let j = i + 1; j < joinedSet.length; j++) {
      sum += d[joinedSet[j]!]!;
      pairs++;
    }
  }
  // Only the links of the component of the first city count.
  const live = links.filter((l) => Number.isFinite(from0[l.a]!));
  const tlNet = live.reduce((s, l) => s + l.length, 0);
  let ok = 0;
  for (let k = 0; k < live.length; k++) {
    const d = dijkstra(net.vertices, adjOf(live.filter((_, i) => i !== k)), joinedSet[0]!);
    if (joinedSet.every((i) => Number.isFinite(d[i]!))) ok++;
  }
  // The MST of the cities of the set that are joined, and its mean distance.
  const pts = joinedSet.map((i) => cities[i]!);
  const tree = mst(pts);
  const tadj: [number, number][][] = Array.from({ length: pts.length }, () => []);
  for (const l of tree.links) {
    tadj[l.a]!.push([l.b, l.length]);
    tadj[l.b]!.push([l.a, l.length]);
  }
  let [msum, mpairs] = [0, 0];
  for (let i = 0; i < pts.length; i++) {
    const d = dijkstra(pts.length, tadj, i);
    for (let j = i + 1; j < pts.length; j++) {
      msum += d[j]!;
      mpairs++;
    }
  }
  return {
    joined: joinedSet.length,
    cities: set.length,
    links: live.length,
    tl: tlNet / tree.length,
    md: pairs > 0 ? sum / pairs / (msum / mpairs) : 0,
    ft: live.length > 0 ? ok / live.length : 0,
  };
}

/** The network mask of a trail map: cells with trail above `level`, and the food discs. */
export function networkMask(world: World, trail: Float32Array, level: number): Uint8Array {
  const n = world.w * world.h;
  const mask = new Uint8Array(n);
  for (let c = 0; c < n; c++) mask[c] = world.open[c] && (trail[c]! > level || world.food[c]) ? 1 : 0;
  return mask;
}
