// The tables of ADR 0029 from the logs of the runs: medians and ranges over the seeds.
// Usage: node --import ./research/flow/register.mjs research/flow/summary.ts <table> ...
//
// - maze-campaign <folder> <prefix>...   the logs <prefix>-s<seed>.jsonl of run-maze.ts or run-maze-sites.ts
// - tokyo-campaign <folder> <prefix>...  the logs <prefix>-s<seed>.jsonl of run-tokyo.ts, one line per measured step
// - engine-maze <file>...                the lines of engine/measure-maze.ts
// - engine-mazes <file>...               the lines of engine/measure-mazes.ts: per run without the seed and per window
//                                        of 10,000 steps (WINDOW=<steps> for another size), the least and the most of
//                                        the seeds (ADR 0054)
// - engine-tokyo <file>...               the lines of engine/measure-tokyo.ts, per step
// - engine-tokyo-end <file>...           the same lines: the samples with all food sources joined, mean and deviation
// - compare <folder> <folder>            the logs of the same name in two folders, row by row: a rerun against the record
// - digests <file> <file>                the lines of engine/digest.gpu.test.ts of two checkouts, scene by scene
// - exact-flux <file>...                 the lines of engine/exact-flux.ts: per run without the seed and per step, the
//                                        median over the seeds of the median over the fields, with the least and
//                                        the most of the seeds
// - strands <file>...                    the lines of engine/strands.ts: per run without the seed and per step, the
//                                        tubes that the flux has left and the ground that their starvation marks
// - regrowth <lines> <strands> [from]    the lines of measure-tokyo.ts and of strands.ts of the runs that take a part
//                                        of the colony off at step 24,000: when the network joins its foods again
import { readdirSync, readFileSync } from 'node:fs';

const [table = '', ...rest] = process.argv.slice(2);

/** Says what is wrong and ends with an error code at the end of the script. */
function fail(message: string) {
  console.error(message);
  process.exitCode = 1;
}
/** Stops the script: a folder or a file is not there. The logs of the record are an archive until they are unpacked. */
function missing(what: string, path: string): never {
  console.error(`no ${what} ${path}`);
  if (path.includes('logs'))
    console.error(
      'The logs of the record are in research/flow/logs.tar.gz. Unpack them first: node --import ./research/flow/register.mjs research/flow/logs.ts',
    );
  process.exit(1);
}
/** A folder name with a slash at its end. The script stops if the folder cannot be read. */
function folderOf(folder: string): string {
  // The read itself is the check: a check before a read could be true for another state of the disk.
  try {
    readdirSync(folder);
  } catch {
    missing('folder', folder);
  }
  return folder.endsWith('/') ? folder : `${folder}/`;
}
/** The text of a file. The script stops if the file cannot be read. */
function textOf(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    missing('file', file);
  }
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
/** The standard deviation of a sample (n − 1). */
const deviation = (v: number[]) => Math.sqrt(v.reduce((a, b) => a + (b - mean(v)) ** 2, 0) / (v.length - 1));
/** "median (least to most)" of the values that are numbers; "-" without any. */
function range(values: (number | undefined)[], digits = 2, count = false): string {
  const v = values.filter((x): x is number => x !== undefined && !Number.isNaN(x));
  if (v.length === 0) return '-';
  const f = (x: number) => x.toFixed(digits);
  return `${f(median(v))} (${f(Math.min(...v))} to ${f(Math.max(...v))}${count ? `, n ${v.length}` : ''})`;
}
const jsonl = (file: string) =>
  textOf(file)
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
/**
 * The seed of the log `<prefix>-s<seed>.jsonl`, and nothing for a file with another name. The prefix comes from the
 * command line: it is compared as plain text and is not part of a pattern.
 */
function seedOf(file: string, prefix: string): number | undefined {
  const [head, tail] = [`${prefix}-s`, '.jsonl'];
  if (!file.startsWith(head) || !file.endsWith(tail)) return undefined;
  const seed = file.slice(head.length, file.length - tail.length);
  return /^\d+$/.test(seed) ? Number(seed) : undefined;
}
/** The logs <prefix>-s<seed>.jsonl of a folder, by seed, without their first line (the options). */
function runs(folder: string, prefix: string): Record<string, unknown>[][] {
  const dir = folderOf(folder);
  const found = readdirSync(dir)
    .map((file) => ({ file, seed: seedOf(file, prefix) }))
    .filter((log): log is { file: string; seed: number } => log.seed !== undefined)
    .sort((a, b) => a.seed - b.seed)
    .map(({ file }) => jsonl(dir + file).filter((r) => 'step' in r))
    .filter((r) => r.length > 0);
  if (found.length === 0) fail(`no log ${prefix}-s<seed>.jsonl in ${dir}`);
  return found;
}
const num = (r: Record<string, unknown> | undefined, key: string) => r?.[key] as number | undefined;

