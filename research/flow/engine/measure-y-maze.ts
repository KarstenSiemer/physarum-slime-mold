// The records of the Y-maze (y-maze.gpu.test.ts, ADR 0056) as tables.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/measure-y-maze.ts [name ...]
//        node --import ./research/flow/register.mjs research/flow/engine/measure-y-maze.ts births <name> [name ...]
//        node --import ./research/flow/register.mjs research/flow/engine/measure-y-maze.ts draw [width]
//
// Without `births` it prints one line per record: a rule, a case and a width of the arms, over all runs of the files
// research/flow/out/engine/y-maze/<name>-s<first>-<last>.jsonl (every record of the folder without a name). A seed
// that two files hold counts once, as the later file has it. The line holds:
// - runs: the seeds of the record.
// - blank, slime, split, none: the runs by their chosen arm, with the samples of 50 steps: the arm whose food holds
//   plasm first; both in one sample is a split; none is a run without a touch. With slime on one arm the arms are the
//   blank one and the one with slime. Else they are the left and the right one, in the same columns.
// - p: the chance of a count this far from the half, when both arms are equal (binomial, two sides), without the
//   splits.
// - exact: the same counts and p with a look after every step (`exact` in the record).
// - first: the median of the steps from the inoculation to the first touch, by the look after every step; then the
//   same for the first sample of 50 steps with a touch.
// - lag: the median of the steps from the first touch to the touch of the other food; `+n` runs never touch it.
// - loser: the share of the cells of the arm that was not chosen that hold plasm, as a median: at the first touch
//   (by the look after every step), and at the end of the run. A run with both foods touched in one step has no such
//   arm.
// - agents: the median of the agents in the chosen arm and in the other arm at the first touch (exact).
//
// With `births` it prints, for the runs of the names that have a file of births (VITE_BIRTHS=1), how old the slime
// of the free neighbours of a parent is when a child is born. Each line is one class of the distance from the parent
// to ground that the colony did not reach yet (Chebyshev, in cells), up to the first touch and after it. A parent at
// the distance 1 stands at the front. `all reached`: no such ground is left.
// - births: the children of the class, and their share of the children of the phase.
// - free: the free neighbours of a parent, as a mean.
// - none, 0-1, 2-10, 11-100, 101-3000, above: the shares of the free neighbours by the age of their slime in steps:
//   no slime, then the classes; `above` is slime older than 3,000 steps, the painted slime of a run.
// - mixed: the share of the births whose parent had a free neighbour with slime and one without: there a weight on
//   "has slime" acts. old300: the same for slime older than 300 steps against any other free neighbour.
// - onto: the share of the children that were born onto a cell without slime, and onto slime older than 300 steps.
import { readdirSync, readFileSync } from 'node:fs';
import { outDir } from '../prototype/out.ts';
import { drawing, yMaze } from './y-maze.ts';

const DIR = process.env.DIR ?? outDir('engine/y-maze/');

interface Touch {
  t: number;
  chosen: string;
  fill: number[];
  alive: number;
  inArm: number[];
}
interface Run {
  name: string;
  variant: string;
  case: string;
  width: number;
  age: number;
  fresh: boolean;
  seed: number;
  slime: string;
  chosen: string;
  first: number | null;
  fillAtTouch: number[] | null;
  exact: Touch | null;
  second: number | null;
  steps: number;
  fillAtEnd: number[] | null;
  aliveAtEnd: number;
  gpuErrors: string[];
}

const SIDES = ['left', 'right'];
const median = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? (v[mid] ?? NaN) : ((v[mid - 1] ?? NaN) + (v[mid] ?? NaN)) / 2;
};
const fixed = (v: number, digits = 2) => (Number.isNaN(v) ? '-' : v.toFixed(digits));
/** A chance with four places, or as a power of ten below 0.0001. */
const chance = (p: number) => (p < 1e-4 ? p.toExponential(1) : p.toFixed(4));

