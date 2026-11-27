// Study 1c of the plan of 2026-11-22 (ADR 0093): the food pays the growth. The dish of Food ring with the rules of the
// growth front, with its nine foods or with the food of the middle alone. Every `every` steps a row: the agents, the
// covered foods, the territory, the closed ground, and a ledger of the births and deaths by kind and of the budget of
// the paid births (`Ledger` of sim.ts). Study 1d (ADR 0097) adds to each row the sheet, the agents on old ground by
// their origin and the band (bands()), and every 100 steps the agents, the budget and the covered foods. Pictures at
// the steps `pics`. Prototype code. Usage:
//   node --import ./research/flow/register.mjs research/front/feed.ts foods=9 seeds=1-2 steps=20000 flow=8 \
//     name=p1c/<case> <the rules of stage 4>
// `foods`: 1 or 9. `side`: the cells of the dish (384, as Food ring). `ring`: the radius of the ring of foods over the
// side (0.3, as Food ring). `foodR`: the radius of a food in cells (0.014 of the side, as Food ring). `flow`: the flow
// strength I0. `out`: the folder
// of the records and pictures (research/front/out). `table=<file>` prints the table of a record.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FLOW } from '../../src/engine/flow';
import { dish } from './layouts';
import { isOld, sheetCounts } from './p1a';
import { look } from './picture';
import { Sim, frontFrom, params, type Layout, type Ledger } from './sim';

/**
 * The foods of Food ring in cells of a dish of `side` cells: the middle first, then 8 on a ring at `ring` of the side
 * (Food ring: 0.3), each of radius `r` cells (Food ring: 0.014 of the side).
 */
export function ringFoods(side: number, count: 1 | 9, ring = 0.3, r = 0.014 * side): [number, number, number][] {
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

/**
 * The ledger of a run: the kind and the step of birth of every agent, and the counts of the current window. With
 * `where` (study 1d) also whether an agent was born on old ground.
 */
export class Book implements Ledger {
  kind: Uint8Array;
  at: Float64Array;
  /** 1 for an agent that was born on old ground (`where`). */
  old: Uint8Array;
  now = zero();
  constructor(
    cap: number,
    start: number,
    readonly where?: (id: number) => boolean,
  ) {
    this.kind = new Uint8Array(cap);
    this.at = new Float64Array(cap).fill(start);
    this.old = new Uint8Array(cap);
  }
  born(id: number, kind: 1 | 2 | 3, step: number) {
    this.kind[id] = kind;
    this.at[id] = step;
    this.old[id] = this.where?.(id) ? 1 : 0;
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
  /** Study 1d: the cells of old ground (p1a.ts), and of them those with plasm and with an agent: the measure No sheet. */
  old?: number;
  plasm?: number;
  oldAgents?: number;
  /** The agents on old ground by their kind of birth, and those of them that were born on old ground. */
  onOldBy?: number[];
  onOldBornOld?: number;
  /** The sinks of the front in the last flow pass, and the flux that they take together. */
  sinks?: number;
  take?: number;
  /** The band (bands()): the bins of the distance from the edge of the territory and from the edge of the dish. */
  edge?: Bin[];
  wall?: Bin[];
}

/**
 * The cells of a bin of distance, and the agents, the cells with plasm, the flux Q and the fed cells on them: those
 * with a flow memory of at least 0.01, where an agent does not starve and a child can be born.
 */
export interface Bin {
  cells: number;
  agents: number;
  plasm: number;
  flux: number;
  fed?: number;
}

/** The upper ends of the bins of distance, in cells (Chebyshev), of bands(). */
export const BINS = [6, 12, 24, 48, Infinity];

/**
 * The distance of every cell to the nearest cell of `from`, in steps to one of the 8 neighbours, through the cells
 * that are not of `from`; 255 at most, and 255 for a cell that no path reaches.
 */
export function distanceFrom(w: number, h: number, from: (c: number) => boolean): Uint8Array {
  const d = new Uint8Array(w * h).fill(255);
  const queue = new Int32Array(w * h);
  let [head, tail] = [0, 0];
  for (let c = 0; c < w * h; c++)
    if (from(c)) {
      d[c] = 0;
      queue[tail++] = c;
    }
  while (head < tail) {
    const c = queue[head++]!;
    if (d[c]! >= 254) continue;
    const [x, y] = [c % w, Math.floor(c / w)];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const [xx, yy] = [x + dx, y + dy];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const n = yy * w + xx;
        if (d[n] !== 255) continue;
        d[n] = d[c]! + 1;
        queue[tail++] = n;
      }
  }
  return d;
}

/**
 * The band at the wall (study 1d): the agents, the plasm and the flux by the distance of a cell from the edge of the
 * territory (`edge`: cells of the territory, from the nearest cell outside it) and from the edge of the dish (`wall`:
 * open cells, from the nearest cell that is not open). A band holds more agents and flux per cell in the first bins.
 */
export function bands(sim: Sim, layout: Layout, low: number): { edge: Bin[]; wall: Bin[] } {
  const { w, h, cells } = sim;
  const { open } = layout;
  const toEdge = distanceFrom(w, h, (c) => !sim.territory[c]);
  const toWall = distanceFrom(w, h, (c) => !open[c]);
  const empty = () => BINS.map(() => ({ cells: 0, agents: 0, plasm: 0, flux: 0, fed: 0 }));
  const [edge, wall] = [empty(), empty()];
  const add = (bins: Bin[], d: number, c: number) => {
    const b = bins[BINS.findIndex((top) => d <= top)]!;
    b.cells++;
    if (sim.occ[c]) b.agents++;
    if (sim.trail[c]! >= low) b.plasm++;
    b.flux += sim.Q[c]!;
    if (sim.E[c]! >= FLOW.half) b.fed!++;
  };
  for (let c = 0; c < cells; c++) {
    if (!open[c]) continue;
    add(wall, toWall[c]!, c);
    if (sim.territory[c]) add(edge, toEdge[c]!, c);
  }
  for (const b of [...edge, ...wall]) b.flux = Number(b.flux.toPrecision(4));
  return { edge, wall };
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
    ...oldGround(sim, book),
    sinks: sim.demand,
    take: sim.frontTotal,
    ...bands(sim, layout, low(sim)),
  };
}