function mazeCampaign(folder: string, prefixes: string[]) {
  for (const prefix of prefixes) {
    const all = runs(folder, prefix);
    if (all.length === 0) continue;
    const last = Math.min(...all.map((r) => num(r[r.length - 1], 'step') ?? 0));
    console.log(`== ${prefix}: ${all.length} runs, all reach step ${last}`);
    for (const step of [1000, 2500, 5000, 10000, 15000]) {
      if (step > last) continue;
      const at = all.map((rows) => rows.find((r) => r.step === step));
      const joined = at.filter((a) => a?.joined === true);
      console.log(
        `  step ${String(step).padStart(5)}: trail ratio ${range(
          at.map((a) => num(a, 'ratio')),
          2,
          true,
        )} | trail dead ${range(
          at.map((a) => num(a, 'trailDead')),
          3,
          true,
        )} | alive ${range(
          at.map((a) => num(a, 'alive')),
          0,
          true,
        )} | joined ${joined.length} of ${at.length} | tube ${range(
          joined.map((a) => num(a, 'tube')),
          2,
          true,
        )}`,
      );
    }
    for (const key of ['10%', '2%']) {
      const fade = all.map((rows) => (rows[rows.length - 1]?.fade as Record<string, number> | undefined)?.[key]);
      const got = fade.filter((x) => x !== undefined);
      console.log(
        `  dead ends below ${key} of the route: ${got.length} of ${fade.length} runs; step ${range(got, 0, true)}`,
      );
    }
    // A run whose network died has no route: its whole trail fades, the trail of the dead ends first.
    const dead = all.filter((rows) => rows[rows.length - 1]?.joined !== true).length;
    if (dead > 0)
      console.log(
        `  NO NETWORK in ${dead} of ${all.length} runs: no tube joins the two foods at the last step. In such a run the whole trail fades, and "below" does not show a route.`,
      );
  }
}

function tokyoCampaign(folder: string, prefixes: string[]) {
  for (const prefix of prefixes)
    for (const [i, rows] of runs(folder, prefix).entries()) {
      console.log(`== ${prefix}, run ${i + 1}: ${rows.length} measured steps`);
      for (const r of rows) {
        const [a, b] = [r.m33 as Record<string, number | null>, r.m36 as Record<string, number | null>];
        const f = (x: number | null | undefined) => (x ?? NaN).toFixed(2);
        console.log(
          `  step ${String(r.step).padStart(6)} alive ${String(r.alive).padStart(5)} | 33: ${a.joined} joined, ${a.links} links, TL ${f(a.tl)} MD ${f(a.md)} FT ${f(a.ft)} | 36: ${b.joined} joined, TL ${f(b.tl)} MD ${f(b.md)} FT ${f(b.ft)}`,
        );
      }
    }
}

/** The lines of measure-maze.ts: by run name without the seed, by seed, by step. */
function engineMaze(files: string[]) {
  interface Row {
    alive: number;
    ratio: number;
    tP: number;
    tD: number;
    joined: boolean;
    tube: number;
    ms: number;
  }
  const rows = new Map<string, Map<number, Map<number, Row>>>();
  const pattern =
    /^(\S+)-s(\d+) (\d+) alive (\d+) ratio (\S+) tP (\S+) tD (\S+) joined (\w+) tube (\S+) dP (\S+) dD (\S+) ms (\S+)/;
  for (const line of files.flatMap((f) => textOf(f).split('\n'))) {
    const m = pattern.exec(line);
    if (!m) continue;
    const seeds = rows.get(m[1]!) ?? new Map<number, Map<number, Row>>();
    rows.set(m[1]!, seeds);
    const steps = seeds.get(Number(m[2])) ?? new Map<number, Row>();
    seeds.set(Number(m[2]), steps);
    steps.set(Number(m[3]), {
      alive: Number(m[4]),
      ratio: Number(m[5]),
      tP: Number(m[6]),
      tD: Number(m[7]),
      joined: m[8] === 'true',
      tube: Number(m[9]),
      ms: Number(m[12]),
    });
  }
  for (const [name, seeds] of rows) {
    const steps = [...(seeds.values().next().value?.keys() ?? [])].sort((a, b) => a - b);
    console.log(`== ${name}: ${seeds.size} seeds`);
    for (const step of steps) {
      const d = [...seeds.values()].map((s) => s.get(step)).filter((x) => x !== undefined);
      console.log(
        `  step ${String(step).padStart(6)}: dead ends over route ${range(
          d.map((x) => x.tD / x.tP),
          4,
        )} | alive ${range(
          d.map((x) => x.alive),
          0,
        )} | joined ${d.filter((x) => x.joined).length} of ${d.length} | tube ${range(d.map((x) => x.tube))}`,
      );
    }
    for (const level of [0.1, 0.02]) {
      const first = [...seeds.values()].map((s) =>
        steps.find((step) => (s.get(step)?.tD ?? 1) / (s.get(step)?.tP ?? 1) < level),
      );
      const ok = first.filter((x) => x !== undefined);
      console.log(
        `  dead ends below ${level} of the route: ${ok.length} of ${first.length} seeds, first measured step ${range(ok, 0)}`,
      );
    }
    const last = steps[steps.length - 1] ?? 1;
    console.log(`  ms per step: ${range([...seeds.values()].map((s) => (s.get(last)?.ms ?? NaN) / last))}`);
  }
}

