// The tables of README.md and of ADR 0045 from the lines of coarsen.gpu.test.ts and veins.ts (README.md has the
// definitions). research.test.ts compares what this file prints with the tables of README.md.
// Usage: node --import ./research/flow/register.mjs research/coarsening/tables.ts [folder of the logs]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVEL } from './measure.ts';

interface Cover {
  av: number;
  r: number;
  rho: number;
  holes: number;
}
interface Sample {
  so: number;
  seed: number;
  step: number;
  alive: number;
  levels: Record<string, Cover>;
}
interface Veins {
  so: number;
  seed: number;
  step: number;
  av: number;
  veins: number;
  length: number;
  mean: number;
  [degree: `k${number}`]: number;
}

/** The paper's fit of the coarsening time of its model (Eq. 4, p. 1210). */
export const paperTc = (so: number) => 140352 / so ** 2 + 1422;

const jsonl = <T>(file: string) =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as T);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: number[]) => Math.sqrt(v.reduce((a, b) => a + (b - mean(v)) ** 2, 0) / Math.max(1, v.length - 1));
const int = (v: number) => Math.round(v).toLocaleString('en-US');
const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
/** The least-squares line y = a + b x and its R². */
function line(xs: number[], ys: number[]) {
  const [mx, my] = [mean(xs), mean(ys)];
  let [sxy, sxx, syy] = [0, 0, 0];
  xs.forEach((x, i) => {
    sxy += (x - mx) * ((ys[i] ?? 0) - my);
    sxx += (x - mx) ** 2;
    syy += ((ys[i] ?? 0) - my) ** 2;
  });
  return { a: my - (sxy / sxx) * mx, b: sxy / sxx, r2: (sxy * sxy) / (sxx * syy) };
}

export interface Run {
  so: number;
  seed: number;
  samples: Sample[];
  /** The first sampled step from which the mask holds at most one lacuna: the last ring, no branching point. */
  tc: number;
  /** The first sampled step from which the mask holds no lacuna: the ring has closed to a spot. */
  tmax: number;
}

/** The runs of a log, each with its coarsening time and the time of its collapse. */
export function runsOf(samples: Sample[], level = String(LEVEL)): Run[] {
  const runs = new Map<string, Sample[]>();
  for (const s of samples) {
    const key = `${String(s.so)}/${String(s.seed)}`;
    runs.set(key, [...(runs.get(key) ?? []), s]);
  }
  return [...runs.values()].map((list) => {
    /** The first step after the last sample with more than `most` lacunae. */
    const from = (most: number) => {
      const last = list.findLastIndex((s) => (s.levels[level]?.holes ?? 0) > most);
      return list[last + 1]?.step ?? NaN;
    };
    const first = list[0]!;
    return { so: first.so, seed: first.seed, samples: list, tc: from(1), tmax: from(0) };
  });
}

const at = (run: Run, step: number, level: string) => run.samples.find((s) => s.step >= step)?.levels[level];

/** Table 1: the coarsening time of each sensor distance against the paper's model. */
export function timesTable(runs: Run[]): string[] {
  const out = [
    row(['SO', 'tc of the seeds', 'tc, mean', 'paper, Eq. 4', 'app / paper', 'tmax, mean', 'tc / tmax']),
    row(['---', '---', '---', '---', '---', '---', '---']),
  ];
  for (const so of [...new Set(runs.map((r) => r.so))].sort((a, b) => a - b)) {
    const mine = runs.filter((r) => r.so === so);
    const [tc, tmax] = [mean(mine.map((r) => r.tc)), mean(mine.map((r) => r.tmax))];
    out.push(
      row([
        so,
        mine.map((r) => int(r.tc)).join(', '),
        int(tc),
        int(paperTc(so)),
        (tc / paperTc(so)).toFixed(2),
        int(tmax),
        (tc / tmax).toFixed(2),
      ]),
    );
  }
  return out;
}

