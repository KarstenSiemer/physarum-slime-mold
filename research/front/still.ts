// A still sheet (ADR 0079, part E2i of stage 4): the flow and the rule of the tubes of sim.ts on a fixed body, without
// agents. The body is the channel of the neck (layouts.ts neck(), 14 cells wide) and a half disc of radius 80 cells at
// its mouth, with open ground around the half disc. It is full on every cell and stays so: its trail holds it, and
// nothing moves (Sim.flowStep()). The food at the closed end of the channel is the source; the outer ring of cells of
// the half disc is the sinks (Sim.stillSinks), with the total of E2f times `k`. D starts at the fresh value with a
// seeded noise. Every `every` steps: the veins that cross the arcs of the half disc (stillProfile()). Prototype code.
// Usage:
//   node --import ./research/flow/register.mjs research/front/still.ts seed=1 k=1 base=0.02 shareOn=equal \
//     steps=8000 every=500 pics=2000,8000 name=e2i/<case>/s<seed>
//   node --import ./research/flow/register.mjs research/front/still.ts table=research/front/out/e2i/<set> [at=<step>]
// `k`: the total of the sinks in units of the one of E2f (norm 2 times the flow strength 8); `base`: the base
// conductance of a tube cell (0.02 in the app); `shareOn`: equal or supply (ADR 0077); `noise`: the noise of D.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { FLOW, pcg } from '../../src/engine/flow';
import { writePng } from '../flow/prototype/world';
import { neck } from './layouts';
import { ridgeCells, veinTowardRim, type CrownFields } from './measure';
import { Sim, frontFrom, params, type Layout } from './sim';

/** The box, the channel and the food of the neck of E2f, and the radius of the half disc at the mouth. */
export const STILL = { w: 260, h: 240, wide: 14, long: 40, radius: 80, food: [130, 8, 5] as const } as const;
/** The arcs of the half disc on which the veins are counted. */
export const ARCS = [20, 40, 60, 75] as const;
/** The least D of a vein, as in E2f, and of a fine vein. */
export const VEIN_D = 0.05;
export const FINE_D = 0.01;

/** The rule set of E2f (E2f-NOTES.md) without the drift, which moves only agents. */
export const E2F_WORDS: Readonly<Record<string, string>> = {
  speed: '0.004',
  speedOn: 'push',
  paid: '20',
  norm: '2',
  reach: '6',
  rim: '1',
  colony: '1',
  slimeWeight: '0.025',
  paidOn: 'sinks',
  sinkAt: 'edge',
  solver: 'app',
  paidBy: 'rank',
  fresh: 'box',
  sums: 'fixed',
  sinkTube: '1',
  driftOn: 'take',
};

export interface StillSheet {
  layout: Layout;
  /** 1 on the channel and the half disc. */
  body: Uint8Array;
  /** The sinks: the cells of the half disc whose centre lies 79 to 80 cells from its centre. */
  rim: number[];
  /** The distance of the centre of each cell from the centre of the half disc. */
  dist: Float32Array;
  /** The port of the food: its first cell (all of the food holds a body). */
  port: number;
  /** Per arc of ARCS: its cells (a band 2 cells deep), and the cells within 3 cells of it (for the direction). */
  arcs: { r: number; band: number[]; near: number[] }[];
  /** The fields of the measures of E2f: the body, and a stamp that grows with the distance from the centre. */
  fields: CrownFields;
}

export function stillSheet(): StillSheet {
  const { w, h, wide, long, radius, food } = STILL;
  const layout = neck(w, h, wide, long, [food]);
  const cells = w * h;
  const [cx, cy] = [w / 2, long];
  const body = new Uint8Array(cells);
  const dist = new Float32Array(cells);
  const rim: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      if (!layout.open[c]) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      dist[c] = d;
      if (y < long) body[c] = 1;
      else if (d < radius) {
        body[c] = 1;
        if (d >= radius - 1) rim.push(c);
      }
    }
  const arcs = ARCS.map((r) => {
    const [band, near]: [number[], number[]] = [[], []];
    for (let c = 0; c < cells; c++) {
      if (!body[c] || Math.floor(c / w) < long) continue;
      if (Math.abs(dist[c]! - r) < 1) band.push(c);
      if (Math.abs(dist[c]! - r) < 3) near.push(c);
    }
    return { r, band, near };
  });
  const B = Float32Array.from(body);
  // The stamp of E2f's measures (the front stamp): the sides of a ridge count only on the body, and its gradient, the
  // direction toward the rim, points away from the centre.
  const F = new Uint32Array(cells);
  for (let c = 0; c < cells; c++) if (body[c]) F[c] = 1 + Math.round(100 * dist[c]!);
  const fields: CrownFields = {
    w,
    h,
    cells,
    step: 0,
    layout: { open: layout.open, start: layout.start },
    occ: new Uint8Array(cells),
    F,
    trail: new Float32Array(cells),
    B,
    D: new Float32Array(cells),
    Q: new Float32Array(cells),
  };
  return { layout, body, rim, dist, port: layout.sites[0]![0]!, arcs, fields };
}