/**
 * The windows of the runs of a maze with growth, from the lines of engine/measure-mazes.ts (ADR 0054): per run without
 * the seed and per window, the median of the seeds with their least and their most. A line holds its numbers with two
 * digits, so a mean of the blind branches from these lines is right to about 0.001.
 */
function engineMazes(files: string[]) {
  const size = Number(process.env.WINDOW ?? 10_000);
  interface Row {
    step: number;
    joined: boolean;
    onRoute: number;
    /** Snail maze: the trail of each blind branch over that of the route. */
    blind: number[];
    /** Corn maze: the routes with a tube, each by its number of rooms. */
    routes: number[] | undefined;
  }
  const rows = new Map<string, Map<number, Row[]>>();
  const pattern = /^(\S+)-s(\d+) (\d+) alive \d+ ratio \S+ joined (\w+) tube \S+ onRoute (\S+) (.*)$/;
  for (const line of files.flatMap((f) => textOf(f).split('\n'))) {
    const m = pattern.exec(line);
    if (!m) continue;
    const blind = /^blind (\S+) blindFlow/.exec(m[6]!)?.[1];
    const routes = /^routes (\S+) doors/.exec(m[6]!)?.[1];
    const seeds = rows.get(m[1]!) ?? new Map<number, Row[]>();
    rows.set(m[1]!, seeds);
    const list = seeds.get(Number(m[2])) ?? [];
    seeds.set(Number(m[2]), list);
    list.push({
      step: Number(m[3]),
      joined: m[4] === 'true',
      onRoute: Number(m[5]),
      blind: blind === undefined ? [] : blind.split(',').map(Number),
      routes: routes === undefined ? undefined : routes === '-' ? [] : routes.split(',').map(Number),
    });
  }
  const share = (part: Row[], test: (r: Row) => boolean) => part.filter(test).length / part.length;
  for (const [name, seeds] of rows) {
    const all = [...seeds.values()];
    const end = Math.max(...all.flatMap((list) => list.map((r) => r.step)));
    // The shortest route: the least number of rooms of a route with a tube in these runs.
    const shortest = Math.min(...all.flatMap((list) => list.flatMap((r) => r.routes ?? [])));
    console.log(`== ${name}: ${String(seeds.size)} seeds, windows of ${String(size)} steps`);
    for (let from = 0; from < end; from += size) {
      const parts = all
        .map((list) => list.filter((r) => r.step > from && r.step <= from + size))
        .filter((part) => part.length > 0);
      if (parts.length === 0) continue;
      const scene = parts[0]?.[0]?.routes
        ? `tube on a longer route ${range(parts.map((p) => share(p, (r) => (r.routes ?? []).some((l) => l !== shortest))))}`
        : `blind ${range(
            parts.map((p) => mean(p.flatMap((r) => r.blind))),
            3,
          )} | a blind branch at 0.10 or more ${range(
            parts.map((p) => {
              const values = p.flatMap((r) => r.blind);
              return values.filter((v) => v >= 0.1).length / values.length;
            }),
          )}`;
      console.log(
        `  steps ${String(from).padStart(6)} to ${String(from + size).padStart(6)} (${String(parts.length)} seeds): joined ${range(
          parts.map((p) => share(p, (r) => r.joined)),
        )} | onRoute ${range(parts.map((p) => mean(p.map((r) => r.onRoute))))} | ${scene}`,
      );
    }
  }
}

