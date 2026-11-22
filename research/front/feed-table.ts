// The measures of study 1c (ADR 0093) from the records of feed.ts: the agents by case and seed, the ratio of nine
// foods to one, the windows of 2,000 steps without growth, and where the paid births go. Prototype code. Usage:
//   node --import ./research/flow/register.mjs research/front/feed-table.ts research/front/out/p1c/probe \
//     research/front/out/p1c/c6
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FeedRow } from './feed';

interface Run {
  seed: number;
  foods: number;
  rows: FeedRow[];
  front: { feed: string };
}

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** The runs of the folders, by case: the word of `feed` and the foods. A seed counts once per case. */
export function readRuns(dirs: string[]): Map<string, Run[]> {
  const cases = new Map<string, Run[]>();
  for (const dir of dirs)
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl')))
      for (const l of readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean)) {
        const run = JSON.parse(l) as Run;
        const key = `${run.front.feed}-f${String(run.foods)}`;
        const list = cases.get(key) ?? [];
        if (!list.some((r) => r.seed === run.seed)) list.push(run);
        cases.set(
          key,
          list.sort((a, b) => a.seed - b.seed),
        );
      }
  return cases;
}

/**
 * The windows of `span` steps in which the agents did not grow while the colony covered a food and open ground lay
 * beside its territory, at the start and at the end of the window (the measure No stall of the plan, 3.4).
 */
export function stalls(rows: FeedRow[], span = 2000): number[] {
  const at = new Map(rows.map((r) => [r.k, r]));
  const out: number[] = [];
  for (let k = span; k <= rows.at(-1)!.k; k += span) {
    const [a, b] = [at.get(k - span), at.get(k)];
    if (!a || !b) continue;
    if (a.covered < 1 || b.covered < 1 || a.room === 0 || b.room === 0) continue;
    if (b.alive <= a.alive) out.push(k);
  }
  return out;
}

const isMain = process.argv[1]?.endsWith('feed-table.ts');
if (isMain) {
  const cases = readRuns(process.argv.slice(2));
  const end = (r: Run, k: number) => r.rows.find((x) => x.k === k);
  console.log('The agents at the steps 5,000, 10,000 and 20,000, the covered foods and the room at 20,000:');
  for (const [key, runs] of [...cases.entries()].sort()) {
    const lines = runs.map((r) => {
      const [a, b, c] = [5000, 10000, 20000].map((k) => end(r, k));
      return `s${String(r.seed)} ${String(a?.alive)} ${String(b?.alive)} ${String(c?.alive)} cov ${String(c?.covered)} room ${String(c?.room)} stalls [${stalls(r.rows).join(',')}]`;
    });
    const last = runs.map((r) => end(r, 20000)?.alive ?? NaN);
    console.log(`${key.padEnd(9)} median ${String(median(last))}: ${lines.join(' | ')}`);
  }
  const one = cases.get('fixed-f1') ?? [];
  for (const key of [...cases.keys()].filter((k) => k.endsWith('-f9')).sort()) {
    const ratios = (cases.get(key) ?? []).flatMap((r) => {
      const base = one.find((o) => o.seed === r.seed);
      const [a, b] = [end(r, 20000)?.alive, base && end(base, 20000)?.alive];
      return a && b ? [a / b] : [];
    });
    console.log(
      `${key} against fixed-f1, seed by seed: ${ratios.map((x) => x.toFixed(2)).join(' ')} (median ${median(ratios).toFixed(2)}, least ${Math.min(...ratios).toFixed(2)})`,
    );
  }
  // Where the paid births go: the births and deaths of the steps 10,000 to 20,000, per step, and the paid-born agents.
  console.log('The steps 10,001 to 20,000, per step: births by kind, deaths by cause, and the paid-born agents:');
  for (const [key, runs] of [...cases.entries()].sort())
    for (const r of runs) {
      const late = r.rows.filter((x) => x.k > 10000);
      const add = (f: (x: FeedRow) => number) => sum(late.map(f)) / 10000;
      const paidDeaths = sum(late.map((x) => x.starve[2]! + x.crowd[2]!));
      const paidStarve = sum(late.map((x) => x.starve[2]!));
      const paidAge = sum(late.map((x) => x.age[2]!)) / Math.max(1, paidDeaths);
      const deaths = add((x) => sum(x.starve) + sum(x.crowd));
      const allAge = sum(late.map((x) => sum(x.age))) / Math.max(1, deaths * 10000);
      const c = end(r, 20000)!;
      console.log(
        `${key} s${String(r.seed)}: credit ${add((x) => x.credited).toFixed(2)} cut ${add((x) => x.truncated).toFixed(2)} claims ${add((x) => x.claims).toFixed(2)} born paid ${add((x) => x.born[2]!).toFixed(2)} Jones ${add((x) => x.born[1]!).toFixed(1)} respawn ${add((x) => x.born[3]!).toFixed(2)} | died ${deaths.toFixed(1)}: starved ${add((x) => sum(x.starve)).toFixed(1)} (on closed ${add((x) => x.closedDeaths).toFixed(1)}), crowded ${add((x) => sum(x.crowd)).toFixed(1)} | age at death ${allAge.toFixed(0)}, paid-born ${paidAge.toFixed(0)} (${(paidStarve / Math.max(1, paidDeaths)).toFixed(2)} starved) | alive at 20,000: ${String(c.alive)}, paid-born ${String(c.aliveBy[2])}, on closed ${String(c.onClosed)}; territory ${String(c.territory)}, closed ${String(c.closed)}`,
      );
    }
}