export interface StillOptions {
  seed: number;
  k: number;
  base: number;
  shareOn: 'equal' | 'supply';
  noise: number;
}

/** A Sim on the still sheet: no agents, a full body held by its trail, the rim as the sinks, D fresh with noise. */
export function stillSim(sheet: StillSheet, o: StillOptions): Sim {
  const words = { ...E2F_WORDS, norm: String(2 * o.k), paid: String(20 * o.k), shareOn: o.shareOn };
  const sim = new Sim(sheet.layout, params({ seed: o.seed, front: frontFrom(words), scentSteps: 0, startAgents: 0 }));
  sim.base = o.base;
  sim.stillSinks = sheet.rim;
  const salt = Math.imul(o.seed, 0x9e3779b9) >>> 0;
  for (let c = 0; c < sim.cells; c++) {
    if (!sheet.body[c]) continue;
    sim.trail[c] = sim.p.deposit;
    sim.B[c] = 1;
    const u = pcg((pcg(c) ^ salt) >>> 0) / 2 ** 32;
    sim.D[c] = FLOW.fresh * (1 + o.noise * (2 * u - 1));
  }
  return sim;
}

export interface ArcRow {
  r: number;
  /** The parts of the veins on the arc (8 neighbours), and their mean cells. */
  veins: number;
  cells: number;
  /** The same for the fine veins (a ridge with D of at least FINE_D). */
  fine: number;
  fineCells: number;
  /** |cos| of the veins near the arc toward the rim (veinTowardRim()), of the veins and of the fine veins. */
  cos: number;
  fineCos: number;
  /** The mean D and Q on the arc. */
  d: number;
  q: number;
}

export interface StillRow {
  k: number;
  arcs: ArcRow[];
  /** The change of D since the row before, the sum of |ΔD| over the sum of D on the body. */
  settle: number;
  /** The pressure of the port less the mean of the sinks, and the 10th to 90th percentile of the sinks over it. */
  drop: number;
  spread: number;
  /** The share of the sinks that take a tenth of an equal share or more, and the share of the total of the top 10 %. */
  active: number;
  top: number;
  /** What the sinks take together, over the total. */
  take: number;
}

const round = (v: number, n = 4) => (Number.isFinite(v) ? Number(v.toPrecision(n)) : NaN);