interface TokyoRow {
  alive: number;
  j33: number;
  links: number;
  tl: number;
  md: number;
  ft: number;
  j36: number;
  ms: number;
  /** With LIT (measure-tokyo.ts): the shares of the network on lit cells and on cells with half the light or more. */
  lit?: number;
  bright?: number;
}
/** The lines of measure-tokyo.ts: by run name without the seed, by seed, by step. */
function tokyoRows(files: string[]): Map<string, Map<number, Map<number, TokyoRow>>> {
  const rows = new Map<string, Map<number, Map<number, TokyoRow>>>();
  const pattern =
    /^(\S+)-s(\d+)\s+(\d+) alive\s+(\d+) \| 33: (\d+) joined (\d+) links TL (\S+) MD (\S+) FT (\S+) \| 36: (\d+) joined TL (\S+) MD (\S+) FT (\S+) \| sea (\d+) \| (\S+) ms(?: \| lit (\S+) % bright (\S+) %)?/;
  for (const line of files.flatMap((f) => textOf(f).split('\n'))) {
    const m = pattern.exec(line);
    if (!m) continue;
    const seeds = rows.get(m[1]!) ?? new Map<number, Map<number, TokyoRow>>();
    rows.set(m[1]!, seeds);
    const steps = seeds.get(Number(m[2])) ?? new Map<number, TokyoRow>();
    seeds.set(Number(m[2]), steps);
    steps.set(Number(m[3]), {
      alive: Number(m[4]),
      j33: Number(m[5]),
      links: Number(m[6]),
      tl: Number(m[7]),
      md: Number(m[8]),
      ft: Number(m[9]),
      j36: Number(m[10]),
      ms: Number(m[15]),
      ...(m[16] === undefined ? {} : { lit: Number(m[16]), bright: Number(m[17]) }),
    });
  }
  return rows;
}

function engineTokyo(files: string[]) {
  for (const [name, seeds] of tokyoRows(files)) {
    console.log(`== ${name}`);
    const steps = [...new Set([...seeds.values()].flatMap((s) => [...s.keys()]))].sort((a, b) => a - b);
    for (const step of steps) {
      const d = [...seeds.values()].map((s) => s.get(step)).filter((x) => x !== undefined);
      console.log(
        `  step ${String(step).padStart(6)} (${String(d.length).padStart(2)} seeds): all 33 joined in ${String(
          d.filter((x) => x.j33 === 33).length,
        ).padStart(2)}, all 36 in ${String(d.filter((x) => x.j36 === 36).length).padStart(2)} (least ${Math.min(
          ...d.map((x) => x.j36),
        )} of 36) | TL ${range(d.map((x) => x.tl))} | MD ${range(d.map((x) => x.md))} | FT ${range(
          d.map((x) => x.ft),
        )} | links ${range(
          d.map((x) => x.links),
          1,
        )} | alive ${range(
          d.map((x) => x.alive),
          0,
        )}${litOf(d)}`,
      );
    }
  }
}

/** The shares of the network under the light, in per cent, when the lines have them (LIT in measure-tokyo.ts). */
function litOf(d: TokyoRow[]): string {
  const lit = d.map((x) => x.lit).filter((x) => x !== undefined);
  if (lit.length === 0) return '';
  return ` | lit ${range(lit)} %, below 5 % in ${lit.filter((x) => x < 5).length} of ${lit.length} | bright ${range(
    d.map((x) => x.bright),
  )} %`;
}

