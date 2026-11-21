// The tables of part E4 (ADR 0088) from the records of e4-reid.gpu.test.ts, and the montages of its pictures.
// Usage: node --import ./research/flow/register.mjs research/front/e4.ts out=research/front/out/e4
//        node --import ./research/flow/register.mjs research/front/e4.ts montage=research/front/out/e4/pics/webgpu/pics
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mannWhitney, yRow } from './tables';
import type { YRun } from './ymaze';

interface Row {
  step: number;
  alive: number;
  territory: number;
  sinks: number;
  plasm: number;
  base?: { plasm: number; territory: number };
  left?: { plasm: number; territory: number };
  right?: { plasm: number; territory: number };
}

interface Run {
  kind: string;
  case: string;
  seed: number;
  slimed: ('left' | 'right')[];
  chosen: YRun['chosen'];
  first: number | null;
  other: number;
  agents: number;
  touched: { middle: number[]; step: number | null }[];
  half: number;
  step: number;
  rows: Row[];
  reach: ({ step: number } & Record<string, number[]>)[];
  ms: number;
}

const read = (file: string): Run[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Run)
    : [];

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const spread = (v: number[], digits = 0) =>
  `${mean(v).toFixed(digits)} (${Math.min(...v).toFixed(digits)} to ${Math.max(...v).toFixed(digits)})`;

/** The comparison of the backends: per case and step, the means of the two backends, their ratio and Mann-Whitney's p. */
function backends(dir: string) {
  const cases = ['one', 'both', 'none', 'dish'];
  for (const c of cases) {
    const [gpu, gl] = [read(join(dir, 'webgpu', `${c}.jsonl`)), read(join(dir, 'webgl2', `${c}.jsonl`))];
    if (gpu.length === 0 || gl.length === 0) continue;
    const steps = gpu[0]!.rows.map((r) => r.step).filter((s) => s > 0);
    for (const step of steps) {
      const at = (runs: Run[], f: (r: Row) => number) => runs.map((run) => f(run.rows.find((r) => r.step === step)!));
      const measures: [string, (r: Row) => number][] = [
        ['alive', (r) => r.alive],
        ['territory', (r) => r.territory],
        ['sinks', (r) => r.sinks],
      ];
      if (c !== 'dish') measures.push(['arms', (r) => (r.left?.territory ?? 0) + (r.right?.territory ?? 0)]);
      const cells = measures.map(([name, f]) => {
        const [a, b] = [at(gpu, f), at(gl, f)];
        return `${name} ${spread(a)} | ${spread(b)}: ${(mean(b) / mean(a)).toFixed(2)}, p ${mannWhitney(a, b).toPrecision(2)}`;
      });
      console.log(`${c.padEnd(5)} step ${String(step).padStart(5)}  ${cells.join('; ')}`);
    }
  }
}

/** The Y-maze of each backend: the choice, its binomial p, the first food, and both arms against none. */
function ymaze(dir: string) {
  for (const kind of ['webgpu', 'webgl2']) {
    const runs = Object.fromEntries(['one', 'both', 'none'].map((c) => [c, read(join(dir, kind, `${c}.jsonl`))]));
    const firsts = (rs: Run[]) => rs.map((r) => r.first).filter((v): v is number => v !== null);
    for (const [c, rs] of Object.entries(runs)) {
      if (rs.length === 0) continue;
      const row = yRow(c, rs as unknown as YRun[]);
      let against = '';
      if (c !== 'none' && runs.none && runs.none.length > 0) {
        const base = firsts(runs.none);
        against = `  ${(row.first / median(base)).toFixed(2)} times none (p ${mannWhitney(firsts(rs), base).toPrecision(2)})`;
      }
      const f = firsts(rs);
      console.log(
        `${kind} ${c.padEnd(5)} ${String(rs.length).padStart(3)} runs  ${String(row.a)} : ${String(row.b)}` +
          `${row.splits ? ` (+${String(row.splits)} split)` : ''}  p ${row.p.toPrecision(2)}  first ${String(row.first)}` +
          ` (${String(Math.min(...f))} to ${String(Math.max(...f))})  other +${String(row.other)}${against}`,
      );
    }
  }
}