/** The plasm level of the measure No sheet: a trail of a fifth of a deposit (p1a.ts). */
const low = (sim: Sim) => 0.2 * sim.p.deposit;

/** Study 1d: the measure No sheet, and the agents on old ground by their origin (`Book` with `where`). */
function oldGround(sim: Sim, book: Book) {
  const { old, plasm, agents } = sheetCounts(sim, 0, low(sim));
  const onOldBy = [0, 0, 0, 0];
  let onOldBornOld = 0;
  for (let i = 0; i < sim.cap; i++) {
    if (!sim.alive[i] || !isOld(sim, sim.cellOf(sim.ax[i]!, sim.ay[i]!))) continue;
    onOldBy[book.kind[i]!]!++;
    onOldBornOld += book.old[i]!;
  }
  return { old, plasm, oldAgents: agents, onOldBy, onOldBornOld };
}

export function runFeed(
  seed: number,
  foods: 1 | 9,
  front: ReturnType<typeof frontFrom>,
  o: {
    steps: number;
    every: number;
    side: number;
    ring: number;
    foodR?: number;
    flow: number;
    pics: number[];
    picDir?: string;
  },
) {
  const layout = dish(o.side, ringFoods(o.side, foods, o.ring, o.foodR));
  const sim = new Sim(layout, params({ seed, flow: o.flow, front, scentSteps: 0 }));
  // Whether an agent is born on old ground: its cell, which the sim sets before it calls the ledger.
  const book = new Book(sim.cap, sim.step, (id) => isOld(sim, sim.cellOf(sim.ax[id]!, sim.ay[id]!)));
  sim.ledger = book;
  const rows: FeedRow[] = [];
  // Study 1d: every 100 steps the agents, the budget and the covered foods, for the measure No boom and the budget.
  const fine: { k: number; alive: number; budget: number; covered: number }[] = [];
  const t0 = performance.now();
  let claims = 0;
  for (let k = 1; k <= o.steps; k++) {
    sim.advance();
    if (k % 100 === 0) fine.push({ k, alive: sim.aliveCount, budget: sim.budget, covered: coveredSites(sim, layout) });
    if (k % o.every === 0) {
      rows.push(row(sim, book, layout, k, sim.paidBirths - claims));
      claims = sim.paidBirths;
    }
    if (o.picDir && o.pics.includes(k)) {
      mkdirSync(o.picDir, { recursive: true });
      look(sim, { x: 0, y: 0, w: sim.w, h: sim.h, zoom: 2 }, `${o.picDir}/s${String(seed)}-${String(k)}.png`);
    }
  }
  return { seed, foods, rows, fine, ms: Math.round(performance.now() - t0) };
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
    const own = ['foods', 'seeds', 'steps', 'every', 'side', 'ring', 'foodR', 'flow', 'pics', 'name', 'out'];
    const front = frontFrom(args, own);
    const foods = Number(args.foods ?? 9);
    if (foods !== 1 && foods !== 9) throw new Error(`foods=${String(args.foods)}: 1 or 9`);
    const o = {
      steps: Number(args.steps ?? 20000),
      every: Number(args.every ?? 500),
      side: Number(args.side ?? 384),
      ring: Number(args.ring ?? 0.3),
      foodR: Number(args.foodR ?? 0.014 * Number(args.side ?? 384)),
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
      const record = { ...run, front, flow: o.flow, side: o.side, ring: o.ring, foodR: o.foodR };
      appendFileSync(file, JSON.stringify(record) + '\n');
      const end = run.rows.at(-1);
      console.log(
        `seed ${String(seed)} foods ${String(foods)}: alive ${String(end?.alive)} covered ${String(end?.covered)} (${String(run.ms)} ms)`,
      );
    }
  }
}