function engineTokyoEnd(files: string[]) {
  const STEPS = [4000, 8000, 12000, 16000, 24000, 32000, 40000, 48000];
  for (const [name, seeds] of tokyoRows(files)) {
    const samples = [...seeds.values()].flatMap((s) => STEPS.map((t) => s.get(t)).filter((x) => x !== undefined));
    // The longest run of samples in a row without all 36, over the seeds.
    let longest = 0;
    for (const s of seeds.values()) {
      let run = 0;
      for (const t of STEPS) {
        const row = s.get(t);
        if (row && row.j36 < 36) longest = Math.max(longest, ++run);
        else run = 0;
      }
    }
    console.log(
      `== ${name}: ${seeds.size} seeds, ${samples.length} samples from step 4,000 on: all 36 joined in ${
        samples.filter((x) => x.j36 === 36).length
      }, all 33 in ${samples.filter((x) => x.j33 === 33).length}, least ${Math.min(
        ...samples.map((x) => x.j36),
      )} of 36, longest run without all 36: ${longest} samples`,
    );
    for (const t of [24000, 48000]) {
      const d = [...seeds.values()].map((s) => s.get(t)).filter((x) => x !== undefined);
      if (d.length === 0) continue;
      const stat = (key: 'tl' | 'md' | 'ft') => {
        const v = d.map((x) => x[key]);
        return `${mean(v).toFixed(2)} ± ${d.length > 1 ? deviation(v).toFixed(2) : '-'}, median ${range(v)}`;
      };
      // The check of the specification of 2026-11-11: TL from 1.45 to 2.05 and MD from 0.77 to 0.93; FT at least 0.66.
      const ok = d.filter((x) => x.tl >= 1.45 && x.tl <= 2.05 && x.md >= 0.77 && x.md <= 0.93).length;
      console.log(
        `   step ${t}: ${d.length} seeds | TL ${stat('tl')} | MD ${stat('md')} | FT ${stat('ft')} | links ${range(
          d.map((x) => x.links),
          1,
        )} | all 36 joined: ${d.filter((x) => x.j36 === 36).length} | check of TL and MD: ${ok} of ${d.length}, FT at least 0.66: ${
          d.filter((x) => x.ft >= 0.66).length
        }${
          // The check of the specification for the runs with light: FT at least 0.78 (ADR 0042).
          d.some((x) => x.lit !== undefined) ? `, FT at least 0.78: ${d.filter((x) => x.ft >= 0.78).length}` : ''
        }${litOf(d)}`,
      );
    }
    // The network as a whole late in the run: every sample from step 16,000 on, so that one step weighs less
    // (ADR 0029, amendment 2026-11-14 (2)).
    const late = [...seeds.values()].flatMap((s) =>
      [16000, 24000, 32000, 40000, 48000].map((t) => s.get(t)).filter((x) => x !== undefined),
    );
    if (late.length > 1) {
      const of = (key: 'tl' | 'md' | 'ft' | 'links' | 'alive') => late.map((x) => x[key]);
      console.log(
        `   steps 16000 to 48000: ${late.length} samples | TL ${mean(of('tl')).toFixed(2)} ± ${deviation(
          of('tl'),
        ).toFixed(2)} | MD ${mean(of('md')).toFixed(2)} | FT ${mean(of('ft')).toFixed(2)} | links ${mean(
          of('links'),
        ).toFixed(1)} ± ${deviation(of('links')).toFixed(1)} | alive ${mean(of('alive')).toFixed(0)}${litOf(late)}`,
      );
    }
  }
}

/**
 * The lines of exact-flux.ts (ADR 0029, decisions 6 and 18): by run and step, over seeds and fields. A run is the name
 * of a dump without its seed; the radius of the dumps of decision 18 is in their name, `r5` for 0.99999 and `r6` for
 * 0.999999, and a dump made for the table of decision 18 alone has `-p` or `-g` before its seed.
 */
function exactFlux(files: string[]) {
  interface Field {
    sum: number;
    error: number;
    top: number;
    tubes: number;
    fed: number;
  }
  const pattern =
    /^(\S+) step (\d+) lane \d: \d+ sites, (\d+) tube cells, .*\((\d+) %\) \| sum of \|difference\| \d+ % \| cells with exact flux above 5 % of I0: \d+, error median (\d+) %, 90th percentile \d+ %(?: \| local pressure on the tubes from (\S+) to (\S+))?(?: \| tube cells with a flow memory above 0\.5: (\d+))?/;
  const rows = new Map<string, Map<number, Map<string, Field[]>>>();
  for (const line of files.flatMap((f) => textOf(f).split('\n'))) {
    const m = pattern.exec(line);
    if (!m) continue;
    const name = m[1]!;
    const run = name
      .replace(/-(?:[pg]-)?s\d+$/, '')
      .replace(/-r5$/, '-r0.99999')
      .replace(/-r6$/, '-r0.999999');
    const steps = rows.get(run) ?? new Map<number, Map<string, Field[]>>();
    rows.set(run, steps);
    const seeds = steps.get(Number(m[2])) ?? new Map<string, Field[]>();
    steps.set(Number(m[2]), seeds);
    const fields = seeds.get(name) ?? [];
    seeds.set(name, fields);
    fields.push({
      tubes: Number(m[3]),
      sum: Number(m[4]),
      error: Number(m[5]),
      top: m[6] === undefined ? NaN : Math.max(Math.abs(Number(m[6])), Math.abs(Number(m[7]))),
      fed: m[8] === undefined ? NaN : Number(m[8]),
    });
  }
  for (const [run, steps] of [...rows].sort(([a], [b]) => (a < b ? -1 : 1))) {
    console.log(`== ${run}`);
    for (const [step, seeds] of [...steps].sort(([a], [b]) => a - b)) {
      const all = [...seeds.values()];
      const per = (key: keyof Field, of: (v: number[]) => number) => all.map((fields) => of(fields.map((f) => f[key])));
      const spread = (key: keyof Field, of: (v: number[]) => number, digits: number) => {
        const v = per(key, of).filter((x) => !Number.isNaN(x));
        return v.length === 0
          ? '-'
          : `${median(v).toFixed(digits)} (${Math.min(...v).toFixed(digits)} to ${Math.max(...v).toFixed(digits)})`;
      };
      const share = per('fed', (v) => v[0] ?? NaN).map((fed, i) => fed / (all[i]?.[0]?.tubes ?? NaN));
      const shares = share.filter((x) => !Number.isNaN(x));
      console.log(
        `  step ${String(step).padStart(5)}: ${all.length} seeds | sum of the flux, local over exact ${spread('sum', median, 0)} % | error per cell, median ${spread('error', median, 0)} % | largest pressure on a tube ${spread('top', (v) => Math.max(...v), 0)} | tube cells with a flow memory above 0.5 ${shares.length === 0 ? '-' : `${(100 * median(shares)).toFixed(1)} % (${(100 * Math.min(...shares)).toFixed(1)} to ${(100 * Math.max(...shares)).toFixed(1)})`}`,
      );
    }
  }
}

