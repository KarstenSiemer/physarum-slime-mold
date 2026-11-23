// Study 1a of the plan of 2026-11-22 (ADR 0091): the credit of fresh ground. One run of the rules and the levers of
// the Crown of veins in the box of E2n (`layout=box`: the neck of 520 × 340 cells) or in a dish with a ring of foods
// as in Food ring (`layout=ring`: 384 cells, a food in the middle and eight on a ring), with the credit options of
// `sim.ts` (`credit`, `creditJobs`, `creditOn`). Every 100 steps the agents; at the steps `at` the four measures of
// the plan (2.5); pictures at the steps `pics`. Prototype code. Usage:
//   node --import ./research/flow/register.mjs research/front/p1a.ts layout=box seed=1 steps=16000 \
//     at=4000,8000,12000,16000 pics=4000,10000,16000 name=p1a/box/c020/s1 [credit=0.02 creditJobs=all creditOn=const]
//   node --import ./research/flow/register.mjs research/front/p1a.ts table=research/front/out/p1a/box
// A run writes `research/front/out/<name>.json`; `table` prints the measures of every run below a folder by case.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { saveState } from './crowns';
import { dPicture } from './e2l';
import { heads, partSizes } from './e2n';
import { rimDistance } from './e2m';
import { dish, neck } from './layouts';
import { ridgeCells, type CrownFields } from './measure';
import { look } from './picture';
import { FLOW } from '../../src/engine/flow';
import { Sim, frontFrom, params } from './sim';
import { VEIN_D } from './still';

/** The rules and the levers of the Crown of veins (ADR 0087): the rule set of E2n with `jones=all`. */
export const CROWN_WORDS =
  'speed=0.004 speedOn=push reach=6 rim=1 colony=1 slimeWeight=0.025 paidOn=sinks sinkAt=edge solver=app ' +
  'paidBy=rank fresh=box sums=fixed sinkTube=1 driftOn=take drift=1.5 stencil=8 norm=4 paid=40 jones=all';
/** The base conductance of the Crown of veins (`flowBase`). */
export const CROWN_BASE = 0.002;
/** The plan's age of ground behind the front, in steps (2.5): the delay of the main vein (Schenz 2019). */
export const BEHIND = 1500;
/** The window of the measure No boom, and the agents from which it counts (2.5). */
export const BOOM_WINDOW = 1000;
export const BOOM_FROM = 1000;

export interface Place {
  /** The centre of the arcs and of the radius of the colony, and the least row of the ground that counts. */
  cx: number;
  cy: number;
  top: number;
}

export function p1aLayout(name: string) {
  if (name === 'box') return { layout: neck(520, 340, 14, 40, [[260, 8, 5]]), place: { cx: 260, cy: 40, top: 40 } };
  if (name === 'ring') {
    // Food ring: a food in the middle and eight on a ring of 0.3 of the side, each of radius 0.014 of the side.
    const [side, r] = [384, 0.014 * 384];
    const ring = Array.from({ length: 8 }, (_, i) => {
      const a = (2 * Math.PI * i) / 8;
      return [side / 2 + 0.3 * side * Math.cos(a), side / 2 + 0.3 * side * Math.sin(a), r] as const;
    });
    return { layout: dish(side, [[side / 2, side / 2, r], ...ring]), place: { cx: side / 2, cy: side / 2, top: 0 } };
  }
  throw new Error(`layout=${name}: box or ring`);
}

/** The four measures of the plan at one step, and what they read. */
export interface Measures {
  k: number;
  alive: number;
  /** The reached open cells (a front stamp) and those that the front reached more than BEHIND steps before. */
  reached: number;
  old: number;
  /** No sheet behind the front: the share of the old cells with plasm (a trail at the plasm level), with a tube
   * body, and with an agent. */
  sheet: number;
  sheetBody: number;
  sheetAgents: number;
  /** The radius of the colony: the median distance of its rim cells from the centre; and their spread (sd / mean). */
  radius: number;
  rimSpread: number;
  /** The veins (ridges of D ≥ VEIN_D) on the arcs at a quarter and at three quarters of the radius, and per 100
   * cells of arc. */
  veinsQuarter: number;
  veinsThree: number;
  densityQuarter: number;
  densityThree: number;
  /** The heads of ADR 0084 (parts of the rim that advance) and the parts that stand, each of at least 13 cells. */
  heads: number;
  stands: number;
  standShare: number;
}

