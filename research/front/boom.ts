// The tables of study 1b (ADR 0092) from the records of boom.gpu.test.ts.
// - The measure No boom of the plan of 2026-11-22 (2.5): the largest change of the count of agents within 1,000 steps,
//   once the colony holds 1,000 agents. It reads every pair of rows 1,000 steps apart from the first row with 1,000
//   agents on, and gives the largest rise and the largest fall, each with its first step. Pass: both inside ±30 %.
// - With `kinds`: the births and the deaths by kind in the window of steps that the run sorted, summed per `span` steps:
//   the respawns, the births of the growth pass (Jones' rule and the paid births), the paid claims (which bound the paid
//   births from above: a claim can lose its cell), the starved agents and those that Jones' shrinkage took.
// Usage: node --import ./research/flow/register.mjs research/front/boom.ts [kinds [span]] <record.jsonl>...
import { readFileSync } from 'node:fs';

type Row = Record<string, number>;
const rowsOf = (path: string) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);

/** The largest rise and fall of the alive count within `span` steps, from the first row with `least` agents on. */
export function noBoom(rows: readonly Row[], span = 1000, least = 1000) {
  const pts = rows.filter((r) => typeof r.step === 'number' && typeof r.alive === 'number');
  const at = new Map(pts.map((r) => [r.step!, r.alive!]));
  const first = pts.find((r) => r.alive! >= least)?.step;
  let rise = { change: 0, step: -1 },
    fall = { change: 0, step: -1 };
  if (first === undefined)
    return { first: -1, rise, fall, end: pts.at(-1)?.step ?? 0, peak: 0, second: -1, riseAtFood: 0 };
  for (const r of pts) {
    if (r.step! < first) continue;
    const later = at.get(r.step! + span);
    if (later === undefined) continue;
    const change = later / r.alive! - 1;
    if (change > rise.change) rise = { change, step: r.step! };
    if (change < fall.change) fall = { change, step: r.step! };
  }
  const peak = Math.max(...pts.map((r) => r.alive!));
  // The same rise from the first row on which the colony covers 2 foods (the ports of the state of the sinks): the
  // growth of a colony from 1,000 agents doubles within 1,000 steps too, and only this part reads the new food.
  const second = rows.find((r) => (r.ports ?? 0) >= 2)?.step ?? -1;
  let riseAtFood = 0;
  for (const r of pts) {
    const later = second >= 0 && r.step! >= second ? at.get(r.step! + span) : undefined;
    if (later !== undefined) riseAtFood = Math.max(riseAtFood, later / r.alive! - 1);
  }
  return { first, rise, fall, end: pts.at(-1)!.step!, peak, second, riseAtFood };
}

const args = process.argv.slice(2);
if (args[0] === 'kinds') {
  const span = Number.isFinite(Number(args[1])) ? Number(args.splice(1, 1)[0]) : 250;
  for (const path of args.slice(1)) {
    const rows = rowsOf(path).filter((r) => r.fine === 1);
    // The streams read the step count before the step (A): in a step without the growth test, A explains every
    // birth as a respawn and every death as starvation (the check of 2026-11-22). B, the count after the step, is a
    // control: its matches are chance.
    const control = rows.reduce((n, r) => n + r.respawnB!, 0);
    console.log(`${path}: respawns that the count after the step would explain (chance): ${control}`);
    console.log(
      'steps         | alive start → end | respawn | growth pass | paid claims | starved | shrunk | veins (D > 0.5)',
    );
    for (let i = 0; i < rows.length; i += span) {
      const part = rows.slice(i, i + span);
      const sum = (key: string) => part.reduce((n, r) => n + (r[key] ?? 0), 0);
      const respawn = sum('respawnA');
      const starved = sum('starvedA');
      const paid = sum('paid');
      const grown = sum('born') - respawn;
      const shrunk = sum('died') - starved;
      const a = part[0]!,
        b = part.at(-1)!;
      const startAlive = a.alive! - a.born! + a.died!;
      console.log(
        `${String(a.step).padStart(5)}–${String(b.step).padEnd(6)} | ${String(startAlive).padStart(6)} → ${String(b.alive).padEnd(6)} | ` +
          `${String(respawn).padStart(7)} | ${String(grown).padStart(11)} | ${String(paid).padStart(11)} | ` +
          `${String(starved).padStart(7)} | ${String(shrunk).padStart(6)} | ${b.veins}`,
      );
    }
  }
} else {
  console.log(
    'record | 1,000 agents at | largest rise (from) | largest fall (from) | 2 foods at | rise from then | peak | pass',
  );
  for (const path of args) {
    const m = noBoom(rowsOf(path));
    const pass = m.first >= 0 && m.rise.change <= 0.3 && m.fall.change >= -0.3;
    const pc = (x: number) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(0)} %`;
    console.log(
      `${path.replace(/\/record\.jsonl$/, '')} | ${m.first} | ${pc(m.rise.change)} (${m.rise.step}) | ` +
        `${pc(m.fall.change)} (${m.fall.step}) | ${m.second} | ${pc(m.riseAtFood)} | ${m.peak} | ` +
        (m.first < 0 ? 'never 1,000' : pass ? 'pass' : 'fail'),
    );
  }
}