/** The dish: the steps to the glucose with and without slime, and half of the open dish. */
function dish(dir: string) {
  for (const kind of ['webgpu', 'webgl2']) {
    const glucose = (c: string) =>
      read(join(dir, kind, `${c}.jsonl`))
        .map((r) => r.first)
        .filter((v): v is number => v !== null);
    const [slime, blank] = [glucose('dish'), glucose('dish-blank')];
    if (slime.length > 0 && blank.length > 0)
      console.log(
        `${kind} glucose with slime ${String(median(slime))} (${String(Math.min(...slime))} to ${String(Math.max(...slime))}),` +
          ` without ${String(median(blank))} (${String(Math.min(...blank))} to ${String(Math.max(...blank))}):` +
          ` ${(median(slime) / median(blank)).toFixed(2)} times, p ${mannWhitney(slime, blank).toPrecision(2)}`,
      );
    const open = read(join(dir, kind, 'open.jsonl')).map((r) => r.half);
    const reached = open.filter((v) => v >= 0);
    if (open.length > 0)
      console.log(
        `${kind} open dish, half covered: ${String(median(reached))} (${String(Math.min(...reached))} to ` +
          `${String(Math.max(...reached))}), ${String(reached.length)} of ${String(open.length)} reach it`,
      );
  }
}

/** The study of the reach: per case, part and step, the share of the sinks with ground without slime within k steps. */
function reach(dir: string) {
  for (const file of readdirSync(join(dir, 'webgpu')).filter((f) => f.endsWith('.jsonl'))) {
    const runs = read(join(dir, 'webgpu', file));
    const steps = [...new Set(runs.flatMap((r) => r.reach.map((x) => x.step)))];
    for (const step of steps) {
      const parts = Object.keys(runs[0]!.reach.find((x) => x.step === step) ?? {}).filter((k) => k !== 'step');
      for (const part of parts) {
        const sum = new Array<number>(8).fill(0);
        for (const run of runs)
          (run.reach.find((x) => x.step === step)?.[part] ?? []).forEach((v, k) => (sum[k]! += v));
        const n = sum.reduce((a, b) => a + b, 0);
        if (n === 0) continue;
        let cum = 0;
        const shares = sum.slice(0, 7).map((v) => ((cum += v), (cum / n).toFixed(2)));
        console.log(
          `${file.replace('.jsonl', '').padEnd(5)} step ${String(step)} ${part.padEnd(6)} ${String(n).padStart(5)} sinks:` +
            ` fresh within 0..6 steps ${shares.join(' ')}`,
        );
      }
    }
  }
}

/** The pictures as JPG montages for the ADR: the three cases of the Y-maze at the first food, and the dish. */
function montage(dir: string) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.png.b64'));
  mkdirSync(join(dir, 'png'), { recursive: true });
  for (const f of files)
    writeFileSync(join(dir, 'png', f.replace('.b64', '')), Buffer.from(readFileSync(join(dir, f), 'utf8'), 'base64'));
  const pick = (c: string) => readdirSync(join(dir, 'png')).find((f) => f.startsWith(`${c}-s1-`));
  const ff = (inputs: string[], filter: string, out: string) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-y', ...inputs.flatMap((i) => ['-i', join(dir, 'png', i)])];
    const run = spawnSync('ffmpeg', [...args, '-filter_complex', filter, '-frames:v', '1', '-q:v', '4', out], {
      encoding: 'utf8',
    });
    console.log(out, run.status, run.stderr.trim());
  };
  const y = ['one', 'both', 'none'].map(pick).filter((f): f is string => f !== undefined);
  if (y.length === 3)
    ff(
      y,
      '[0]scale=480:-1,pad=iw+8:ih+8:4:4:color=0x101014[a];[1]scale=480:-1,pad=iw+8:ih+8:4:4:color=0x101014[b];' +
        '[2]scale=480:-1,pad=iw+8:ih+8:4:4:color=0x101014[c];[a][b][c]hstack=inputs=3',
      'docs/images/reid-y-maze.jpg',
    );
  const d = ['dish', 'dish-blank'].map(pick).filter((f): f is string => f !== undefined);
  if (d.length === 2)
    ff(
      d,
      '[0]scale=480:-1,pad=iw+8:ih+8:4:4:color=0x101014[a];[1]scale=480:-1,pad=iw+8:ih+8:4:4:color=0x101014[b];' +
        '[a][b]hstack=inputs=2',
      'docs/images/reid-dish.jpg',
    );
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
if (args.montage) montage(args.montage);
if (args.out) {
  const out = args.out;
  console.log('== the backends, seeds 1 to 6: WebGPU | WebGL2, WebGL2 / WebGPU');
  backends(join(out, 'backends'));
  console.log('== the Y-maze');
  ymaze(join(out, 'y'));
  console.log('== the dish');
  dish(join(out, 'dish'));
  console.log('== the reach');
  if (existsSync(join(out, 'reach', 'webgpu'))) reach(join(out, 'reach'));
}