/** The measures of a still sheet: D, Q, the pressure P and the takes of the sinks at a step. */
export function stillProfile(
  sheet: StillSheet,
  f: { step: number; D: Float32Array; Q: Float32Array; P: Float32Array; take: Float32Array; total: number },
  before?: Float32Array,
): StillRow {
  const { w, h } = sheet.fields;
  const fields = { ...sheet.fields, step: f.step, D: f.D, Q: f.Q };
  const ridge = ridgeCells(fields, 1.5, 4, VEIN_D);
  const fine = ridgeCells(fields, 1.5, 4, FINE_D);
  const [toward, fineToward] = [veinTowardRim(fields, ridge), veinTowardRim(fields, fine)];
  const parts = (set: Set<number>) => {
    let [n, size] = [0, 0];
    const done = new Set<number>();
    for (const c of set) {
      if (done.has(c)) continue;
      n++;
      const stack = [c];
      done.add(c);
      while (stack.length > 0) {
        const a = stack.pop()!;
        size++;
        const [x, y] = [a % w, Math.floor(a / w)];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const [xx, yy] = [x + dx, y + dy];
            const m = yy * w + xx;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || !set.has(m) || done.has(m)) continue;
            done.add(m);
            stack.push(m);
          }
      }
    }
    return { n, cells: n > 0 ? size / n : 0 };
  };
  const meanOf = (list: number[], v: (c: number) => number) => {
    const xs = list.map(v).filter(Number.isFinite);
    return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  };
  const arcs = sheet.arcs.map(({ r, band, near }) => {
    const v = parts(new Set(band.filter((c) => ridge[c])));
    const fv = parts(new Set(band.filter((c) => fine[c])));
    return {
      r,
      veins: v.n,
      cells: round(v.cells, 3),
      fine: fv.n,
      fineCells: round(fv.cells, 3),
      cos: round(
        meanOf(near, (c) => toward[c]!),
        3,
      ),
      fineCos: round(
        meanOf(near, (c) => fineToward[c]!),
        3,
      ),
      d: round(meanOf(band, (c) => f.D[c]!)),
      q: round(meanOf(band, (c) => f.Q[c]!)),
    };
  });
  let [change, sum] = [0, 0];
  for (let c = 0; c < f.D.length; c++) {
    if (!sheet.body[c]) continue;
    sum += f.D[c]!;
    if (before) change += Math.abs(f.D[c]! - before[c]!);
  }
  const p = sheet.rim.map((c) => f.P[c]!).sort((a, b) => a - b);
  const at = (q: number) => {
    const x = q * (p.length - 1);
    const i = Math.floor(x);
    const j = Math.min(p.length - 1, i + 1);
    return p[i]! + (x - i) * (p[j]! - p[i]!);
  };
  const drop = f.P[sheet.port]! - p.reduce((a, b) => a + b, 0) / p.length;
  const takes = sheet.rim.map((c) => f.take[c]!).sort((a, b) => b - a);
  const taken = takes.reduce((a, b) => a + b, 0);
  const equal = f.total / sheet.rim.length;
  const top = takes.slice(0, Math.round(0.1 * takes.length)).reduce((a, b) => a + b, 0);
  return {
    k: f.step,
    arcs,
    settle: before ? round(change / sum, 3) : NaN,
    drop: round(drop),
    spread: round(drop > 0 ? (at(0.9) - at(0.1)) / drop : NaN, 3),
    active: round(takes.filter((t) => t >= 0.1 * equal).length / takes.length, 3),
    top: round(taken > 0 ? top / taken : NaN, 3),
    take: round(taken / f.total, 6),
  };
}

const RAMP = [
  [0, 8, 8, 32],
  [0.25, 50, 20, 110],
  [0.5, 170, 45, 100],
  [0.75, 245, 140, 40],
  [1, 255, 250, 210],
] as const;

/** The colour of log10 D from -3 (dark) to 0 (pale yellow). */
function ramp(d: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, (Math.log10(Math.max(d, 1e-6)) + 3) / 3));
  for (let i = 1; i < RAMP.length; i++) {
    const [t1, r1, g1, b1] = RAMP[i]!;
    const [t0, r0, g0, b0] = RAMP[i - 1]!;
    if (t > t1) continue;
    const a = (t - t0) / (t1 - t0);
    return [r0 + a * (r1 - r0), g0 + a * (g1 - g0), b0 + a * (b1 - b0)];
  }
  return [255, 250, 210];
}

/** The part of the box that the pictures show: the channel and the half disc. */
export const VIEW = { x: 40, y: 0, w: 180, h: 130, zoom: 3 } as const;

/**
 * A picture of D on the body (log10 D from -3 to 0), the ground dark, the wall grey. With `mark`: D grey, the veins
 * yellow, the fine veins only cyan, the arcs of ARCS blue: the measure, to check it by eye.
 */
export function stillPicture(sheet: StillSheet, D: Float32Array, path: string, mark = false) {
  const { w, open } = sheet.layout;
  const { x: x0, y: y0, w: vw, h: vh, zoom } = VIEW;
  const rgb = new Uint8Array(vw * vh * 3);
  const fields = { ...sheet.fields, D };
  const [ridge, fine] = mark ? [ridgeCells(fields, 1.5, 4, VEIN_D), ridgeCells(fields, 1.5, 4, FINE_D)] : [];
  for (let y = 0; y < vh; y++)
    for (let x = 0; x < vw; x++) {
      const c = (y + y0) * w + x + x0;
      let col: [number, number, number] = open[c] ? [18, 18, 22] : [90, 90, 90];
      if (sheet.body[c]) {
        col = ramp(D[c]!);
        if (mark) {
          const g = (col[0] + col[1] + col[2]) / 3;
          col = [g * 0.6, g * 0.6, g * 0.6];
          const disc = y + y0 >= STILL.long;
          if (disc && ARCS.some((r) => Math.abs(sheet.dist[c]! - r) < 0.5)) col = [40, 70, 230];
          if (fine?.[c]) col = [70, 200, 255];
          if (ridge?.[c]) col = [255, 225, 60];
        }
      }
      rgb.set(col.map(Math.round), (y * vw + x) * 3);
    }
  writePng(path, vw, vh, rgb, zoom);
}