/** The rows of a log without what differs from run to run: the run time `s`. */
const rowsOf = (file: string) =>
  jsonl(file)
    .filter((r) => 'step' in r)
    .map((r) => JSON.stringify({ ...r, s: undefined }));

/**
 * A rerun in folder `a` against the record in folder `b`: every log of the rerun must have a log of the same name in
 * the record, with the same number of rows and the same rows. A log of the record that the rerun does not have is
 * named, and is no fault: a rerun may hold fewer runs.
 */
function compare(a: string, b: string) {
  const [dirA, dirB] = [folderOf(a), folderOf(b)];
  const logs = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const inB = new Set(logs(dirB));
  const names = logs(dirA).sort();
  if (names.filter((f) => inB.has(f)).length === 0) fail(`no log has the same name in ${dirA} and ${dirB}`);
  let equal = 0;
  for (const name of names) {
    if (!inB.has(name)) {
      fail(`${name}: NOT IN THE RECORD ${dirB}`);
      continue;
    }
    const [rowsA, rowsB] = [rowsOf(dirA + name), rowsOf(dirB + name)];
    const n = Math.min(rowsA.length, rowsB.length);
    const first = Array.from({ length: n }, (_, i) => i).find((i) => rowsA[i] !== rowsB[i]);
    if (first !== undefined) {
      const step = (JSON.parse(rowsB[first]!) as { step: number }).step;
      fail(`${name}: DIFFERENT from the row of step ${step} on (${n} rows compared)`);
    } else if (rowsA.length !== rowsB.length) {
      fail(`${name}: ${n} rows equal, but the rerun has ${rowsA.length} rows and the record ${rowsB.length}`);
    } else {
      equal++;
      console.log(`${name}: all ${n} rows equal`);
    }
  }
  const missing = [...inB].filter((f) => !names.includes(f)).sort();
  console.log(
    `${equal} of ${names.length} logs of the rerun equal the record${missing.length > 0 ? `; the rerun does not have ${missing.length} logs of the record: ${missing.join(', ')}` : ''}`,
  );
}

/** The digests of the scenes that both files hold must be equal: the same bytes after the same steps. */
function digests(a: string, b: string) {
  const byScene = (file: string) =>
    new Map(jsonl(file).map((r) => [`${String(r.kind)} ${String(r.id)}`, JSON.stringify(r)] as const));
  const [rowsA, rowsB] = [byScene(a), byScene(b)];
  const both = [...rowsA.keys()].filter((key) => rowsB.has(key));
  const differ = both.filter((key) => rowsA.get(key) !== rowsB.get(key));
  for (const key of differ) console.log(`DIFFERENT: ${key}`);
  console.log(
    `${both.length} runs are in both files: ${both.length - differ.length} equal, ${differ.length} different (${rowsA.size} and ${rowsB.size} runs in the files)`,
  );
  if (differ.length > 0 || both.length === 0) process.exitCode = 1;
}