/** The fit tc = γ / SO² + tc(0) over all runs (the paper's Eq. 4), as one line of text. */
export function fitLine(runs: Run[]): string {
  const f = line(
    runs.map((r) => 1 / r.so ** 2),
    runs.map((r) => r.tc),
  );
  return `tc = ${int(f.b)} / SO² + ${int(f.a)} (R² ${f.r2.toFixed(3)}, ${String(runs.length)} runs); the paper: 140,352 / SO² + 1,422`;
}

/** Table 2: the coverage of one sensor distance over time, at each level of the mask. */
export function coverageTable(runs: Run[], so: number, levels: string[]): string[] {
  const mine = runs.filter((r) => r.so === so);
  const out = [
    row(['Step', ...levels.map((l) => `ρ, level ${l}`), 'lacunae', 'agents']),
    row(['---', ...levels.map(() => '---'), '---', '---']),
  ];
  const cells = (label: string, pick: (r: Run) => Sample | undefined) => {
    const picked = mine.map(pick).filter((s) => s !== undefined);
    return row([
      label,
      ...levels.map((l) => mean(picked.map((s) => s.levels[l]?.rho ?? 0)).toFixed(2)),
      mean(picked.map((s) => s.levels[String(LEVEL)]?.holes ?? 0)).toFixed(1),
      int(mean(picked.map((s) => s.alive))),
    ]);
  };
  for (const step of [25, 200, 1000, 2500, 5000])
    out.push(cells(int(step), (r) => r.samples.find((s) => s.step >= step)));
  out.push(cells('tc', (r) => r.samples.find((s) => s.step >= r.tc)));
  out.push(cells('(tc + tmax) / 2', (r) => r.samples.find((s) => s.step >= (r.tc + r.tmax) / 2)));
  return out;
}

/** The lowest coverage of each run before its tc, and where it lies: a line of text per level. */
export function minimumLine(runs: Run[], so: number, level: string): string {
  const mine = runs.filter((r) => r.so === so);
  const lows = mine.map((r) => {
    const before = r.samples.filter((s) => s.step <= r.tc);
    return before.reduce((low, s) => ((s.levels[level]?.rho ?? 1) < (low.levels[level]?.rho ?? 1) ? s : low));
  });
  const rho = lows.map((s) => (s.levels[level]?.rho ?? 0).toFixed(2)).join(', ');
  return `level ${level}: lowest ρ up to tc ${rho} at steps ${lows.map((s) => int(s.step)).join(', ')}`;
}

/**
 * The veins of one run in normalised time, from the mask with the most veins on: before it the sheet of the start
 * still breaks up into veins, and the count rises.
 */
function course(run: Run, veins: Veins[]) {
  const mine = veins.filter((v) => v.so === run.so && v.seed === run.seed && v.step < run.tmax);
  const most = mine.reduce((best, v, i) => (v.veins > (mine[best]?.veins ?? 0) ? i : best), 0);
  return mine.slice(most).map((v) => ({ ...v, t: v.step / run.tmax }));
}

/**
 * Table 3: the fall of the number of veins of each sensor distance. N0 is the largest count of a run. The
 * rates are the slopes of ln N over t / tmax before and after t / tmax = 0.06, where the paper's model changes its
 * rate (p. 1211), up to 0.6, where the paper's Fig. 6 ends, on masks with 3 veins or more. β is the slope of
 * ln(mean length) over ln N on masks with 6 veins or more (the paper's Eq. 8).
 */
