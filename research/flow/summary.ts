// The tables of ADR 0029 from the logs of the runs: medians and ranges over the seeds.
// Usage: node --import ./research/flow/register.mjs research/flow/summary.ts <table> ...
//
// - maze-campaign <folder> <prefix>...   the logs <prefix>-s<seed>.jsonl of run-maze.ts or run-maze-sites.ts
// - tokyo-campaign <folder> <prefix>...  the logs <prefix>-s<seed>.jsonl of run-tokyo.ts, one line per measured step
// - engine-maze <file>...                the lines of engine/measure-maze.ts
// - engine-tokyo <file>...               the lines of engine/measure-tokyo.ts, per step
// - engine-tokyo-end <file>...           the same lines: the samples with all food sources joined, mean and deviation
// - compare <folder> <folder>            the logs of the same name in two folders, row by row: a rerun against the record
// - digests <file> <file>                the lines of engine/digest.gpu.test.ts of two checkouts, scene by scene
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

interface TokyoRow {
  alive: number;
  j33: number;
  links: number;
  tl: number;
  md: number;
  ft: number;
  j36: number;
  ms: number;
}
/** The lines of measure-tokyo.ts: by run name without the seed, by seed, by step. */
function tokyoRows(files: string[]): Map<string, Map<number, Map<number, TokyoRow>>> {
  const rows = new Map<string, Map<number, Map<number, TokyoRow>>>();
  const pattern =
    /^(\S+)-s(\d+)\s+(\d+) alive\s+(\d+) \| 33: (\d+) joined (\d+) links TL (\S+) MD (\S+) FT (\S+) \| 36: (\d+) joined TL (\S+) MD (\S+) FT (\S+) \| sea (\d+) \| (\S+) ms/;
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
        )}`,
      );
    }
  }
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
        }`,
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

/** The arguments of each table: how many it needs at least, and what they are. */
const USAGE: Record<string, [least: number, what: string]> = {
  'maze-campaign': [2, '<folder> <prefix>...'],
  'tokyo-campaign': [2, '<folder> <prefix>...'],
  'engine-maze': [1, '<file>...'],
  'engine-tokyo': [1, '<file>...'],
  'engine-tokyo-end': [1, '<file>...'],
  compare: [2, '<folder of the rerun> <folder of the record>'],
  digests: [2, '<file> <file>'],
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
else if (table === 'engine-tokyo') engineTokyo(rest);
else if (table === 'engine-tokyo-end') engineTokyoEnd(rest);
else if (table === 'compare') compare(rest[0] ?? '', rest[1] ?? '');
else digests(rest[0] ?? '', rest[1] ?? '');