/** The chance that a fair coin gives a count as far from n / 2 as k of n, or farther: two sides, exact. */
function binomial(k: number, n: number): number {
  if (n === 0) return 1;
  const pmf = (i: number) => {
    let c = 1;
    for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1);
    return c / 2 ** n;
  };
  const far = Math.abs(k - n / 2);
  let p = 0;
  for (let i = 0; i <= n; i++) if (Math.abs(i - n / 2) >= far - 1e-9) p += pmf(i);
  return Math.min(1, p);
}

/** The runs of the files of a name, or of every file of the folder: the last file with a seed wins. */
function runsOf(names: string[]): Map<string, Run[]> {
  const files = readdirSync(DIR)
    .filter((f) => /-s\d+-\d+\.jsonl$/.test(f))
    .filter((f) => names.length === 0 || names.includes(f.replace(/-s\d+-\d+\.jsonl$/, '')))
    .sort();
  const records = new Map<string, Map<number, Run>>();
  for (const file of files)
    for (const line of readFileSync(DIR + file, 'utf8')
      .trim()
      .split('\n')) {
      const run = JSON.parse(line) as Run;
      const seeds = records.get(run.name) ?? new Map<number, Run>();
      seeds.set(run.seed, run);
      records.set(run.name, seeds);
    }
  return new Map([...records].map(([name, seeds]) => [name, [...seeds.values()].sort((a, b) => a.seed - b.seed)]));
}

/** A chosen arm as the table counts it: `a` the blank or the left arm, `b` the arm with slime or the right arm. */
function column(run: Run, chosen: string): 'a' | 'b' | 'split' | 'none' {
  if (chosen === 'split' || chosen === 'none') return chosen;
  if (run.slime === 'left' || run.slime === 'right') return chosen === run.slime ? 'b' : 'a';
  return chosen === 'left' ? 'a' : 'b';
}

function table(names: string[]) {
  for (const [name, runs] of runsOf(names)) {
    const [head] = runs;
    if (!head) continue;
    const count = (chosen: (run: Run) => string) => {
      const n = { a: 0, b: 0, split: 0, none: 0 };
      for (const run of runs) n[column(run, chosen(run))]++;
      return n;
    };
    const coarse = count((run) => run.chosen);
    const exact = count((run) => run.exact?.chosen ?? 'none');
    const lags = runs.flatMap((run) => (run.exact && run.second !== null ? [run.second - run.exact.t] : []));
    const never = runs.filter((run) => run.exact && run.second === null).length;
    // The arm that was not chosen, for a run with one chosen arm.
    const other = (_: Run, chosen: string) => (SIDES.includes(chosen) ? 1 - SIDES.indexOf(chosen) : -1);
    const loser = (fill: (run: Run) => number[] | null | undefined) =>
      median(runs.flatMap((run) => fill(run)?.[other(run, run.exact?.chosen ?? '')] ?? []));
    const agents = (pick: (run: Run, chosen: number) => number) =>
      median(
        runs.flatMap((run) => {
          const chosen = SIDES.indexOf(run.exact?.chosen ?? '');
          return run.exact && chosen >= 0 ? [run.exact.inArm[pick(run, chosen)] ?? 0] : [];
        }),
      );
    const one = head.case === 'one';
    const errors = runs.filter((run) => run.gpuErrors.length > 0).length;
    console.log(
      `${name}: runs ${String(runs.length)} | ${one ? 'blank' : 'left'} ${String(coarse.a)} ${one ? 'slime' : 'right'} ${String(coarse.b)}` +
        ` split ${String(coarse.split)} none ${String(coarse.none)} p ${chance(binomial(coarse.a, coarse.a + coarse.b))}` +
        ` | exact ${String(exact.a)}:${String(exact.b)} split ${String(exact.split)} none ${String(exact.none)}` +
        ` p ${chance(binomial(exact.a, exact.a + exact.b))}` +
        ` | first ${fixed(median(runs.flatMap((run) => run.exact?.t ?? [])), 0)} sample ${fixed(median(runs.flatMap((run) => run.first ?? [])), 0)}` +
        ` | lag ${fixed(median(lags), 0)}${never ? ` +${String(never)}` : ''}` +
        ` | loser ${fixed(loser((run) => run.exact?.fill))} end ${fixed(loser((run) => run.fillAtEnd))}` +
        ` | agents ${fixed(
          agents((_, chosen) => chosen),
          0,
        )}:${fixed(
          agents((_, chosen) => 1 - chosen),
          0,
        )}` +
        (errors ? ` | ${String(errors)} runs with GPU errors` : ''),
    );
  }
}