export function veinsTable(runs: Run[], veins: Veins[]): string[] {
  const out = [
    row([
      'SO',
      'N0',
      'at step',
      'rate before 0.06',
      'rate after 0.06',
      'before / after',
      'β',
      'degree 3',
      'degree 4',
      'higher',
    ]),
    row(['---', '---', '---', '---', '---', '---', '---', '---', '---', '---']),
  ];
  for (const so of [...new Set(runs.map((r) => r.so))].sort((a, b) => a - b)) {
    const courses = runs.filter((r) => r.so === so).map((r) => course(r, veins));
    const all = courses.flat();
    if (all.length === 0) continue;
    const slope = (from: number, to: number) => {
      const part = all.filter((v) => v.t >= from && v.t <= to && v.veins >= 3);
      // Each run counts from its own N0.
      const n0 = new Map(courses.map((c) => [c[0]?.seed, c[0]?.veins ?? 1]));
      return part.length < 3
        ? NaN
        : -line(
            part.map((v) => v.t),
            part.map((v) => Math.log(v.veins / (n0.get(v.seed) ?? 1))),
          ).b;
    };
    const [fast, slow] = [slope(0, 0.06), slope(0.06, 0.6)];
    const text = (v: number, digits: number) => (Number.isFinite(v) ? v.toFixed(digits) : 'n/a');
    const many = all.filter((v) => v.veins >= 6);
    const beta = line(
      many.map((v) => Math.log(v.veins)),
      many.map((v) => Math.log(v.mean)),
    ).b;
    // The junctions of all masks by their degree: the fields k3, k4 and so on of a line of veins.ts.
    const byDegree = new Map<number, number>();
    for (const v of all)
      for (const [key, count] of Object.entries(v))
        if (/^k\d+$/.test(key)) byDegree.set(Number(key.slice(1)), (byDegree.get(Number(key.slice(1))) ?? 0) + count);
    const degree = (k: number) => byDegree.get(k) ?? 0;
    const junctions = [...byDegree.values()].reduce((n, c) => n + c, 0);
    const share = (n: number) => `${((100 * n) / junctions).toFixed(1)} %`;
    out.push(
      row([
        so,
        int(mean(courses.map((c) => c[0]?.veins ?? 0))),
        int(mean(courses.map((c) => c[0]?.step ?? 0))),
        text(fast, 1),
        text(slow, 1),
        text(fast / slow, 1),
        beta.toFixed(2),
        share(degree(3)),
        share(degree(4)),
        share(junctions - degree(3) - degree(4)),
      ]),
    );
  }
  return out;
}

/** Table 4: the mean width of the veins of one sensor distance over normalised time: Av over the summed length. */
export function widthTable(runs: Run[], veins: Veins[], so: number): string[] {
  const marks = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const out = [row(['t / tmax', ...marks.map(String)]), row(['---', ...marks.map(() => '---')])];
  const courses = runs.filter((r) => r.so === so).map((r) => course(r, veins));
  const pick = (get: (v: Veins) => number, digits: number) =>
    marks.map((m) =>
      mean(courses.map((c) => c.find((v) => v.t >= m)).flatMap((v) => (v && v.veins > 0 ? [get(v)] : []))).toFixed(
        digits,
      ),
    );
  out.push(row(['veins', ...pick((v) => v.veins, 0)]));
  out.push(row(['mean length, cells', ...pick((v) => v.mean, 1)]));
  out.push(row(['mean width, cells', ...pick((v) => v.av / v.length, 2)]));
  return out;
}

/** Everything that README.md shows, in its order. */
export function report(dir: string): string {
  const runs = runsOf(jsonl<Sample>(join(dir, 'coarsen-webgpu.jsonl')));
  const veins = jsonl<Veins>(join(dir, 'veins-coarsen-webgpu.jsonl'));
  const order = runsOf(jsonl<Sample>(join(dir, 'order-webgpu.jsonl')));
  const levels = Object.keys(runs[0]?.samples[0]?.levels ?? {}).sort((a, b) => Number(a) - Number(b));
  const spread = (list: Run[]) => `${int(mean(list.map((r) => r.tc)))} ± ${int(sd(list.map((r) => r.tc)))}`;
  const five = runs.filter((r) => r.so === 5);
  return [
    ...timesTable(runs),
    '',
    fitLine(runs),
    '',
    ...coverageTable(runs, 5, levels),
    '',
    ...levels.map((l) => minimumLine(runs, 5, l)),
    `ρ at tc, level ${levels.join(' / ')}: ${levels.map((l) => mean(five.map((r) => at(r, r.tc, l)?.rho ?? 0)).toFixed(2)).join(' / ')}`,
    '',
    ...veinsTable(runs, veins),
    '',
    ...widthTable(runs, veins, 7),
    '',
    `SO 5, sense first (the scene): tc ${spread(five)}; move first: tc ${spread(order)} (seeds ${order.map((r) => int(r.tc)).join(', ')})`,
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(report(process.argv[2] ?? fileURLToPath(new URL('./logs/', import.meta.url))));
