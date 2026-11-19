// The tables of the story (README.md of this folder) from the records of ymaze.ts. Prototype code.
// Usage: node --import ./research/flow/register.mjs research/front/tables.ts research/front/out/y3
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { YRun } from './ymaze';

/** A two-sided binomial test of k of n against one half. */
export function binomial(k: number, n: number): number {
  const choose = (a: number, b: number) => {
    let r = 1;
    for (let i = 1; i <= b; i++) r = (r * (a - b + i)) / i;
    return r;
  };
  const p = (i: number) => choose(n, i) / 2 ** n;
  const at = p(k);
  let sum = 0;
  for (let i = 0; i <= n; i++) if (p(i) <= at * (1 + 1e-9)) sum += p(i);
  return Math.min(1, sum);
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

export interface YRow {
  name: string;
  runs: number;
  /** One arm with slime: blank and slimed. Else left and right. */
  a: number;
  b: number;
  splits: number;
  p: number;
  /** Median steps from the start of the colony to the first food, and from there to the other food (touched ones). */
  first: number;
  other: number;
}

export function yRow(name: string, runs: YRun[]): YRow {
  const one = runs.every((r) => r.slimed.length === 1);
  let [a, b, splits] = [0, 0, 0];
  for (const r of runs) {
    if (r.chosen === 'split' || r.chosen === 'none') splits++;
    else if (one ? !r.slimed.includes(r.chosen) : r.chosen === 'left') a++;
    else b++;
  }
  return {
    name,
    runs: runs.length,
    a,
    b,
    splits,
    p: binomial(a, a + b),
    first: median(runs.filter((r) => Number.isFinite(r.first)).map((r) => r.first)),
    other: median(runs.filter((r) => r.other >= 0).map((r) => r.other)),
  };
}

const isMain = process.argv[1]?.endsWith('tables.ts');
if (isMain) {
  const dir = process.argv[2] ?? 'research/front/out/y3';
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()) {
    const runs = readFileSync(join(dir, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as YRun);
    const r = yRow(file.replace('.jsonl', ''), runs);
    console.log(
      `${r.name.padEnd(16)} ${String(r.runs).padStart(3)} runs  ${String(r.a)} : ${String(r.b)}${r.splits ? ` (+${String(r.splits)} split)` : ''}  p ${r.p.toPrecision(2)}  first ${String(r.first)}  other +${String(r.other)}`,
    );
  }
}
