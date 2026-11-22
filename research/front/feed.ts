// Study 1c of the plan of 2026-11-22 (ADR 0093): the food pays the growth. The dish of Food ring with the rules of the
// growth front, with its nine foods or with the food of the middle alone. Every `every` steps a row: the agents, the
// covered foods, the territory, the closed ground, and a ledger of the births and deaths by kind and of the budget of
// the paid births (`Ledger` of sim.ts). Pictures at the steps `pics`. Prototype code. Usage:
//   node --import ./research/flow/register.mjs research/front/feed.ts foods=9 seeds=1-2 steps=20000 flow=8 \
//     name=p1c/<case> <the rules of stage 4>
// `foods`: 1 or 9. `side`: the cells of the dish (384, as Food ring). `ring`: the radius of the ring of foods over the
// side (0.3, as Food ring). `flow`: the flow strength I0. `out`: the folder
// of the records and pictures (research/front/out). `table=<file>` prints the table of a record.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FLOW } from '../../src/engine/flow';
import { dish } from './layouts';
import { look } from './picture';
import { Sim, frontFrom, params, type Layout, type Ledger } from './sim';

/**
 * The foods of Food ring in cells of a dish of `side` cells: the middle first, then 8 on a ring at `ring` of the side
 * (Food ring: 0.3).
 */
export function ringFoods(side: number, count: 1 | 9, ring = 0.3): [number, number, number][] {
  const r = 0.014 * side;
  const at = (v: number) => Math.round(ring * v * 1e4) / 1e4;
  const foods: [number, number, number][] = [[side / 2, side / 2, r]];
  for (let i = 0; count === 9 && i < 8; i++) {
    const a = (2 * Math.PI * i) / 8;
    foods.push([side / 2 + at(Math.cos(a)) * side, side / 2 + at(Math.sin(a)) * side, r]);
  }
  return foods;
}

/** The counts of one window of the ledger: by kind 0 start, 1 Jones' rule, 2 paid by the flux, 3 respawn. */
export interface Window {
  born: number[];
  starve: number[];
  crowd: number[];
  /** Deaths on closed ground (D below 0.01), of every cause. */
  closedDeaths: number;
  /** The summed age at death by kind, in steps. */
  age: number[];
  credited: number;
  truncated: number;
}

const zero = (): Window => ({
  born: [0, 0, 0, 0],
  starve: [0, 0, 0, 0],
  crowd: [0, 0, 0, 0],
  closedDeaths: 0,
  age: [0, 0, 0, 0],
  credited: 0,
  truncated: 0,
});

/** The ledger of a run: the kind and the step of birth of every agent, and the counts of the current window. */
export class Book implements Ledger {
  kind: Uint8Array;
  at: Float64Array;
  now = zero();
  constructor(cap: number, start: number) {
    this.kind = new Uint8Array(cap);
    this.at = new Float64Array(cap).fill(start);
  }
  born(id: number, kind: 1 | 2 | 3, step: number) {
    this.kind[id] = kind;
    this.at[id] = step;
    this.now.born[kind]!++;
  }
  died(id: number, cause: 'starve' | 'crowd', closed: boolean, step: number) {
    const k = this.kind[id]!;
    this.now[cause][k]!++;
    if (closed) this.now.closedDeaths++;
    this.now.age[k]! += step - this.at[id]!;
  }
  budget(credited: number, truncated: number) {
    this.now.credited += credited;
    this.now.truncated += truncated;
  }
  take(): Window {
    const w = this.now;
    this.now = zero();
    return w;
  }
}

export interface FeedRow extends Window {
  k: number;
  alive: number;
  /** The alive agents by kind of birth. */
  aliveBy: number[];
  /** Alive agents on closed ground (D below 0.01). */
  onClosed: number;
  covered: number;
  territory: number;
  /** Cells of the territory with D below 0.01: no child is born there. */
  closed: number;
  /** Open cells outside the territory beside it: the room of the colony. */
  room: number;
  budget: number;
  claims: number;
  front: number;
}

/** The sites with a port: a food cell with a tube body (docs/model.md 8.2). */
export function coveredSites(sim: Sim, layout: Layout): number {
  return layout.sites.filter((list) => list.some((c) => layout.food[c] && sim.B[c]! >= FLOW.bodyLow)).length;
}

export function row(sim: Sim, book: Book, layout: Layout, k: number, claims: number): FeedRow {
  const { w, h, cells } = sim;
  const aliveBy = [0, 0, 0, 0];
  let onClosed = 0;
  for (let i = 0; i < sim.cap; i++) {
    if (!sim.alive[i]) continue;
    aliveBy[book.kind[i]!]!++;
    if (sim.D[sim.cellOf(sim.ax[i]!, sim.ay[i]!)]! < FLOW.half) onClosed++;
  }
  let [territory, closed, room] = [0, 0, 0];
  for (let c = 0; c < cells; c++) {
    if (!layout.open[c]) continue;
    if (sim.territory[c]) {
      territory++;
      if (sim.D[c]! < FLOW.half) closed++;
      continue;
    }
    const [x, y] = [c % w, Math.floor(c / w)];
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy++)
      for (let dx = -1; dx <= 1 && !edge; dx++) {
        const [xx, yy] = [x + dx, y + dy];
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && sim.territory[yy * w + xx]) edge = true;
      }
    if (edge) room++;
  }
  return {
    k,
    alive: sim.aliveCount,
    aliveBy,
    onClosed,
    covered: coveredSites(sim, layout),
    territory,
    closed,
    room,
    budget: sim.budget,
    claims,
    front: sim.frontAgents,
    ...book.take(),
  };
}

