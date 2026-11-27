// The summary of part E2e (ADR 0075; E2e-NOTES.md): reads the rows of `e2e-backends.gpu.test.ts` and prints per backend
// and strain the median and the range of the live agents at the end, the Mann-Whitney p between the backends, and the
// range of the least pressure of the first 30 steps.
// Usage: node --import ./research/flow/register.mjs research/front/e2e-summary.ts research/front/out/e2e-backends.txt
import { readFileSync } from 'node:fs';
import { mannWhitney } from './tables';

const file = process.argv[2] ?? 'research/front/out/e2e-backends.txt';
const runs = readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => line.startsWith('CHECK '))
  .map((line) => {
    const field = (name: string) => new RegExp(`${name}=(\\S+)`).exec(line)?.[1] ?? '';
    return {
      kind: line.split(' ')[1] ?? '',
      seed: Number(field('seed')),
      step: Number(field('step')),
      alive: field('alive').split('/').map(Number),
      least: field('least').split('/').map(Number),
    };
  });
const kinds = [...new Set(runs.map((r) => r.kind))];
const strains = Math.max(...runs.map((r) => r.alive.length));
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const span = (v: number[]) => `${String(Math.min(...v))} to ${String(Math.max(...v))}`;
const of = (kind: string, pick: (r: (typeof runs)[number]) => number) => runs.filter((r) => r.kind === kind).map(pick);
console.log(`${String(runs.length)} runs, steps ${[...new Set(runs.map((r) => r.step))].join(', ')}`);
for (let s = 0; s <= strains; s++) {
  const name = s < strains ? `strain ${'ABCD'[s] ?? String(s)}` : 'sum';
  const pick = (r: (typeof runs)[number]) => (s < strains ? (r.alive[s] ?? 0) : r.alive.reduce((a, b) => a + b, 0));
  const cells = kinds.map((k) => `${k} ${String(median(of(k, pick)))} (${span(of(k, pick))})`);
  const [a = '', b = ''] = kinds;
  const p = kinds.length === 2 ? `, p ${mannWhitney(of(a, pick), of(b, pick)).toPrecision(2)}` : '';
  console.log(`${name}: ${cells.join(', ')}${p}`);
}
for (const kind of kinds)
  for (let s = 0; s < strains; s++)
    console.log(
      `least pressure of the first 30 steps, ${kind}, strain ${'ABCD'[s] ?? String(s)}: ${span(of(kind, (r) => r.least[s] ?? 0))}`,
    );
