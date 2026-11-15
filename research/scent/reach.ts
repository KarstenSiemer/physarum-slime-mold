// The reach of the scent of one food (ADR 0036), from the lines of profile.gpu.test.ts. For each scent decay d and
// number of passes p it prints:
//
// - the fall-off per cell far from the food, measured and as the formula gives it. A 3 × 3 mean filter scales the
//   mode e^(−κ x), the same along y, by (1 + 2 cosh κ) / 3. In the steady state the decay and p passes leave it
//   unchanged: (1 − d) ((1 + 2 cosh κ) / 3)^p = 1, so cosh κ = (3 (1 − d)^(−1/p) − 1) / 2. Beside a long line of food
//   the scent is that mode, e^(−κ x); far from a dab it falls like K0(κ r) ~ e^(−κ r) / √r, as it spreads in two
//   directions. The app's Scent reach is ln(10) / κ (scentReach() in src/model/params.ts);
// - the scent at the edge of the food, the cells from that edge at which the scent falls to a third and to a tenth of
//   it, and the cells at which it falls below 0.01, where the glow of the scent view ends (scent.ts).
//
// Usage: node --import ./research/flow/register.mjs research/scent/reach.ts research/scent/logs/*.jsonl
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scentReach } from '../../src/model/params.ts';

export interface Row {
  kind: string;
  shape?: 'dab' | 'line';
  passes: number;
  decay: number;
  radius: number;
  steps: number;
  line: number[];
}

/** κ of the formula above, from the app's own scentReach(). */
export const kappa = (decay: number, passes: number) => Math.LN10 / scentReach(decay, passes);

/** The first distance from the edge at which the line falls below `level`, linear between cells; NaN if never. */
function below(line: number[], from: number, level: number): number {
  for (let r = from + 1; r < line.length; r++) {
    const [a, b] = [line[r - 1] ?? 0, line[r] ?? 0];
    if (b < level) return r - 1 + (a - level) / (a - b) - from;
  }
  return NaN;
}

/**
 * κ measured: the slope of ln(s √r) beside a dab, ln(s) beside a line, over the cells 4 to 4 + 3/κ past the edge,
 * where the scent is above 1e-25.
 */
export function measured(line: number[], from: number, guess: number, dab: boolean): number {
  const [xs, ys]: [number[], number[]] = [[], []];
  const end = Math.min(line.length - 1, Math.round(from + 4 + 3 / guess));
  for (let r = from + 4; r <= end; r++) {
    const v = line[r] ?? 0;
    if (v <= 1e-25) break;
    xs.push(r);
    ys.push(Math.log(dab ? v * Math.sqrt(r + 0.5) : v));
  }
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let [sxy, sxx] = [0, 0];
  xs.forEach((x, i) => {
    sxy += (x - mx) * ((ys[i] ?? 0) - my);
    sxx += (x - mx) ** 2;
  });
  return -sxy / sxx;
}

/** The rows of the files, each a line of profile.gpu.test.ts. */
export const rowsOf = (files: string[]) =>
  files.flatMap((f) => readFileSync(f, 'utf8').trim().split('\n')).map((l) => JSON.parse(l) as Row);

/** The table of the rows, in Markdown: a header, a line of dashes and a line per row. */
export function table(rows: Row[]): string[] {
  const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const lines = [
    '| Backend | Food | Passes | Scent decay | κ measured | κ formula | Reach, ln 10 / κ | Edge | 1/3 | 1/10 | Below 0.01 |',
    '| ------- | ---- | ------ | ----------- | ---------- | --------- | ---------------- | ---- | --- | ---- | ---------- |',
  ];
  for (const r of rows) {
    const from = Math.ceil(r.radius);
    const edge = r.line[from] ?? 0;
    const k = kappa(r.decay, r.passes);
    const cells = [
      r.kind,
      r.shape ?? 'dab',
      String(r.passes),
      String(r.decay),
      f(measured(r.line, from, k, r.shape !== 'line'), 4),
      f(k, 4),
      f(Math.LN10 / k),
      f(edge, 2),
      f(below(r.line, from, edge / 3)),
      f(below(r.line, from, edge / 10)),
      f(below(r.line, from, 0.01)),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines;
}

// Only when Node runs this file as a script, and not when a test loads it.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(table(rowsOf(process.argv.slice(2))).join('\n'));
}
