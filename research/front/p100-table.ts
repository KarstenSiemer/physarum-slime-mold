// The table of ADR 0100 from the records of research/front/p100-ring.gpu.test.ts: per run the agents, the budget and the
// sheet (the measure No sheet of study 1d) at the steps 5,000, 10,000, 15,000 and 20,000, and the rise from the second
// covered food: the most agents within 1,000 steps of the first record with two covered ports, against the agents of
// that record (P1B-NOTES.md, "The measure"). Usage:
//   node --import ./research/flow/register.mjs research/front/p100-table.ts research/front/out/p100
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Row {
  step: number;
  alive: number;
  budget?: number;
  sheet?: number;
  ports?: number;
}

const dir = process.argv[2] ?? 'research/front/out/p100';
const at = (rows: Row[], k: number) => rows.find((r) => r.step === k + 1 || r.step === k);
const n = (v: number | undefined, digits = 0) =>
  v === undefined ? '–' : v.toLocaleString('en', { maximumFractionDigits: digits, minimumFractionDigits: digits });

console.log(
  '| Run | Agents at 5,000; 10,000; 15,000; 20,000 | Budget at 10,000; 20,000 | Sheet at 10,000; 20,000 | Rise |',
);
console.log('| --- | --- | --- | --- | --- |');
for (const name of readdirSync(dir).sort()) {
  let text: string;
  try {
    text = readFileSync(join(dir, name, 'record.jsonl'), 'utf8');
  } catch {
    continue;
  }
  const rows = text
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => JSON.parse(l) as Row);
  const agents = [5000, 10000, 15000, 20000].map((k) => n(at(rows, k)?.alive)).join('; ');
  const budget = [10000, 20000].map((k) => n(at(rows, k)?.budget)).join('; ');
  const sheet = [10000, 20000].map((k) => n(at(rows, k)?.sheet, 2)).join('; ');
  const second = rows.findIndex((r) => (r.ports ?? 0) >= 2);
  let rise = '–';
  const start = rows[second];
  if (second >= 0 && start) {
    const most = Math.max(
      ...rows.filter((r) => r.step >= start.step && r.step <= start.step + 1000).map((r) => r.alive),
    );
    rise = `+${String(Math.round((100 * most) / start.alive - 100))} % (step ${n(start.step)}, ${n(start.alive)})`;
  }
  console.log(`| ${name} | ${agents} | ${budget} | ${sheet} | ${rise} |`);
}