export function runFeed(
  seed: number,
  foods: 1 | 9,
  front: ReturnType<typeof frontFrom>,
  o: { steps: number; every: number; side: number; ring: number; flow: number; pics: number[]; picDir?: string },
) {
  const layout = dish(o.side, ringFoods(o.side, foods, o.ring));
  const sim = new Sim(layout, params({ seed, flow: o.flow, front, scentSteps: 0 }));
  const book = new Book(sim.cap, sim.step);
  sim.ledger = book;
  const rows: FeedRow[] = [];
  const t0 = performance.now();
  let claims = 0;
  for (let k = 1; k <= o.steps; k++) {
    sim.advance();
    if (k % o.every === 0) {
      rows.push(row(sim, book, layout, k, sim.paidBirths - claims));
      claims = sim.paidBirths;
    }
    if (o.picDir && o.pics.includes(k)) {
      mkdirSync(o.picDir, { recursive: true });
      look(sim, { x: 0, y: 0, w: sim.w, h: sim.h, zoom: 2 }, `${o.picDir}/s${String(seed)}-${String(k)}.png`);
    }
  }
  return { seed, foods, rows, ms: Math.round(performance.now() - t0) };
}

/** The rows of a record, summed over windows of `span` steps: one line per window and seed. */
function table(file: string, span: number) {
  const runs = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { seed: number; foods: number; rows: FeedRow[] });
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  for (const run of runs) {
    let acc: FeedRow[] = [];
    for (const r of run.rows) {
      acc.push(r);
      if (r.k % span !== 0) continue;
      const add = (f: (x: FeedRow) => number) => sum(acc.map(f));
      const by = (key: 'born' | 'starve' | 'crowd', i: number) => add((x) => x[key][i]!);
      const deaths = add((x) => sum(x.starve) + sum(x.crowd));
      const paidDeaths = by('starve', 2) + by('crowd', 2);
      const paidAge = add((x) => x.age[2]!) / Math.max(1, paidDeaths);
      console.log(
        [
          `s${String(run.seed)} f${String(run.foods)} ${String(r.k).padStart(5)}`,
          `alive ${String(r.alive).padStart(5)} (paid ${String(r.aliveBy[2])}, closed ${String(r.onClosed)})`,
          `cov ${String(r.covered)} terr ${String(r.territory)} closed ${String(r.closed)} room ${String(r.room)}`,
          `credit ${add((x) => x.credited).toFixed(0)} cut ${add((x) => x.truncated).toFixed(0)} claims ${String(add((x) => x.claims))}`,
          `born J ${String(by('born', 1))} P ${String(by('born', 2))} R ${String(by('born', 3))}`,
          `died ${String(deaths)} (starve ${String(add((x) => sum(x.starve)))}, crowd ${String(add((x) => sum(x.crowd)))}, on closed ${String(add((x) => x.closedDeaths))})`,
          `paid died ${String(paidDeaths)} (starve ${String(by('starve', 2))}) age ${paidAge.toFixed(0)}`,
        ].join(' | '),
      );
      acc = [];
    }
  }
}

const isMain = process.argv[1]?.endsWith('feed.ts');
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
  if (args.table) table(args.table, Number(args.span ?? 2000));
  else {
    const own = ['foods', 'seeds', 'steps', 'every', 'side', 'ring', 'flow', 'pics', 'name', 'out'];
    const front = frontFrom(args, own);
    const foods = Number(args.foods ?? 9);
    if (foods !== 1 && foods !== 9) throw new Error(`foods=${String(args.foods)}: 1 or 9`);
    const o = {
      steps: Number(args.steps ?? 20000),
      every: Number(args.every ?? 500),
      side: Number(args.side ?? 384),
      ring: Number(args.ring ?? 0.3),
      flow: Number(args.flow ?? 8),
      pics: (args.pics ?? '').split(',').filter(Boolean).map(Number),
    };
    for (const n of Object.values(o)) if (typeof n === 'number' && !Number.isFinite(n)) throw new Error('a number');
    const [from = 1, to = from] = (args.seeds ?? '1-1').split('-').map(Number);
    const out = args.out ?? 'research/front/out';
    const file = `${out}/${args.name ?? 'p1c/feed'}.jsonl`;
    mkdirSync(dirname(file), { recursive: true });
    for (let seed = from; seed <= to; seed++) {
      const run = runFeed(seed, foods, front, { ...o, picDir: `${out}/${args.name ?? 'p1c/feed'}-pics` });
      appendFileSync(file, JSON.stringify({ ...run, front, flow: o.flow, side: o.side, ring: o.ring }) + '\n');
      const end = run.rows.at(-1);
      console.log(
        `seed ${String(seed)} foods ${String(foods)}: alive ${String(end?.alive)} covered ${String(end?.covered)} (${String(run.ms)} ms)`,
      );
    }
  }
}