interface Strands {
  name: string;
  step: number;
  alive: number;
  tubes: number;
  faint: number;
  closed: number;
  marked: number;
  net: number;
  ratio?: number;
  dead?: { tubes: number; faint: number; closed: number };
  disc?: { tubes: number; net: number; faint: number; closed: number; marked: number };
}
/** The lines of strands.ts by run name without the seed, by seed, by step. */
function strandRows(files: string[]): Map<string, Map<number, Map<number, Strands>>> {
  const rows = new Map<string, Map<number, Map<number, Strands>>>();
  for (const line of files.flatMap((f) => textOf(f).split('\n'))) {
    if (!line.startsWith('{')) continue;
    const r = JSON.parse(line) as Strands;
    const m = /^(\S+)-s(\d+)$/.exec(r.name);
    if (!m) continue;
    const seeds = rows.get(m[1]!) ?? new Map<number, Map<number, Strands>>();
    rows.set(m[1]!, seeds);
    const steps = seeds.get(Number(m[2])) ?? new Map<number, Strands>();
    seeds.set(Number(m[2]), steps);
    steps.set(r.step, r);
  }
  return rows;
}
/** The samples of a settled network: those of engine-tokyo-end from step 16,000 on (ADR 0029, amendment 2026-11-14 (2)). */
const LATE = [16000, 24000, 32000, 40000, 48000];
/** The share of the route's trail above which the dead ends of the Maze count as filled again (table (a)). */
const DEAD_ENDS = 0.02;

/**
 * The tubes that the flux has left and the ground that their starvation marks (ADR 0029, decision 19). Per step, the
 * median and the range over the seeds; then the late samples of each seed.
 */
function strands(files: string[]) {
  for (const [name, seeds] of strandRows(files)) {
    console.log(`== ${name}: ${seeds.size} seeds`);
    const steps = [...new Set([...seeds.values()].flatMap((s) => [...s.keys()]))].sort((a, b) => a - b);
    const maze = [...seeds.values()].some((s) => [...s.values()].some((r) => r.ratio !== undefined));
    for (const step of steps) {
      const d = [...seeds.values()].map((s) => s.get(step)).filter((x) => x !== undefined);
      const of = (f: (r: Strands) => number, digits = 0) => range(d.map(f), digits);
      console.log(
        `  step ${String(step).padStart(6)} (${String(d.length).padStart(2)} seeds): faint tubes ${of((r) => r.faint)} of ${of((r) => r.tubes)} | closed ground ${of((r) => r.closed)} | marked ${of((r) => r.marked)} | alive ${of((r) => r.alive)}${
          maze
            ? ` | dead ends over route ${of((r) => r.ratio ?? NaN, 4)} | tubes in the dead ends ${of((r) => r.dead?.tubes ?? NaN)}`
            : ` | network cells ${of((r) => r.net)}`
        }`,
      );
    }
    const late = [...seeds.values()].flatMap((s) => [...s.values()].filter((r) => LATE.includes(r.step)));
    if (late.length < 2) continue;
    const stat = (f: (r: Strands) => number, digits = 0) => {
      const v = late.map(f);
      return `${mean(v).toFixed(digits)} ± ${deviation(v).toFixed(digits)}`;
    };
    console.log(
      `   steps ${LATE.join(', ')}: ${late.length} samples | faint tubes ${stat((r) => r.faint)}, ${stat((r) => (100 * r.faint) / r.tubes, 1)} % of the tubes | closed ground ${stat((r) => r.closed)} | marked ${stat((r) => r.marked)} | alive ${stat((r) => r.alive)}`,
    );
    if (maze) {
      // The dead ends fill again: a sample from step 5,000 on, after the dead ends emptied, above 2 % of the route.
      const filled = [...seeds.entries()].map(([seed, s]) => ({
        seed,
        steps: [...s.values()].filter((r) => r.step >= 5000 && (r.ratio ?? 0) > DEAD_ENDS).map((r) => r.step),
        most: Math.max(...[...s.values()].filter((r) => r.step >= 5000).map((r) => r.ratio ?? 0)),
      }));
      const again = filled.filter((f) => f.steps.length > 0);
      console.log(
        `   dead ends above ${100 * DEAD_ENDS} % of the route at a sample from step 5000 on: ${again.length} of ${filled.length} seeds${
          again.length > 0 ? ` (${again.map((f) => `seed ${f.seed} from step ${f.steps[0]}`).join(', ')})` : ''
        }; the most of a seed ${range(
          filled.map((f) => f.most),
          4,
        )}`,
      );
      // The dead ends fill again while the network thins: a sample above 10 % of the route after one below it.
      const refill = [...seeds.entries()].flatMap(([seed, s]) => {
        const rows = [...s.values()].sort((a, b) => a.step - b.step);
        const below = rows.findIndex((r) => (r.ratio ?? 1) < 0.1);
        const above = below < 0 ? undefined : rows.slice(below).find((r) => (r.ratio ?? 0) > 0.1);
        return above ? [`seed ${seed} at step ${above.step}`] : [];
      });
      console.log(
        `   dead ends above 10 % of the route again after they were below it: ${refill.length} of ${seeds.size} seeds${
          refill.length > 0 ? ` (${refill.join(', ')})` : ''
        }`,
      );
    }
  }
}