export function measures(f: CrownFields, place: Place, low: number): Measures {
  const { w, cells, step: k } = f;
  const open = f.layout.open;
  let [reached, old, plasm, body, agents] = [0, 0, 0, 0, 0];
  for (let c = 0; c < cells; c++) {
    if (!open[c] || f.F[c] === 0 || Math.floor(c / w) < place.top) continue;
    reached++;
    if (k + 1 - f.F[c]! <= BEHIND) continue;
    old++;
    if (f.trail[c]! >= low) plasm++;
    if (f.B[c]! >= FLOW.bodyLow) body++;
    if (f.occ[c]) agents++;
  }
  const rim = rimDistance(f);
  const dist = (c: number) => Math.hypot((c % w) + 0.5 - place.cx, Math.floor(c / w) + 0.5 - place.cy);
  const radii: number[] = [];
  for (let c = 0; c < cells; c++)
    if (rim[c] === 1 && f.F[c] !== 0 && Math.floor(c / w) >= place.top) radii.push(dist(c));
  radii.sort((a, b) => a - b);
  const radius = radii.length > 0 ? radii[Math.floor(radii.length / 2)]! : NaN;
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const sd = Math.sqrt(radii.reduce((a, b) => a + (b - mean) ** 2, 0) / radii.length);
  const ridge = ridgeCells(f, 1.5, 4, VEIN_D);
  const arc = (r: number) => {
    const band: number[] = [];
    for (let c = 0; c < cells; c++)
      if (open[c] && Math.floor(c / w) >= place.top && Math.abs(dist(c) - r) < 1) band.push(c);
    const veins = partSizes(new Set(band.filter((c) => ridge[c])), w, f.h).length;
    return [veins, band.length > 0 ? (100 * veins) / band.length : NaN] as const;
  };
  const [q, qd] = arc(radius / 4);
  const [t, td] = arc((3 * radius) / 4);
  const hd = heads(f);
  const round = (v: number, n = 3) => (Number.isFinite(v) ? Number(v.toPrecision(n)) : NaN);
  return {
    k,
    alive: f.occ.reduce((s, v) => s + v, 0),
    reached,
    old,
    sheet: round(old > 0 ? plasm / old : NaN),
    sheetBody: round(old > 0 ? body / old : NaN),
    sheetAgents: round(old > 0 ? agents / old : NaN),
    radius: round(radius),
    rimSpread: round(sd / mean),
    veinsQuarter: q,
    veinsThree: t,
    densityQuarter: round(qd),
    densityThree: round(td),
    heads: hd.heads,
    stands: hd.stands,
    standShare: hd.standShare,
  };
}

/** No boom: the largest rise and fall of the agents within BOOM_WINDOW steps, from the first record with BOOM_FROM. */
export function boom(series: readonly { k: number; alive: number }[]): { up: number; down: number; from: number } {
  const start = series.findIndex((r) => r.alive >= BOOM_FROM);
  let [up, down] = [0, 0];
  if (start < 0) return { up: NaN, down: NaN, from: -1 };
  const at = new Map(series.map((r) => [r.k, r.alive]));
  for (const r of series.slice(start)) {
    const later = at.get(r.k + BOOM_WINDOW);
    if (later === undefined) continue;
    const change = (later - r.alive) / r.alive;
    [up, down] = [Math.max(up, change), Math.min(down, change)];
  }
  return { up: Number(up.toFixed(3)), down: Number(down.toFixed(3)), from: series[start]!.k };
}

export interface Run {
  name: string;
  layout: string;
  seed: number;
  words: string;
  series: { k: number; alive: number; territory: number; reached: number }[];
  measures: Measures[];
  boom: { up: number; down: number; from: number };
  seconds: number;
}

/** The view of the pictures: the part of the grid that the colony can reach, at a zoom of 5. */
function view(layoutName: string, w: number, h: number) {
  return layoutName === 'box' ? { x: 60, y: 0, w: 400, h: 260, zoom: 5 } : { x: 0, y: 0, w, h, zoom: 5 };
}

