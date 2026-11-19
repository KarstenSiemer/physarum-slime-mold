// Measures of the crown at the head of a tube, for a colony in a lane that grows along y (comb.ts scene=lane).
// Prototype code. The targets are those of TODO.md, stage 4, and of the handover for stage 4.
import { FLOW } from '../../src/engine/flow';
import { VEIN, type Sim } from './sim';

/** The rows of the lane: per row the plasm cells, the tube cells and the veins across it. */
export interface Row {
  y: number;
  /** Cells with plasm (trail at or above the low level), and their extent from the first to the last one. */
  plasm: number;
  extent: number;
  /** Ridges of the flow memory across the row: local maxima of D on tube cells, at least `minD`, 2 cells apart. */
  veins: number;
  /** The mean width of these ridges at half their height, in cells. */
  veinWidth: number;
}

const low = (sim: Sim) => 0.2 * sim.p.deposit;

export function rows(sim: Sim, minD = 0.05): Row[] {
  const { w, h } = sim;
  const out: Row[] = [];
  for (let y = 0; y < h; y++) {
    let [plasm, first, last] = [0, -1, -1];
    const d: number[] = [];
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      const on = sim.layout.open[c] === 1 && sim.trail[c]! >= low(sim);
      if (on) {
        plasm++;
        if (first < 0) first = x;
        last = x;
      }
      d.push(sim.B[c]! >= FLOW.bodyLow ? sim.D[c]! : 0);
    }
    // Ridges: a local maximum of a profile smoothed over 3 cells, above minD, with a drop of a quarter on each side.
    const sm = d.map((_, x) => ((d[x - 1] ?? 0) + 2 * d[x]! + (d[x + 1] ?? 0)) / 4);
    const peaks: number[] = [];
    const widths: number[] = [];
    for (let x = 1; x < w - 1; x++) {
      const v = sm[x]!;
      if (v < minD || v < sm[x - 1]! || v < sm[x + 1]!) continue;
      let a = x;
      while (a > 0 && sm[a - 1]! <= sm[a]! && sm[a - 1]! > 0.5 * v) a--;
      let b = x;
      while (b < w - 1 && sm[b + 1]! <= sm[b]! && sm[b + 1]! > 0.5 * v) b++;
      const leftDrop = a === 0 || sm[a - 1]! <= 0.75 * v;
      const rightDrop = b === w - 1 || sm[b + 1]! <= 0.75 * v;
      if (!leftDrop || !rightDrop) continue;
      if (peaks.length > 0 && x - peaks[peaks.length - 1]! < 2) continue;
      peaks.push(x);
      widths.push(b - a + 1);
    }
    out.push({
      y,
      plasm,
      extent: first < 0 ? 0 : last - first + 1,
      veins: peaks.length,
      veinWidth: widths.length > 0 ? widths.reduce((s, v) => s + v, 0) / widths.length : 0,
    });
  }
  return out;
}

/** The front of the lane: the last row (largest y) that holds plasm. */
export const frontRow = (r: Row[]) => r.reduce((m, row) => (row.plasm > 0 ? Math.max(m, row.y) : m), -1);

