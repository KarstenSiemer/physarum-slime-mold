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

/**
 * A two-sided Mann-Whitney test of two samples, with mid ranks and the normal approximation: the chance of a gap of
 * the ranks at least this large when both samples come from one distribution.
 */
export function mannWhitney(a: readonly number[], b: readonly number[]): number {
  const all = [...a.map((v) => [v, 0] as const), ...b.map((v) => [v, 1] as const)].sort((x, y) => x[0] - y[0]);
  const rank = new Array<number>(all.length);
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1]![0] === all[i]![0]) j++;
    for (let k = i; k <= j; k++) rank[k] = (i + j) / 2 + 1;
    i = j + 1;
  }
  let ra = 0;
  all.forEach(([, g], k) => {
    if (g === 0) ra += rank[k]!;
  });
  const [n, m] = [a.length, b.length];
  const u = ra - (n * (n + 1)) / 2;
  const z = Math.abs(u - (n * m) / 2) / Math.sqrt((n * m * (n + m + 1)) / 12);
  // The two tails of the normal distribution (Abramowitz and Stegun 7.1.26).
  const t = 1 / (1 + 0.3275911 * (z / Math.SQRT2));
  const erfc =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
    Math.exp(-(z * z) / 2);
  return Math.min(1, erfc);
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
  const read = (file: string) =>
    readFileSync(join(dir, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as YRun);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  const firsts = (runs: YRun[]) => runs.map((r) => r.first).filter(Number.isFinite);
  for (const file of files) {
    const runs = read(file);
    const r = yRow(file.replace('.jsonl', ''), runs);
    // A case with slime against the case without slime of the same name: the ratio of the medians and its test.
    const none = file.replace(/-(both|all)\.jsonl$/, '-none.jsonl');
    let against = '';
    if (none !== file && files.includes(none)) {
      const base = firsts(read(none));
      const ratio = r.first / median(base);
      against = `  ${ratio.toFixed(2)} times none, p ${mannWhitney(firsts(runs), base).toPrecision(2)}`;
    }
    console.log(
      `${r.name.padEnd(16)} ${String(r.runs).padStart(3)} runs  ${String(r.a)} : ${String(r.b)}${r.splits ? ` (+${String(r.splits)} split)` : ''}  p ${r.p.toPrecision(2)}  first ${String(r.first)}  other +${String(r.other)}${against}`,
    );
  }
}
