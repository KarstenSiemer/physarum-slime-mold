// How well the local solver follows the exact flux while the agents move: no adaptation, uniform flow memory.
// Usage: node --import ./research/flow/register.mjs research/flow/prototype/track.ts [iterations=16] [radius=0.99999] [bodyRate=0.02] [steps=1500]
import { defaultFlow, Flow } from './flow.ts';
import { Jones, mazeParams } from './jones.ts';
import { mazeWorld } from './maze.ts';
import { centreCell } from './world.ts';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const num = (k: string, d: number) => (k in args ? Number(args[k]) : d);
const world = mazeWorld();
const n = world.w * world.h;
const sim = new Jones(world, mazeParams(1), 0.12);
for (let s = 0; s < 500; s++) sim.advance();
const common = { bodyRate: num('bodyRate', 0.02), weight: num('weight', 0.9) };
const exact = new Flow(world, { ...defaultFlow(), ...common, solver: 'exact', tolerance: 1e-6 });
const lag = new Flow(world, {
  ...defaultFlow(),
  ...common,
  solver: 'lag',
  iterations: num('iterations', 16),
  radius: num('radius', 0.99999),
});
const [src, snk] = [centreCell(world, 0), centreCell(world, 1)];
const steps = num('steps', 1500);
for (let s = 1; s <= steps; s++) {
  sim.advance();
  lag.advance(sim.trail, src, snk, false);
  if (s % 50 === 0) {
    exact.advance(sim.trail, src, snk, false);
    let [e, norm] = [0, 0];
    for (let c = 0; c < n; c++) {
      e += Math.abs(lag.Q[c]! - exact.Q[c]!);
      norm += exact.Q[c]!;
    }
    let pmax = 0;
    for (let c = 0; c < n; c++) pmax = Math.max(pmax, Math.abs(lag.p[c]!));
    console.log(
      JSON.stringify({
        s,
        err: +(e / norm).toFixed(3),
        out: +lag.stats.source.toExponential(2),
        into: +lag.stats.sink.toExponential(2),
        pmax: +pmax.toFixed(2),
      }),
    );
  } else exact.follow(sim.trail);
}