/** One line per seed of a case folder at a step: the veins on each arc, their direction, and the sinks. */
export function tableLines(dir: string, at?: number): string[] {
  const out: string[] = [];
  for (const kase of readdirSync(dir).sort()) {
    let files: string[];
    try {
      files = readdirSync(join(dir, kase)).filter((f) => /^s\d+\.jsonl$/.test(f));
    } catch {
      continue;
    }
    for (const f of files.sort()) {
      for (const l of readFileSync(join(dir, kase, f), 'utf8')
        .split('\n')
        .filter(Boolean)) {
        const run = JSON.parse(l) as { seed: number; rows: StillRow[] };
        const row = at ? run.rows.find((r) => r.k === at) : run.rows.at(-1);
        if (!row) continue;
        const arcs = row.arcs
          .map(
            (a) =>
              `${String(a.r)}: ${String(a.veins)}×${String(a.cells)} f ${String(a.fine)}×${String(a.fineCells)} cos ${String(a.cos)} D ${String(a.d)}`,
          )
          .join(' | ');
        out.push(
          `${kase} s${String(run.seed)} k ${String(row.k)} | ${arcs} | settle ${String(row.settle)} spread ${String(row.spread)} active ${String(row.active)} top ${String(row.top)}`,
        );
      }
    }
  }
  return out;
}

const isMain = process.argv[1]?.endsWith('still.ts');
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
  if (args.table) {
    for (const l of tableLines(args.table, args.at ? Number(args.at) : undefined)) console.log(l);
    process.exit(0);
  }
  const shareOn = args.shareOn ?? 'equal';
  if (shareOn !== 'equal' && shareOn !== 'supply') throw new Error(`shareOn=${shareOn}`);
  const o: StillOptions = {
    seed: Number(args.seed ?? 1),
    k: Number(args.k ?? 1),
    base: Number(args.base ?? FLOW.base),
    shareOn,
    noise: Number(args.noise ?? 0.01),
  };
  const steps = Number(args.steps ?? 8000);
  const every = Number(args.every ?? 500);
  for (const n of [o.seed, o.k, o.base, o.noise, steps, every])
    if (!Number.isFinite(n)) throw new Error('a number does not parse');
  const pics = (args.pics ?? '').split(',').filter(Boolean).map(Number);
  const name = args.name ?? 'e2i/still';
  const file = `research/front/out/${name}.jsonl`;
  mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
  const sheet = stillSheet();
  const sim = stillSim(sheet, o);
  const total = 2 * o.k * sim.p.flow;
  const rows: StillRow[] = [];
  let before = Float32Array.from(sim.D);
  const t0 = performance.now();
  for (let k = 1; k <= steps; k++) {
    sim.flowStep();
    if (k % every === 0) {
      rows.push(stillProfile(sheet, { step: k, D: sim.D, Q: sim.Q, P: sim.P[0]!, take: sim.take, total }, before));
      before = Float32Array.from(sim.D);
    }
    if (!pics.includes(k)) continue;
    const dir = `research/front/out/${name}-pics`;
    mkdirSync(dir, { recursive: true });
    stillPicture(sheet, sim.D, `${dir}/d-${String(k)}.png`);
    stillPicture(sheet, sim.D, `${dir}/measure-${String(k)}.png`, true);
    // The fields D, Q, P and the takes, for a measure again without the run.
    const parts = [sim.D, sim.Q, sim.P[0]!, sim.take].map((a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    writeFileSync(`${dir}/state-${String(k)}.bin.gz`, gzipSync(Buffer.concat(parts)));
  }
  const ms = Math.round(performance.now() - t0);
  appendFileSync(file, JSON.stringify({ ...o, steps, sinks: sheet.rim.length, rows, ms }) + '\n');
  const end = rows.at(-1);
  console.log(`${name}: ${JSON.stringify(end?.arcs.map((a) => [a.r, a.veins, a.fine, a.cos]))} (${String(ms)} ms)`);
}
