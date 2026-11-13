// How many steps Ma's walkers need on a fixed Maze network until their current is the exact flux.
// The error is measured on the mean walker current of the last 200 steps (the sampled current of one step is noisy).
// It reads the network that static.ts wrote to research/flow/out/.
// Usage: node --import ./research/flow/register.mjs research/flow/prototype/static-ma.ts [walkers per step = 2000] [steps = 150000]
import { readFileSync } from 'node:fs';
import { defaultFlow, Flow } from './flow.ts';
import { mazeWorld } from './maze.ts';
import { outDir } from './out.ts';
import { centreCell } from './world.ts';

const OUT = outDir();
const world = mazeWorld();
const n = world.w * world.h;
const trail = new Float32Array(readFileSync(`${OUT}trail-s1-1000.f32`).buffer.slice(0));
const [src, snk] = [centreCell(world, 0), centreCell(world, 1)];
const exact = new Flow(world, { ...defaultFlow(), solver: 'exact', tolerance: 1e-8, dNew: 0.2 });
exact.advance(trail, src, snk, false);
let norm = 0;
for (let c = 0; c < n; c++) norm += exact.Q[c]!;
const walkers = Number(process.argv[2] ?? 2000);
const ma = new Flow(world, { ...defaultFlow(), solver: 'ma', walkers, dt: 0.8, dNew: 0.2 });
const mean = new Float64Array(n);
const total = Number(process.argv[3] ?? 150000);
const t0 = performance.now();
for (let s = 1; s <= total; s++) {
  ma.advance(trail, src, snk, false);
  if (s % 5000 > 4800 || s % 5000 === 0) for (let c = 0; c < n; c++) mean[c]! += ma.Q[c]! / 200;
  if (s % 5000 === 0) {
    let e = 0;
    for (let c = 0; c < n; c++) e += Math.abs(mean[c]! - exact.Q[c]!);
    let held = 0;
    for (let c = 0; c < n; c++) held += ma.N[c]!;
    console.log(
      JSON.stringify({
        s,
        err: +(e / norm).toFixed(3),
        arrive: +(ma.stats.sink / walkers).toFixed(3),
        held: Math.round(held),
        min: Math.round((performance.now() - t0) / 60000),
      }),
    );
    mean.fill(0);
  }
}