function runOne(args: Record<string, string>) {
  const own = ['layout', 'seed', 'steps', 'at', 'pics', 'dump', 'name'];
  // The words of the Crown of veins, and the words of the run over them.
  const crown = Object.fromEntries(CROWN_WORDS.split(' ').map((a) => a.split('=') as [string, string]));
  const front = frontFrom({ ...crown, ...args }, own);
  const layoutName = args.layout ?? 'box';
  const { layout, place } = p1aLayout(layoutName);
  const seed = Number(args.seed ?? 1);
  const steps = Number(args.steps ?? 16000);
  const list = (s?: string) => (s ?? '').split(',').filter(Boolean).map(Number);
  const [at, pics, dumps] = [list(args.at), list(args.pics), list(args.dump)];
  const name = args.name ?? 'p1a/run';
  const out = `research/front/out/${name}`;
  mkdirSync(dirname(out), { recursive: true });
  const sim = new Sim(layout, params({ seed, front, scentSteps: 0 }));
  sim.base = CROWN_BASE;
  const low = 0.2 * sim.p.deposit;
  const run: Run = {
    name,
    layout: layoutName,
    seed,
    words: process.argv.slice(2).join(' '),
    series: [],
    measures: [],
    boom: { up: NaN, down: NaN, from: -1 },
    seconds: 0,
  };
  const t0 = performance.now();
  for (let k = 1; k <= steps; k++) {
    sim.advance();
    if (k % 100 === 0) {
      let [territory, reached] = [0, 0];
      for (let c = 0; c < sim.cells; c++) {
        territory += sim.territory[c]!;
        if (sim.F[c] !== 0) reached++;
      }
      run.series.push({ k, alive: sim.aliveCount, territory, reached });
      // A colony that died out has nothing more to measure.
      if (sim.aliveCount === 0) break;
    }
    if (at.includes(k)) run.measures.push(measures(sim, place, low));
    if (dumps.includes(k)) saveState(sim, `${out}-${String(k)}.bin.gz`);
    if (pics.includes(k)) {
      look(sim, view(layoutName, sim.w, sim.h), `${out}-look-${String(k)}.png`);
      dPicture(sim, `${out}-d-${String(k)}.png`, 2);
    }
  }
  run.boom = boom(run.series);
  run.seconds = Math.round((performance.now() - t0) / 1000);
  writeFileSync(`${out}.json`, JSON.stringify(run));
  const last = run.measures.at(-1);
  console.log(`${name} ${String(run.seconds)} s boom ${String(run.boom.up)} ${String(run.boom.down)}`, last ?? '');
}

/** Every run below a folder, by case (the folder that holds the seeds). */
function table(root: string) {
  const runs: Run[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.json')) runs.push(JSON.parse(readFileSync(p, 'utf8')) as Run);
    }
  };
  walk(root);
  const byCase = new Map<string, Run[]>();
  for (const r of runs) {
    const key = relative(root, dirname(join('research/front/out', r.name)));
    byCase.set(key, [...(byCase.get(key) ?? []), r]);
  }
  const span = (v: number[]) => {
    const s = v.filter(Number.isFinite).sort((a, b) => a - b);
    if (s.length === 0) return '-';
    const med = s[Math.floor(s.length / 2)]!;
    const f = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toPrecision(2));
    return `${f(med)} (${f(s[0]!)}–${f(s.at(-1)!)})`;
  };
  for (const [key, list] of [...byCase.entries()].sort()) {
    list.sort((a, b) => a.seed - b.seed);
    const steps = [...new Set(list.flatMap((r) => r.measures.map((m) => m.k)))].sort((a, b) => a - b);
    console.log(
      `${key}: ${String(list.length)} seeds, boom up ${span(list.map((r) => r.boom.up))} down ${span(list.map((r) => r.boom.down))}`,
    );
    for (const k of steps) {
      const ms = list.map((r) => r.measures.find((m) => m.k === k)).filter((m) => m !== undefined);
      const get = (f: (m: Measures) => number) => span(ms.map(f));
      const forks = ms.filter((m) => m.veinsThree >= 2 * m.veinsQuarter && m.veinsThree > 0).length;
      const arms = ms.filter((m) => m.heads >= 3 && m.stands >= 1).length;
      console.log(
        `  ${String(k).padStart(5)} alive ${get((m) => m.alive)} reached ${get((m) => m.reached)} sheet ${get((m) => m.sheet)}` +
          ` body ${get((m) => m.sheetBody)} | r ${get((m) => m.radius)} spread ${get((m) => m.rimSpread)}` +
          ` | veins ${get((m) => m.veinsQuarter)} → ${get((m) => m.veinsThree)} fork ${String(forks)}/${String(ms.length)}` +
          ` | heads ${get((m) => m.heads)} stands ${get((m) => m.stands)} arms ${String(arms)}/${String(ms.length)}`,
      );
    }
  }
}

const isMain = process.argv[1]?.endsWith('p1a.ts');
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
  if (args.table) table(args.table);
  else runOne(Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'table')));
}
