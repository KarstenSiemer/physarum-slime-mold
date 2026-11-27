// The table of the scenes of Reid et al. 2012 (ADR 0066) from the records of reid.gpu.test.ts: per run the steps at
// which the colony reached each food, the agents and the cells with plasm at some steps, and in the Y-maze the plasm on
// the base and on each arm. With a second record it says whether the runs of both have the same bytes at the end.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/measure-reid.ts <record> [<other record>]
// A record is the name of a file in research/flow/out/engine/ without `.jsonl`, or a path.
import { readFileSync } from 'node:fs';

interface Run {
  kind: string;
  scene: string;
  seed: number;
  slime: boolean;
  step: number;
  sites: { middle: number[]; cells: number; touched: number | null }[];
  alive: number;
  agentsSha: string;
  trailSha: string;
  series: { step: number; alive: number; plasm: number; parts: Record<string, number> }[];
}

const read = (name: string): Run[] =>
  readFileSync(name.includes('/') ? name : `research/flow/out/engine/${name}.jsonl`, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Run);

/** The steps of the columns of the table. */
const AT = [500, 1000, 2000, 3000, 6000];

const [first, second] = process.argv.slice(2);
if (!first) throw new Error('name a record');
const runs = read(first);
const key = (r: Run) => `${r.kind} ${r.scene} ${String(r.seed)}`;
for (const r of runs) {
  const foods = r.sites.map((s) => `food at (${s.middle.join(', ')}) step ${String(s.touched ?? 'none')}`).join('; ');
  const at = AT.filter((step) => step <= r.step).map((step) => {
    const row = r.series.find((s) => s.step === step);
    if (!row) return `${String(step)}: -`;
    const parts = Object.entries(row.parts)
      .map(([name, n]) => `${name} ${String(n)}`)
      .join(', ');
    return `${String(step)}: ${String(row.alive)} agents, plasm ${String(row.plasm)}${parts ? ` (${parts})` : ''}`;
  });
  console.log(`${key(r)} slime ${r.slime ? 'yes' : 'no'}: ${foods}`);
  for (const line of at) console.log(`  ${line}`);
}
if (second) {
  const others = new Map(read(second).map((r) => [key(r), r]));
  let same = 0;
  for (const r of runs) {
    const o = others.get(key(r));
    if (o?.agentsSha === r.agentsSha && o.trailSha === r.trailSha && o.step === r.step) same++;
    else console.log(`differ: ${key(r)}`);
  }
  console.log(`${String(same)} of ${String(runs.length)} runs have the bytes of ${second} at the last step`);
}