export interface Crown {
  front: number;
  /** The widest extent of plasm within 20 rows behind the front, and the median extent 40 to 80 rows behind it. */
  crown: number;
  tube: number;
  /** Veins across a row: the mean over the 20 rows behind the front, and over the rows 40 to 80 behind it. */
  veinsFront: number;
  veinsBack: number;
  widthFront: number;
  widthBack: number;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const mean = (v: number[]) => (v.length === 0 ? 0 : v.reduce((s, x) => s + x, 0) / v.length);

export function crown(sim: Sim): Crown {
  const r = rows(sim);
  const f = frontRow(r);
  const near = r.filter((row) => row.y <= f && row.y > f - 20 && row.plasm > 0);
  const back = r.filter((row) => row.y <= f - 40 && row.y > f - 80 && row.plasm > 0);
  return {
    front: f,
    crown: Math.max(0, ...near.map((row) => row.extent)),
    tube: median(back.map((row) => row.extent)),
    veinsFront: mean(near.map((row) => row.veins)),
    veinsBack: mean(back.map((row) => row.veins)),
    widthFront: mean(near.filter((row) => row.veins > 0).map((row) => row.veinWidth)),
    widthBack: mean(back.filter((row) => row.veins > 0).map((row) => row.veinWidth)),
  };
}

/**
 * Whether the veins lie along the flow: at every tube cell with D at least VEIN that is a ridge across its row or its
 * column, the angle between the direction of the ridge (the axis of least curvature of D) and the direction of the
 * flux of lane 0. Returns the mean of |cos| (1: along the flow, 0.64: at random) and the number of cells.
 */
export function alignment(sim: Sim): { cos: number; cells: number } {
  const { w, h } = sim;
  const P = sim.P[0]!;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : sim.D[y * w + x]!);
  const g = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    const c = y * w + x;
    return sim.B[c]! >= FLOW.bodyLow ? sim.G[c]! : 0;
  };
  const p = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : P[y * w + x]!);
  let [sum, n] = [0, 0];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const c = y * w + x;
      if (sim.B[c]! < FLOW.bodyLow || sim.D[c]! < VEIN) continue;
      // The Hessian of D: the ridge runs along the eigenvector of the eigenvalue nearer 0.
      const dxx = at(x + 1, y) - 2 * at(x, y) + at(x - 1, y);
      const dyy = at(x, y + 1) - 2 * at(x, y) + at(x, y - 1);
      const dxy = (at(x + 1, y + 1) - at(x - 1, y + 1) - at(x + 1, y - 1) + at(x - 1, y - 1)) / 4;
      const tr = dxx + dyy;
      const det = dxx * dyy - dxy * dxy;
      const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      const [l1, l2] = [tr / 2 + disc, tr / 2 - disc];
      // A ridge: strong curvature across (l2 < 0, the most negative), little along.
      if (l2 >= 0 || Math.abs(l1) > 0.5 * Math.abs(l2)) continue;
      // The eigenvector of l1 (along the ridge).
      let [ex, ey] = Math.abs(dxy) > 1e-12 ? [l1 - dyy, dxy] : dxx > dyy ? [1, 0] : [0, 1];
      const el = Math.hypot(ex, ey);
      if (el === 0) continue;
      [ex, ey] = [ex / el, ey / el];
      // The flux at the cell: the edge fluxes of lane 0.
      const fx =
        harmonic(g(x, y), g(x + 1, y)) * (p(x, y) - p(x + 1, y)) +
        harmonic(g(x - 1, y), g(x, y)) * (p(x - 1, y) - p(x, y));
      const fy =
        harmonic(g(x, y), g(x, y + 1)) * (p(x, y) - p(x, y + 1)) +
        harmonic(g(x, y - 1), g(x, y)) * (p(x, y - 1) - p(x, y));
      const fl = Math.hypot(fx, fy);
      if (fl === 0) continue;
      sum += Math.abs((ex * fx + ey * fy) / fl);
      n++;
    }
  return { cos: n === 0 ? 0 : sum / n, cells: n };
}

const harmonic = (a: number, b: number) => (a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b));

/**
 * The delay of the veins behind the front: for every cell that holds a vein now (D at least VEIN), the steps from
 * the front stamp (the front reached the cell) to the step at which the cell became a vein. Median and quartiles.
 */
export function veinDelay(sim: Sim): { median: number; q1: number; q3: number; cells: number } {
  const d: number[] = [];
  for (let c = 0; c < sim.cells; c++) {
    if (sim.B[c]! < FLOW.bodyLow || sim.D[c]! < VEIN) continue;
    const [f, v] = [sim.F[c]!, sim.veinAt[c]!];
    if (f === 0 || v === 0 || v < f) continue;
    d.push(v - f);
  }
  d.sort((a, b) => a - b);
  const q = (t: number) => d[Math.min(d.length - 1, Math.floor(t * d.length))] ?? 0;
  return { median: q(0.5), q1: q(0.25), q3: q(0.75), cells: d.length };
}

/**
 * Murray's exponent at the junctions of the veins (Akita et al. 2017, Sec. III.E): the tube cells with D at least
 * `minD` are thinned to a skeleton; at every point of it with three branches, the radius of each branch is the
 * fourth root of the conductivity across it (Poiseuille, as ADR 0034 draws a tube), 5 cells out on the branch; n
 * solves r0^n = r1^n + r2^n with r0 the widest. Returns every n, their median, and tan of the mean of arctan n.
 */