/** The classes of the distance from a parent to ground that the colony did not reach yet. */
const DISTANCES: [label: string, to: number][] = [
  ['1', 1],
  ['2', 2],
  ['3+', 254],
  ['all reached', 255],
];
/** The classes of the age of slime of y-maze.gpu.test.ts (AGES), joined for the table: the classes of each column. */
const COLUMNS: [label: string, classes: number[]][] = [
  ['none', [0]],
  ['0-1', [1]],
  ['2-10', [2]],
  ['11-100', [3]],
  ['101-3000', [4, 5, 6]],
  ['above', [7]],
];

function births(names: string[]) {
  for (const [name, runs] of runsOf(names)) {
    const files = runs.flatMap((run) => {
      try {
        const text = readFileSync(`${DIR}${name}-births-s${String(run.seed)}.u32.b64`, 'utf8');
        return [{ run, data: new Uint32Array(new Uint8Array(Buffer.from(text, 'base64')).buffer) }];
      } catch {
        return [];
      }
    });
    if (files.length === 0) continue;
    console.log(`${name}: ${String(files.length)} runs with births, seeds ${files.map((f) => f.run.seed).join(',')}`);
    for (const [phase, inPhase] of [
      ['to the first touch', (t: number, touch: number) => t <= touch],
      ['after it', (t: number, touch: number) => t > touch],
    ] as const) {
      console.log(`  ${phase}:`);
      const rows = DISTANCES.map(([label, to], row) => {
        const from = (DISTANCES[row - 1]?.[1] ?? 0) + 1;
        const sum = { births: 0, free: 0, mixed: 0, old300: 0, ontoNone: 0, ontoOld: 0 };
        const classes = new Array<number>(8).fill(0);
        for (const { run, data } of files) {
          const touch = run.exact?.t ?? Infinity;
          for (let i = 0; i < data.length; i += 4) {
            const [t = 0, , packed = 0, around = 0] = data.subarray(i, i + 4);
            const distance = (packed >> 8) & 255;
            if (!inPhase(t, touch) || distance < from || distance > to) continue;
            const free = Array.from({ length: 8 }, (_, k) => (around >>> (4 * k)) & 15).filter((c) => c !== 15);
            sum.births++;
            sum.free += free.length;
            for (const c of free) classes[c] = (classes[c] ?? 0) + 1;
            if (free.some((c) => c === 0) && free.some((c) => c > 0)) sum.mixed++;
            if (free.some((c) => c >= 5) && free.some((c) => c < 5)) sum.old300++;
            const onto = (packed >> 16) & 15;
            if (onto === 0) sum.ontoNone++;
            if (onto >= 5) sum.ontoOld++;
          }
        }
        return { label, sum, classes };
      });
      const all = rows.reduce((n, row) => n + row.sum.births, 0);
      const share = (v: number, of: number) => fixed(v / Math.max(of, 1), 3);
      for (const { label, sum, classes } of rows) {
        if (sum.births === 0) continue;
        const columns = COLUMNS.map(([column, list]) => {
          const cells = list.reduce((n, c) => n + (classes[c] ?? 0), 0);
          return ` ${column} ${share(cells, sum.free)}`;
        });
        console.log(
          `    distance ${label}: births ${String(sum.births)} (${share(sum.births, all)})` +
            ` free ${fixed(sum.free / sum.births, 1)} |${columns.join('')}` +
            ` | mixed ${share(sum.mixed, sum.births)} old300 ${share(sum.old300, sum.births)}` +
            ` | onto none ${share(sum.ontoNone, sum.births)} old ${share(sum.ontoOld, sum.births)}`,
        );
      }
    }
  }
}

const [first = '', ...rest] = process.argv.slice(2);
if (first === 'draw') console.log(drawing(yMaze(Number(rest[0] ?? 19))));
else if (first === 'births') births(rest);
else table(first ? [first, ...rest] : []);
