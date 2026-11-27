// The measures of study 1d (ADR 0097) from the records of feed.ts that p1d.sh writes: by case and seed the agents and
// the budget, nine foods against one, the windows without growth, the boom from the second food and the fall, the
// sheet, the births and deaths by kind, the agents on old ground by origin, and the band at the wall. A case is the
// name of its record without the seed (`jones-f9-s3` is the case `jones-f9`). Prototype code. Usage:
//   node --import ./research/flow/register.mjs research/front/p1d-table.ts research/front/out/p1d/probe \
//     research/front/out/p1d/c6
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Bin, FeedRow } from './feed';
import { stalls } from './feed-table';

interface Run {
  seed: number;
  foods: number;
  rows: FeedRow[];
  fine?: { k: number; alive: number; budget: number; covered: number }[];
}

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const pc = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(100 * x).toFixed(0)} %` : '–');

/** The runs of the folders by case, each seed once, in the order of the seeds. */
export function readCases(dirs: string[]): Map<string, Run[]> {
  const cases = new Map<string, Run[]>();
  for (const dir of dirs)
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl')))
      for (const l of readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean)) {
        const run = JSON.parse(l) as Run;
        const key = f.replace(/\.jsonl$/, '').replace(/-s\d+$/, '');
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
 * No boom (ADR 0092, P1B-NOTES.md): the largest rise of the agents within 1,000 steps from the first step with 2
 * covered foods on, and the largest fall within 1,000 steps from the first step with 1,000 agents on. From the series
 * of every 100 steps, or else from the rows.
 */
export function boom(run: Run) {
  const pts = run.fine ?? run.rows.map((r) => ({ k: r.k, alive: r.alive, budget: r.budget, covered: r.covered }));
  const at = new Map(pts.map((p) => [p.k, p.alive]));
  const second = pts.find((p) => p.covered >= 2)?.k ?? -1;
  const first = pts.find((p) => p.alive >= 1000)?.k ?? -1;
  let [rise, fall] = [second >= 0 ? 0 : NaN, first >= 0 ? 0 : NaN];
  for (const p of pts) {
    const later = at.get(p.k + 1000);
    if (later === undefined) continue;
    if (second >= 0 && p.k >= second) rise = Math.max(rise, later / p.alive - 1);
    if (first >= 0 && p.k >= first) fall = Math.min(fall, later / p.alive - 1);
  }
  return { second, rise, fall };
}

/** Agents per cell, and flux per cell, of the bins of a band; the first two bins against the rest. */
function band(bins: Bin[] | undefined) {
  if (!bins) return '–';
  const per = (b: Bin) => (b.cells > 0 ? b.agents / b.cells : NaN);
  const inner = (f: (b: Bin) => number) => sum(bins.slice(2).map(f));
  const outer = (f: (b: Bin) => number) => sum(bins.slice(0, 2).map(f));
  const ratio = (f: (b: Bin) => number) =>
    outer(f) /
    Math.max(
      1,
      outer((b) => b.cells),
    ) /
    (inner(f) /
      Math.max(
        1,
        inner((b) => b.cells),
      ));
  return (
    `agents/cell ${bins.map((b) => per(b).toFixed(2)).join(' ')} | 0–12 against the rest: agents ` +
    `${ratio((b) => b.agents).toFixed(2)}, flux ${ratio((b) => b.flux).toFixed(2)}`
  );
}

/** The dish is full when at most this many open cells lie beside the territory (a few cells that it never reaches). */
const FULL = 50;
/** The window of the ledger: `ledger=5000-10000` on the command line, else the steps 10,001 to 20,000. */
const [FROM, TO] = (process.argv.find((a) => a.startsWith('ledger='))?.slice(7) ?? '10000-20000')
  .split('-')
  .map(Number) as [number, number];

const isMain = process.argv[1]?.endsWith('p1d-table.ts');
if (isMain) {
  const cases = readCases(process.argv.slice(2).filter((a) => !a.startsWith('ledger=')));
  const row = (r: Run, k: number) => r.rows.find((x) => x.k === k);
  const keys = [...cases.keys()].sort();
  console.log(
    'Agents (budget) at 5,000 | 10,000 | 20,000; the second food; No boom; stalls; the sheet at 10,000 and 20,000',
  );
  for (const key of keys)
    for (const r of cases.get(key)!) {
      const ab = (k: number) => {
        const x = row(r, k);
        return x ? `${String(x.alive)} (${x.budget.toFixed(0)})` : '–';
      };
      const sheet = (k: number) => {
        const x = row(r, k);
        return x?.old ? (x.plasm! / x.old).toFixed(2) : '–';
      };
      const b = boom(r);
      const maxB = Math.max(...(r.fine ?? r.rows).map((x) => x.budget));
      // The dish is full at the first row with at most FULL open cells beside the territory; the row before it.
      const full = r.rows.findIndex((x) => x.room <= FULL);
      const before = full > 0 ? r.rows[full - 1]! : undefined;
      const end = row(r, 20000);
      console.log(
        `${key} s${String(r.seed)}: ${ab(5000)} | ${ab(10000)} | ${ab(20000)}; budget max ${maxB.toFixed(0)}; ` +
          `covered ${String(end?.covered)}, second food ${String(b.second)}; rise ${pc(b.rise)}, ` +
          `fall ${pc(b.fall)}; stalls [${stalls(r.rows).join(',')}]; sheet ${sheet(10000)} ${sheet(20000)}; full ` +
          `${full >= 0 ? String(r.rows[full]!.k) : '–'}${before ? ` (${String(before.alive)} agents at ${String(before.k)})` : ''}` +
          `; mass at 20,000 ${end ? (end.alive + end.budget).toFixed(0) : '–'}`,
      );
    }
  console.log('Nine foods against one at step 20,000, seed by seed:');
  for (const key of keys.filter((k) => k.endsWith('-f9'))) {
    const one = cases.get(key.replace(/-f9$/, '-f1')) ?? [];
    const ratios = (cases.get(key) ?? []).flatMap((r) => {
      const base = one.find((o) => o.seed === r.seed);
      const [a, b] = [row(r, 20000)?.alive, base && row(base, 20000)?.alive];
      return a && b ? [`s${String(r.seed)} ${(a / b).toFixed(2)}`] : [];
    });
    console.log(`${key}: ${ratios.join(', ') || '–'}`);
  }
  console.log(
    `Steps ${String(FROM + 1)} to ${String(TO)}, per step: births by kind, deaths by cause; the agents on old ground:`,
  );
  for (const key of keys)
    for (const r of cases.get(key)!) {
      const late = r.rows.filter((x) => x.k > FROM && x.k <= TO);
      const per = (f: (x: FeedRow) => number) => (sum(late.map(f)) / (TO - FROM)).toFixed(1);
      const ages = sum(late.map((x) => sum(x.age)));
      const deaths = sum(late.map((x) => sum(x.starve) + sum(x.crowd)));
      const old = (k: number) => {
        const x = row(r, k);
        if (!x?.onOldBy) return '–';
        const n = sum(x.onOldBy);
        const share = (v: number) => (n > 0 ? (v / n).toFixed(2) : '–');
        return (
          `${String(n)} on old ground (${(n / Math.max(1, x.alive)).toFixed(2)} of all), born there ` +
          `${share(x.onOldBornOld!)}; start/Jones/paid/respawn ${x.onOldBy.map(share).join('/')}`
        );
      };
      console.log(
        `${key} s${String(r.seed)}: born J ${per((x) => x.born[1]!)} P ${per((x) => x.born[2]!)} ` +
          `R ${per((x) => x.born[3]!)} | died ${per((x) => sum(x.starve) + sum(x.crowd))}: starved ` +
          `${per((x) => sum(x.starve))}, crowded ${per((x) => sum(x.crowd))} | age at death ` +
          `${(ages / Math.max(1, deaths)).toFixed(0)} | at 10,000: ${old(10000)} | at 20,000: ${old(20000)}`,
      );
    }
  console.log('The band at 15,000 and 20,000: bins of 0–6, 6–12, 12–24, 24–48 and more cells; the sinks:');
  for (const key of keys)
    for (const r of cases.get(key)!)
      for (const k of [15000, 20000]) {
        const x = row(r, k);
        if (!x?.edge) continue;
        const perSink = x.sinks ? (x.take! / x.sinks).toFixed(3) : '–';
        console.log(
          `${key} s${String(r.seed)} ${String(k)}: sinks ${String(x.sinks)}, take each ${perSink}, room ${String(x.room)}`,
        );
        console.log(`  from the edge of the territory: ${band(x.edge)}`);
        console.log(`  from the wall of the dish:      ${band(x.wall)}`);
      }
}
