// A dish with one food in the middle and slime on every open cell, or none: does the colony grow as fast on slime,
// and does it keep its births and its agents when the dish is full (the owner, 2026-11-19)? Prototype code.
// Usage: node --import ./research/flow/register.mjs research/front/dish.ts slime=all seeds=1-10 steps=20000 ...
// The other keys set the rules of stage 4 (`front` of sim.ts). `table=<dir>` prints the table of the records in dir.
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dish } from './layouts';
import { Sim, frontFrom, params, type Front } from './sim';
import { mannWhitney } from './tables';

export interface DishRow {
  k: number;
  alive: number;
  /** Cells of the territory. */
  territory: number;
  /** Births, the births that the flux paid, and the agents that starved, since the last row. */
  births: number;
  paid: number;
  starved: number;
}

export interface DishRun {
  seed: number;
  slime: 'all' | 'none';
  /** Steps until the territory covers a half and nine tenths of the open cells (-1: never). */
  half: number;
  most: number;
  rows: DishRow[];
  ms: number;
}

export function runDish(
  seed: number,
  slime: DishRun['slime'],
  front: Front,
  steps = 20000,
  every = 1000,
  side = 160,
  scentSteps = 300,
) {
  const layout = dish(side, [[side / 2, side / 2, 5]]);
  if (slime === 'all') layout.slime = layout.open.slice();
  const open = layout.open.reduce((a, b) => a + b, 0);
  const t0 = performance.now();
  // The colony starts 18,000 steps after the slime, as in the Y-maze (ymaze.ts).
  const sim = new Sim(layout, params({ seed, startStep: 18000, front, scentSteps }));
  const rows: DishRow[] = [];
  let [half, most] = [-1, -1];
  let [births, paid, starved] = [0, 0, 0];
  for (let k = 1; k <= steps; k++) {
    sim.advance();
    const territory = sim.territory.reduce((a, b) => a + b, 0);
    if (half < 0 && territory >= 0.5 * open) half = k;
    if (most < 0 && territory >= 0.9 * open) most = k;
    if (k % every !== 0) continue;
    rows.push({
      k,
      alive: sim.aliveCount,
      territory,
      births: sim.births - births,
      paid: sim.paidBirths - paid,
      starved: sim.starved - starved,
    });
    [births, paid, starved] = [sim.births, sim.paidBirths, sim.starved];
  }
  return { seed, slime, half, most, rows, ms: Math.round(performance.now() - t0) } satisfies DishRun;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** One line per record file: the times to cover the dish, and the agents and births of the last quarter. */
function table(dir: string) {
  const read = (file: string) =>
    readFileSync(join(dir, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as DishRun);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  for (const file of files) {
    const runs = read(file);
    const last = runs[0]!.rows.at(-1)!.k;
    const late = (r: DishRun) => r.rows.filter((row) => row.k > 0.75 * last);
    const sum = (r: DishRun, key: 'births' | 'paid' | 'starved') => late(r).reduce((a, row) => a + row[key], 0);
    const halves = runs.map((r) => r.half).filter((v) => v >= 0);
    let against = '';
    const none = file.replace(/-all\.jsonl$/, '-none.jsonl');
    if (none !== file && files.includes(none)) {
      const base = read(none)
        .map((r) => r.half)
        .filter((v) => v >= 0);
      against = `  ${(median(halves) / median(base)).toFixed(2)} times none, p ${mannWhitney(halves, base).toPrecision(2)}`;
    }
    const alive = runs.map((r) => r.rows.at(-1)!.alive);
    console.log(
      `${file.replace('.jsonl', '').padEnd(18)} ${String(runs.length)} runs  half ${String(median(halves))} (${String(halves.length)} reach it)  most ${String(median(runs.map((r) => r.most)))}  alive at ${String(last)}: ${String(median(alive))} (least ${String(Math.min(...alive))})  last quarter: births ${String(median(runs.map((r) => sum(r, 'births'))))}, paid ${String(median(runs.map((r) => sum(r, 'paid'))))}, starved ${String(median(runs.map((r) => sum(r, 'starved'))))}${against}`,
    );
  }
}

const isMain = process.argv[1]?.endsWith('dish.ts');
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
  if (args.table) table(args.table);
  else {
    // `scent`: the steps of the food scent before the colony starts (Params.scentSteps; 0 as the app, ADR 0072).
    const own = ['slime', 'seeds', 'steps', 'every', 'side', 'name', 'scent'];
    const front = frontFrom(args, own);
    const [from = 1, to = from] = (args.seeds ?? '1-2').split('-').map(Number);
    const slime = args.slime === 'all' ? 'all' : 'none';
    const name = args.name ?? `dish-${slime}`;
    mkdirSync('research/front/out', { recursive: true });
    const file = `research/front/out/${name}.jsonl`;
    for (let seed = from; seed <= to; seed++) {
      const steps = Number(args.steps ?? 20000);
      const run = runDish(seed, slime, front, steps, Number(args.every ?? 1000), 160, Number(args.scent ?? 300));
      appendFileSync(file, JSON.stringify({ ...run, front }) + '\n');
      const end = run.rows.at(-1);
      console.log(
        `seed ${String(seed)} slime ${slime}: half ${String(run.half)} most ${String(run.most)} alive ${String(end?.alive)} (${String(run.ms)} ms)`,
      );
    }
  }
}