/**
 * The runs that take a part of the colony off at step 24,000 (ADR 0029, decision 19): per run without the seed, the
 * first measured step from the step `from` on at which all 33 and all 36 food sources are joined (24,001: right after
 * the network of a disc was taken off; 27,000: when the foods that were taken away are painted again), and the cells
 * of the network and of the tubes in the disc over those of step 24,000, per step.
 */
function regrowth(lines: string, strandFile: string, from: number) {
  const joined = tokyoRows([lines]);
  const discs = strandRows([strandFile]);
  for (const [name, seeds] of joined) {
    console.log(`== ${name}: ${seeds.size} seeds`);
    for (const count of [33, 36] as const) {
      const all = (r: TokyoRow) => (count === 33 ? r.j33 === 33 : r.j36 === 36);
      const v = [...seeds.values()].map((s) => {
        const again = [...s.entries()]
          .filter(([step]) => step >= from)
          .sort(([a], [b]) => a - b)
          .find(([, r]) => all(r));
        return again?.[0] ?? NaN;
      });
      const at = [...seeds.values()].filter((s) => {
        const r = s.get(from);
        return r !== undefined && all(r);
      }).length;
      const never = v.filter((x) => Number.isNaN(x)).length;
      console.log(
        `  all ${count} joined: at step ${from} in ${at} of ${seeds.size} seeds; from then on first at step ${range(v, 0)}${never > 0 ? `, never by step 48000 in ${never}` : ''}`,
      );
    }
    const disc = discs.get(name);
    if (!disc) continue;
    const steps = [...new Set([...disc.values()].flatMap((s) => [...s.keys()]))].sort((a, b) => a - b);
    for (const step of steps.filter((t) => t >= 24000)) {
      const ratio = (f: (r: Strands) => number) =>
        [...disc.values()].map((s) => {
          const [now, before] = [s.get(step), s.get(24000)];
          return now && before ? f(now) / f(before) : NaN;
        });
      const d = [...disc.values()].map((s) => s.get(step)).filter((x) => x !== undefined);
      console.log(
        `  step ${String(step).padStart(6)}: in the disc, network cells over step 24000 ${range(ratio((r) => r.disc?.net ?? NaN))}, tubes ${range(
          ratio((r) => r.disc?.tubes ?? NaN),
        )}, closed ground ${range(
          d.map((r) => r.disc?.closed ?? NaN),
          0,
        )}, marked ${range(
          d.map((r) => r.disc?.marked ?? NaN),
          0,
        )} | all 33 joined in ${[...seeds.values()].filter((s) => s.get(step)?.j33 === 33).length} of ${seeds.size}`,
      );
    }
  }
}

/** The arguments of each table: how many it needs at least, and what they are. */
const USAGE: Record<string, [least: number, what: string]> = {
  'maze-campaign': [2, '<folder> <prefix>...'],
  'tokyo-campaign': [2, '<folder> <prefix>...'],
  'engine-maze': [1, '<file>...'],
  'engine-mazes': [1, '<file>...'],
  'engine-tokyo': [1, '<file>...'],
  'engine-tokyo-end': [1, '<file>...'],
  compare: [2, '<folder of the rerun> <folder of the record>'],
  digests: [2, '<file> <file>'],
  'exact-flux': [1, '<file>...'],
  strands: [1, '<file>...'],
  regrowth: [
    2,
    '<lines of measure-tokyo.ts> <lines of strands.ts> [the step from which a food counts as joined again]',
  ],
};
const usage = USAGE[table];
if (!usage) {
  console.error(`Tables: ${Object.keys(USAGE).join(', ')}`);
  process.exit(1);
}
if (rest.length < usage[0]) {
  console.error(`Usage: summary.ts ${table} ${usage[1]}`);
  process.exit(1);
}
if (table === 'maze-campaign') mazeCampaign(rest[0] ?? '', rest.slice(1));
else if (table === 'tokyo-campaign') tokyoCampaign(rest[0] ?? '', rest.slice(1));
else if (table === 'engine-maze') engineMaze(rest);
else if (table === 'engine-mazes') engineMazes(rest);
else if (table === 'engine-tokyo') engineTokyo(rest);
else if (table === 'engine-tokyo-end') engineTokyoEnd(rest);
else if (table === 'compare') compare(rest[0] ?? '', rest[1] ?? '');
else if (table === 'exact-flux') exactFlux(rest);
else if (table === 'strands') strands(rest);
else if (table === 'regrowth') regrowth(rest[0] ?? '', rest[1] ?? '', Number(rest[2] ?? 24001));
else digests(rest[0] ?? '', rest[1] ?? '');