export function murray(sim: Sim, minD = 0.1): { n: number[]; median: number; arctan: number } {
  const { w, h } = sim;
  const mask = new Uint8Array(w * h);
  for (let c = 0; c < sim.cells; c++) if (sim.B[c]! >= FLOW.bodyLow && sim.D[c]! >= minD) mask[c] = 1;
  const skel = thin(mask, w, h);
  const nbs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ] as const;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && skel[y * w + x] === 1;
  const degree = (x: number, y: number) => nbs.filter(([dx, dy]) => on(x + dx, y + dy)).length;
  const ns: number[] = [];
  const seen = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (!on(x, y) || degree(x, y) < 3 || seen[y * w + x]) continue;
      // The junction: this point and its skeleton neighbours of degree 3 or more.
      const cluster = new Set<number>([y * w + x]);
      const stack = [y * w + x];
      while (stack.length > 0) {
        const c = stack.pop()!;
        const [cx, cy] = [c % w, Math.floor(c / w)];
        for (const [dx, dy] of nbs) {
          const m = (cy + dy) * w + cx + dx;
          if (on(cx + dx, cy + dy) && degree(cx + dx, cy + dy) >= 3 && !cluster.has(m)) {
            cluster.add(m);
            stack.push(m);
          }
        }
      }
      for (const c of cluster) seen[c] = 1;
      // The branches: walk out of the cluster along the skeleton for 5 points.
      const radii: number[] = [];
      const starts: number[] = [];
      for (const c of cluster) {
        const [cx, cy] = [c % w, Math.floor(c / w)];
        for (const [dx, dy] of nbs) {
          const m = (cy + dy) * w + cx + dx;
          if (on(cx + dx, cy + dy) && !cluster.has(m) && !starts.includes(m)) starts.push(m);
        }
      }
      if (starts.length !== 3) continue;
      for (const s0 of starts) {
        let [prev, cur] = [-1, s0];
        const path = [s0];
        for (let k = 0; k < 5; k++) {
          const [cx, cy] = [cur % w, Math.floor(cur / w)];
          let next = -1;
          for (const [dx, dy] of nbs) {
            const m = (cy + dy) * w + cx + dx;
            if (on(cx + dx, cy + dy) && m !== prev && !cluster.has(m) && !path.includes(m)) {
              next = m;
              break;
            }
          }
          if (next < 0) break;
          [prev, cur] = [cur, next];
          path.push(cur);
        }
        if (path.length < 4) break;
        // The direction of the branch, and the conductivity across it at its last point.
        const [ax, ay] = [path[0]! % w, Math.floor(path[0]! / w)];
        const [bx, by] = [cur % w, Math.floor(cur / w)];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
        let g = 0;
        for (const side of [1, -1])
          for (let t = side === 1 ? 0 : 1; t < 12; t++) {
            const [px, py] = [Math.round(bx + side * t * nx), Math.round(by + side * t * ny)];
            if (px < 0 || py < 0 || px >= w || py >= h || !mask[py * w + px]) break;
            g += sim.G[py * w + px]!;
          }
        radii.push(Math.pow(g, 0.25));
      }
      if (radii.length !== 3) continue;
      radii.sort((a, b) => b - a);
      const [r0, r1, r2] = radii as [number, number, number];
      if (!(r0 > 0) || !(r1 > 0) || !(r2 > 0)) continue;
      const f = (n: number) => Math.pow(r1 / r0, n) + Math.pow(r2 / r0, n) - 1;
      if (f(20) > 0) continue;
      let [lo, hi] = [0.01, 20];
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if (f(mid) > 0) lo = mid;
        else hi = mid;
      }
      ns.push((lo + hi) / 2);
    }
  const at = ns.map((n) => Math.atan(n));
  return { n: ns, median: median(ns), arctan: ns.length > 0 ? Math.tan(mean(at)) : 0 };
}

