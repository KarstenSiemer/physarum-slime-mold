// The time of one step of the still sheet (still.ts) with 4 and with 8 edges of the flow (ADR 0081, part E2k): k = 2,
// seed 1, the app's solver (16 iterations). Each form first runs 300 steps; then blocks of 500 steps in turns, 4 and
// 8, `rounds` times; the median of the blocks in ms per step. On the CPU, one thread; run it on a quiet machine. Usage:
//   node --import ./research/flow/register.mjs research/front/stencil-time.ts [rounds=5]
import { stillSheet, stillSim } from './still';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const rounds = Number(args.rounds ?? 5);
const sheet = stillSheet();
const sims = [4, 8].map((stencil) =>
  stillSim(sheet, { seed: 1, k: 2, base: 0.02, shareOn: 'equal', noise: 0.01, fluxOn: 'sum', stencil }),
);
for (const sim of sims) for (let k = 0; k < 300; k++) sim.flowStep();
const times: number[][] = [[], []];
for (let r = 0; r < rounds; r++)
  sims.forEach((sim, i) => {
    const t0 = performance.now();
    for (let k = 0; k < 500; k++) sim.flowStep();
    times[i]!.push((performance.now() - t0) / 500);
  });
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const [four, eight] = times.map(median) as [number, number];
console.log(
  `ms per step: 4 edges ${four.toFixed(2)}, 8 edges ${eight.toFixed(2)}, ratio ${(eight / four).toFixed(2)} (${String(rounds)} rounds of 500 steps)`,
);
