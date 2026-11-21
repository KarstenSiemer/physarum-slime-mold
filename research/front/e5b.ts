// Part E5b of stage 4 (ADR 0087): the records of the scene Crown of veins in the engine (e5b-crown.gpu.test.ts), in
// the form of the records of the prototype, so that the measures of the crown (e2n.ts, e2l.ts) read them; and the
// tables of the comparison. The engine counts the step that places the colony as its first step, so its step k + 1
// is the prototype's step k: the files of the states are named by k, the steps after that placing step. Usage:
//   node --import ./research/flow/register.mjs research/front/e5b.ts records=research/front/out/e5b/c1
//   node --import ./research/flow/register.mjs research/front/e5b.ts backends=research/front/out/e5b/backends
//   node --import ./research/flow/register.mjs research/front/e5b.ts growth=research/front/out/e5b/c1 \
//     proto=<the archive>/logs/engine/crown-0084/c1/none/runs.jsonl
//   node --import ./research/flow/register.mjs research/front/e5b.ts neck=research/front/out/e5b/neck
// `records` writes, for every case folder (a backend) and seed, `s<seed>.jsonl` (the rows of crownProfile() at the
// saved steps, and the `norm` of the case `none`, 4) and `s<seed>-sinks.jsonl` (the sinks at those steps).
// `backends` prints the live agents, the reach, the territory and the sinks per backend and step: the mean, the least
// and the most over the seeds. `growth` prints the live agents and the reach of every 1,000 steps beside the
// prototype's. `neck` prints per run the first record at which the colony is out of the neck: its territory, an agent
// (a row below the neck), and its tube body (a cell farther from the food than NECK_FAR, the farthest cell of the neck).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readState } from './crowns';
import { crownProfile } from './measure';

/** A record of the engine (e5b-crown.gpu.test.ts): k is the step of the engine, one more than the prototype's. */
interface EngineRow {
  kind: string;
  seed: number;
  k: number;
  alive: number;
  reach: number;
  territory: number;
  sinks: number;
  /** The rows below the neck that the agents and the territory reach (0 in the neck); not in the first records. */
  below?: number;
  ground?: number;
  ms: number;
}

/**
 * The farthest cell of the neck from the middle of the food, (260, 8): the corner cell (253, 39) or (266, 39), whose
 * centre lies √(6.5² + 31.5²) = 32.16 cells away. A tube body farther away lies below the neck.
 */
export const NECK_FAR = Math.hypot(6.5, 31.5);

const rowsOf = (file: string): EngineRow[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EngineRow);

const folders = (root: string) =>
  readdirSync(root)
    .filter((f) => statSync(join(root, f)).isDirectory())
    .sort();

const seedsOf = (dir: string) =>
  readdirSync(dir)
    .filter((f) => /^s\d+\.rows\.jsonl$/.test(f))
    .map((f) => Number(f.slice(1, -11)))
    .sort((a, b) => a - b);

function records(root: string) {
  for (const kind of folders(root)) {
    const dir = join(root, kind);
    for (const seed of seedsOf(dir)) {
      const engine = rowsOf(join(dir, `s${String(seed)}.rows.jsonl`));
      const states = join(dir, `s${String(seed)}-state`);
      const steps = existsSync(states)
        ? readdirSync(states)
            .filter((f) => f.endsWith('.bin.gz'))
            .map((f) => Number(f.slice(f.indexOf('-') + 1, -7)))
            .sort((a, b) => a - b)
        : [];
      const rows = steps.map((k) => {
        const f = readState(join(states, `s${String(seed)}-${String(k)}.bin.gz`));
        return { k, alive: f.occ.reduce((a, b) => a + b, 0), ...crownProfile(f) };
      });
      const record = { seed, kind, front: { norm: 4 }, rows };
      writeFileSync(join(dir, `s${String(seed)}.jsonl`), JSON.stringify(record) + '\n');
      const sinks = steps.map((k) => {
        const row = engine.find((r) => r.k === k + 1);
        return JSON.stringify({ seed, k, sinks: row?.sinks ?? NaN }) + '\n';
      });
      writeFileSync(join(dir, `s${String(seed)}-sinks.jsonl`), sinks.join(''));
      console.log(`${kind} s${String(seed)}: ${String(rows.length)} states`);
    }
  }
}