/** Zhang-Suen thinning of a mask (1 inside): a skeleton one cell wide. */
function thin(mask: Uint8Array, w: number, h: number): Uint8Array {
  const img = Uint8Array.from(mask);
  const p = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]!);
  let changed = true;
  while (changed) {
    changed = false;
    for (const pass of [0, 1]) {
      const del: number[] = [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!img[y * w + x]) continue;
          const n = [
            p(x, y - 1),
            p(x + 1, y - 1),
            p(x + 1, y),
            p(x + 1, y + 1),
            p(x, y + 1),
            p(x - 1, y + 1),
            p(x - 1, y),
            p(x - 1, y - 1),
          ];
          const b = n.reduce((s, v) => s + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let k = 0; k < 8; k++) if (n[k] === 0 && n[(k + 1) % 8] === 1) a++;
          if (a !== 1) continue;
          const [p2, p4, p6, p8] = [n[0]!, n[2]!, n[4]!, n[6]!];
          if (pass === 0 ? p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0 : p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0)
            continue;
          del.push(y * w + x);
        }
      for (const c of del) img[c] = 0;
      if (del.length > 0) changed = true;
    }
  }
  return img;
}

/**
 * The head of the farthest tube, without a direction: the steps along plasm cells (4 neighbours) from the first food,
 * the band of the last 15 steps that holds the farthest cell (the head), and the band 40 to 60 steps behind it that
 * joins it (the tube). Widths are cells per step of the band. Veins: the parts of the tube cells with D at least 0.2
 * in each band, and their cells per part.
 */
export function head(sim: Sim): {
  reach: number;
  head: number;
  tube: number;
  veinsHead: number;
  veinsTube: number;
  veinCellsHead: number;
  veinCellsTube: number;
} {
  const { w, h, cells } = sim;
  const lowLevel = low(sim);
  const plasm = (c: number) => sim.layout.open[c] === 1 && sim.trail[c]! >= lowLevel;
  const dist = new Int32Array(cells).fill(-1);
  const start = sim.layout.sites[0]?.[0] ?? sim.cellOf(sim.layout.start[0], sim.layout.start[1]);
  const queue = [start];
  dist[start] = 0;
  // A queue that grows while it is read: for-of reads the new entries too.
  for (const c of queue) {
    const [x, y] = [c % w, Math.floor(c / w)];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const [xx, yy] = [x + dx, y + dy];
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const m = yy * w + xx;
      if (dist[m] !== -1 || !plasm(m)) continue;
      dist[m] = dist[c]! + 1;
      queue.push(m);
    }
  }
  let far = 0;
  let farCell = start;
  for (let c = 0; c < cells; c++) if (dist[c]! > far) [far, farCell] = [dist[c]!, c];
  // The cells of one branch: those joined to the farthest cell through cells at least `from` steps out.
  const branch = (from: number) => {
    const seen = new Uint8Array(cells);
    const list = [farCell];
    seen[farCell] = 1;
    for (const c of list) {
      const [x, y] = [c % w, Math.floor(c / w)];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const [xx, yy] = [x + dx, y + dy];
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const m = yy * w + xx;
          if (seen[m] || dist[m]! < from) continue;
          seen[m] = 1;
          list.push(m);
        }
    }
    return list;
  };
  const near = branch(far - 60);
  const band = (lo: number, hi: number) => near.filter((c) => dist[c]! >= lo && dist[c]! <= hi);
  const headCells = band(far - 15, far);
  const tubeCells = band(far - 60, far - 40);
  const veinParts = (list: number[]) => {
    const set = new Set(list.filter((c) => sim.B[c]! >= FLOW.bodyLow && sim.D[c]! >= 0.2));
    let parts = 0;
    const done = new Set<number>();
    for (const c of set) {
      if (done.has(c)) continue;
      parts++;
      const stack = [c];
      done.add(c);
      while (stack.length > 0) {
        const a = stack.pop()!;
        const [x, y] = [a % w, Math.floor(a / w)];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const m = (y + dy) * w + x + dx;
            if (set.has(m) && !done.has(m)) {
              done.add(m);
              stack.push(m);
            }
          }
      }
    }
    return { parts, cells: set.size };
  };
  const vh = veinParts(headCells);
  const vt = veinParts(tubeCells);
  return {
    reach: far,
    head: headCells.length / 16,
    tube: tubeCells.length / 21,
    veinsHead: vh.parts,
    veinsTube: vt.parts,
    veinCellsHead: vh.parts > 0 ? vh.cells / vh.parts : 0,
    veinCellsTube: vt.parts > 0 ? vt.cells / vt.parts : 0,
  };
}
