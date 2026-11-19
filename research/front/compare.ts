// The records of a form against the records of the rule set before it, case by case (ADR 0067). Prototype code.
// Usage: node --import ./research/flow/register.mjs research/front/compare.ts <y-new> <y-before> [<dish-new> <dish-before>]
// The Y-maze: the choice of each record against the one before it (Fisher's test of the two pairs of counts) and the
// first food (the ratio of the medians, and a Mann-Whitney test). The dish: the steps until the territory covers half
// of the dish, the cells of the territory and the agents at the last row, and the births of the last quarter.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DishRun } from './dish';
import { mannWhitney, yRow } from './tables';
import type { YRun } from './ymaze';

/** A two-sided Fisher test of the counts a : b against c : d: the chance of tables as unlikely as this one or less. */
export function fisher(a: number, b: number, c: number, d: number): number {
  const logFact = (n: number) => {
    let s = 0;
    for (let i = 2; i <= n; i++) s += Math.log(i);
    return s;
  };
  const [row1, row2, col1, n] = [a + b, c + d, a + c, a + b + c + d];
  const p = (x: number) =>
    Math.exp(
      logFact(row1) +
        logFact(row2) +
        logFact(col1) +
        logFact(n - col1) -
        (logFact(n) + logFact(x) + logFact(row1 - x) + logFact(col1 - x) + logFact(row2 - col1 + x)),
    );
  const at = p(a);
  let sum = 0;
  for (let x = Math.max(0, col1 - row2); x <= Math.min(row1, col1); x++) if (p(x) <= at * (1 + 1e-9)) sum += p(x);
  return Math.min(1, sum);
}

const median = (v: number[]) => {
  const s = [...v].sort((x, y) => x - y);
  return s.length === 0 ? NaN : s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

const records = <T>(dir: string) =>
  Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .map((f) => [
        f.replace('.jsonl', ''),
        readFileSync(join(dir, f), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as T),
      ]),
  );

/** One line per record of the Y-maze that both folders hold. */
export function compareY(now: string, before: string): string[] {
  const [a, b] = [records<YRun>(now), records<YRun>(before)];
  const firsts = (runs: YRun[]) => runs.map((r) => r.first).filter(Number.isFinite);
  return Object.keys(a)
    .filter((name) => b[name])
    .map((name) => {
      const [x, y] = [yRow(name, a[name]!), yRow(name, b[name]!)];
      const split = (r: typeof x) => (r.splits ? ` (+${String(r.splits)})` : '');
      const time = median(firsts(a[name]!)) / median(firsts(b[name]!));
      return (
        `${name.padEnd(10)} ${String(x.a)} : ${String(x.b)}${split(x)} against ${String(y.a)} : ${String(y.b)}${split(y)}` +
        ` (Fisher p ${fisher(x.a, x.b, y.a, y.b).toPrecision(2)})  first ${String(x.first)} against ${String(y.first)}:` +
        ` ${time.toFixed(2)} times (p ${mannWhitney(firsts(a[name]!), firsts(b[name]!)).toPrecision(2)})`
      );
    });
}

/** One line per record of the dish that both folders hold. */
export function compareDish(now: string, before: string): string[] {
  const [a, b] = [records<DishRun>(now), records<DishRun>(before)];
  const last = (r: DishRun) => r.rows.at(-1)!;
  const late = (r: DishRun) => {
    const end = last(r).k;
    return r.rows.filter((row) => row.k > 0.75 * end).reduce((s, row) => s + row.births, 0);
  };
  const measure = (name: string, of: (r: DishRun) => number, digits = 0) => {
    const [x, y] = [a[name]!.map(of).filter((v) => v >= 0), b[name]!.map(of).filter((v) => v >= 0)];
    if (x.length === 0 || y.length === 0) return `never against ${y.length ? String(median(y)) : 'never'}`;
    const p = mannWhitney(x, y).toPrecision(2);
    return `${median(x).toFixed(digits)} against ${median(y).toFixed(digits)} (${(median(x) / median(y)).toFixed(2)} times, p ${p})`;
  };
  return Object.keys(a)
    .filter((name) => b[name])
    .map(
      (name) =>
        `${name.padEnd(10)} half ${measure(name, (r) => r.half)}; territory ${measure(name, (r) => last(r).territory)};` +
        ` agents ${measure(name, (r) => last(r).alive)}; births of the last quarter ${measure(name, late)}`,
    );
}

const isMain = process.argv[1]?.endsWith('compare.ts');
if (isMain) {
  // A folder '-' of the Y-maze compares the dish alone.
  const [yNow, yBefore, dishNow, dishBefore] = process.argv.slice(2);
  if (yNow && yBefore && yNow !== '-') for (const line of compareY(yNow, yBefore)) console.log(line);
  if (dishNow && dishBefore) for (const line of compareDish(dishNow, dishBefore)) console.log(line);
}
