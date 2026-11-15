// The table of ADR 0047 from the logs of electrotaxis.gpu.test.ts: where the agents of the scene Electrotaxis go,
// over the seeds of each run (README.md).
// Usage: node --import ./research/flow/register.mjs research/electrode/tables.ts [folder of the logs]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A sample of electrotaxis.gpu.test.ts: the agents of one seed at one step. */
export interface Sample {
  kind: string;
  seed: number;
  step: number;
  alive: number;
  /** The mean x of the agents, cells. */
  x: number;
  cathodeX: number;
  anodeX: number;
  /** Agents within 12 cells of the middle of a cathode, and of an anode. */
  atCathode: number;
  atAnode: number;
}

/** The runs of the record, in the order of the table: the file of each and what it is. */
export const RUNS = [
  ['app-webgpu', 'the scene, WebGPU'],
  ['app-webgl2', 'the scene, WebGL2'],
  ['settled-webgpu', 'the field settled for 400 steps first, WebGPU'],
  ['settled-webgl2', 'the field settled for 400 steps first, WebGL2'],
  ['swap-webgpu', 'the poles swapped'],
  ['off-webgpu', 'Electrode strength 0'],
  ['d0.1-webgpu', 'decay 0.1'],
  ['d0.03-webgpu', 'decay 0.03'],
  ['d0.003-webgpu', 'decay 0.003'],
  ['window3-webgpu', 'Mean window 3'],
] as const;

/** Cells: a colony whose mean x came this much nearer to the cathodes has moved toward them. */
export const MOVED = 10;
/** The step of the last picture of Fig. 11 of the paper, and the last step of a run. */
export const STEPS = [450, 800] as const;

export const samplesOf = (folder: string, label: string): Sample[] =>
  readFileSync(join(folder, `${label}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Sample);

/** One seed of a run: how far its mean x went toward the cathodes at each step, in cells (below 0: away). */
export interface Run {
  seed: number;
  /** The way toward the cathodes at each sample, by step. */
  toward: Map<number, number>;
  /** The largest way back toward the anodes between two samples, cells. */
  back: number;
  /** Agents at a cathode and at an anode at the last sample. */
  atCathode: number;
  atAnode: number;
  alive: number;
}

export function runsOf(samples: Sample[]): Run[] {
  const seeds = [...new Set(samples.map((s) => s.seed))].sort((a, b) => a - b);
  return seeds.map((seed) => {
    const list = samples.filter((s) => s.seed === seed).sort((a, b) => a.step - b.step);
    const first = list[0];
    const last = list.at(-1);
    if (!first || !last) throw new Error('a run without samples');
    // +1 if the cathodes lie at a larger x than the anodes.
    const sign = Math.sign(first.cathodeX - first.anodeX);
    const way = (s: Sample) => sign * (s.x - first.x);
    let back = 0;
    list.forEach((s, i) => {
      const before = list[i - 1];
      if (before) back = Math.max(back, way(before) - way(s));
    });
    return {
      seed,
      toward: new Map(list.map((s) => [s.step, way(s)])),
      back,
      atCathode: last.atCathode,
      atAnode: last.atAnode,
      alive: last.alive,
    };
  });
}

const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
const span = (list: number[], digits = 1) =>
  `${Math.min(...list).toFixed(digits)} to ${Math.max(...list).toFixed(digits)}`;

/**
 * The table: per run the seeds, and at each step of STEPS the seeds whose colony moved toward the cathodes (MOVED) and
 * the least and the most way; then the agents at a cathode at the end, and the largest way back between two samples.
 */
export function table(folder: string): string[] {
  const lines = [
    '| Run | Seeds | Toward the cathodes at 450 | Way at 450, cells | Toward at 800 | Way at 800, cells | At a cathode at 800 | Largest way back |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const [label, name] of RUNS) {
    const runs = runsOf(samplesOf(folder, label));
    const cells = STEPS.flatMap((step) => {
      const ways = runs.map((r) => r.toward.get(step) ?? 0);
      return [`${String(ways.filter((w) => w > MOVED).length)} of ${String(runs.length)}`, span(ways)];
    });
    const at = runs.map((r) => r.atCathode);
    lines.push(
      `| ${name} | ${String(runs.length)} | ${cells.join(' | ')} | ${String(Math.min(...at))} to ${String(Math.max(...at))} (mean ${mean(at).toFixed(0)}) | ${Math.max(...runs.map((r) => r.back)).toFixed(2)} |`,
    );
  }
  return lines;
}

// Only when Node runs this file as a script, and not when a test loads it.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2] ?? fileURLToPath(new URL('./logs', import.meta.url));
  console.log(table(folder).join('\n'));
}
