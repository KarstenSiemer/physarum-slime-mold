// How much the exact flux changes from one step to the next while the agents move (no adaptation).
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
const exact = new Flow(world, {
  ...defaultFlow(),
  bodyRate: num('bodyRate', 0.02),
  bodyLow: num('bodyLow', 0.05),
  solver: 'exact',
  tolerance: 1e-7,
});
const [src, snk] = [centreCell(world, 0), centreCell(world, 1)];
const prev = new Float32Array(n);
const gPrev = new Float32Array(n);
const out: string[] = [];
for (let s = 1; s <= 60; s++) {
  sim.advance();
  exact.advance(sim.trail, src, snk, false);
  let [e, norm, dg, gs, cells] = [0, 0, 0, 0, 0];
  for (let c = 0; c < n; c++) {
    e += Math.abs(exact.Q[c]! - prev[c]!);
    norm += exact.Q[c]!;
    dg += Math.abs(exact.g[c]! - gPrev[c]!);
    gs += exact.g[c]!;
    if (exact.g[c]! > 0) cells++;
  }
  prev.set(exact.Q);
  gPrev.set(exact.g);
  if (s > 40)
    out.push(
      `dQ ${(e / norm).toFixed(4)} R ${(exact.p[src]! / 8).toFixed(1)} dg ${(dg / gs).toFixed(4)} cells ${cells} its ${exact.stats.iterations}`,
    );
}
console.log(out.join('\n'));