const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '-');

function backends(root: string) {
  const all = folders(root).flatMap((kind) =>
    seedsOf(join(root, kind)).flatMap((seed) => rowsOf(join(root, kind, `s${String(seed)}.rows.jsonl`))),
  );
  const steps = [...new Set(all.map((r) => r.k))].sort((a, b) => a - b);
  const keys = ['alive', 'reach', 'territory', 'sinks'] as const;
  for (const k of steps) {
    const line = [`step ${String(k - 1)}`];
    const means: Record<string, Record<string, number>> = {};
    for (const kind of folders(root)) {
      const rows = all.filter((r) => r.kind === kind && r.k === k);
      means[kind] = {};
      const parts = keys.map((key) => {
        const v = rows.map((r) => r[key]);
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        means[kind]![key] = mean;
        return `${key} ${fmt(mean, 1)} (${fmt(Math.min(...v), 1)} to ${fmt(Math.max(...v), 1)})`;
      });
      line.push(`${kind} n=${String(rows.length)}: ${parts.join(', ')}`);
    }
    const [a, b] = folders(root);
    if (a && b)
      line.push(
        `ratio ${b}/${a}: ${keys.map((key) => `${key} ${fmt(means[b]![key]! / means[a]![key]!, 3)}`).join(', ')}`,
      );
    console.log(line.join('\n  '));
  }
}

function growth(root: string, proto: string) {
  const them = readFileSync(proto, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { seed: number; rows: { k: number; alive: number; reach: number }[] });
  const at = (k: number) =>
    them.map((r) => r.rows.find((x) => x.k === k)).map((x) => (x ? `${String(x.alive)}/${fmt(x.reach, 1)}` : '-'));
  for (let k = 1000; k <= 16000; k += 1000) {
    const ours = folders(root).flatMap((kind) =>
      seedsOf(join(root, kind)).map((seed) => {
        const row = rowsOf(join(root, kind, `s${String(seed)}.rows.jsonl`)).find((r) => r.k === k + 1);
        return `${kind} s${String(seed)} ${row ? `${String(row.alive)}/${fmt(row.reach, 1)}` : '-'}`;
      }),
    );
    console.log(`step ${String(k).padStart(5)} prototype ${at(k).join(' ')} | ${ours.join(' | ')}`);
  }
}

function neck(root: string) {
  const first = (rows: EngineRow[], out: (r: EngineRow) => boolean) => {
    const r = rows.find(out);
    return r ? String(r.k - 1) : '-';
  };
  const lines: string[] = [];
  const steps: Record<string, number[]> = { ground: [], agent: [], body: [] };
  for (const kind of folders(root))
    for (const seed of seedsOf(join(root, kind))) {
      const rows = rowsOf(join(root, kind, `s${String(seed)}.rows.jsonl`));
      const at = {
        ground: first(rows, (r) => (r.ground ?? 0) > 0),
        agent: first(rows, (r) => (r.below ?? 0) > 0),
        body: first(rows, (r) => r.reach > NECK_FAR),
      };
      for (const [k, v] of Object.entries(at)) if (v !== '-') steps[k]!.push(Number(v));
      const end = rows.at(-1);
      lines.push(
        `${kind} s${String(seed)}: out of the neck at step ${at.ground} (territory), ${at.agent} (an agent), ${at.body} (tube body); at step ${String((end?.k ?? 1) - 1)} reach ${String(end?.reach)}, ${String(end?.below)} rows below the neck`,
      );
    }
  for (const l of lines) console.log(l);
  for (const [k, v] of Object.entries(steps))
    console.log(`${k}: ${String(v.length)} runs, steps ${String(Math.min(...v))} to ${String(Math.max(...v))}`);
}

const isMain = process.argv[1]?.endsWith('e5b.ts');
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
  if (args.records) records(args.records);
  else if (args.backends) backends(args.backends);
  else if (args.growth && args.proto) growth(args.growth, args.proto);
  else if (args.neck) neck(args.neck);
  else throw new Error('records=<folder>, backends=<folder>, growth=<folder> proto=<runs.jsonl> or neck=<folder>');
}
