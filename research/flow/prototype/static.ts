// The flux between the two foods of the Maze on a network that the agent model made, without adaptation: how many
// iterations each solver needs, and how the flux differs between the route and the dead ends (ADR 0029, "The pressure
// on a fixed network"). The network is the trail of the Maze at step 1,000 of seed 1.
// Usage: node --import ./research/flow/register.mjs research/flow/prototype/static.ts [plain=400000]
import { readFileSync, writeFileSync } from 'node:fs';
import { defaultFlow, Flow } from './flow.ts';
import { Jones, mazeParams } from './jones.ts';
import { mazeWorld, zones } from './maze.ts';
import { outDir } from './out.ts';
import { centreCell, picture, writePng } from './world.ts';

const OUT = outDir();
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const world = mazeWorld();
const z = zones(world);
const n = world.w * world.h;
const cache = `${OUT}trail-s1-1000.f32`;
let trail: Float32Array;
// The read itself says if the network is there: a check before the read could be true for another state of the disk.
try {
  trail = new Float32Array(readFileSync(cache).buffer.slice(0));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  // No network yet: make it, and keep it for the next call and for static-ma.ts.
  const sim = new Jones(world, mazeParams(1), 0.12);
  for (let s = 0; s < 1000; s++) sim.advance();
  trail = sim.trail;
  writeFileSync(cache, Buffer.from(trail.buffer));
}
const [src, snk] = [centreCell(world, 0), centreCell(world, 1)];
const zoneStats = (Q: Float32Array) => {
  // Mean flux on tube cells (trail above 2) of the route's corridor and of the dead ends.
  let [qPath, cellsPath, qDead, cellsDead, top] = [0, 0, 0, 0, 0];
  for (let c = 0; c < n; c++) {
    if (trail[c]! < 2) continue;
    top = Math.max(top, Q[c]!);
    if (z.path[c]) {
      qPath += Q[c]!;
      cellsPath++;
    } else if (z.dead[c]) {
      qDead += Q[c]!;
      cellsDead++;
    }
  }
  const [perPath, perDead] = [qPath / cellsPath, qDead / cellsDead];
  return { tubePath: cellsPath, tubeDead: cellsDead, qPath: perPath, qDead: perDead, ratio: perPath / perDead, top };
};
// Exact: conjugate gradients with the two preconditioners.
const exact = new Flow(world, { ...defaultFlow(), solver: 'exact', tolerance: 1e-8 });
let t0 = performance.now();
exact.advance(trail, src, snk, false);
console.log(
  JSON.stringify({
    solver: 'exact',
    preconditioner: 'mic',
    unknowns: exact.unknowns,
    ms: Math.round(performance.now() - t0),
    stats: exact.stats,
    ...zoneStats(exact.Q),
  }),
);
const diagonal = new Flow(world, { ...defaultFlow(), solver: 'exact', tolerance: 1e-8, preconditioner: 'jacobi' });
t0 = performance.now();
diagonal.advance(trail, src, snk, false);
console.log(
  JSON.stringify({
    solver: 'exact',
    preconditioner: 'jacobi',
    ms: Math.round(performance.now() - t0),
    stats: diagonal.stats,
  }),
);
writePng(`${OUT}static-Q-exact.png`, world.w, world.h, picture(world, exact.Q, 0.5, [120, 220, 255]), 2);
writePng(`${OUT}static-trail.png`, world.w, world.h, picture(world, trail, 12), 2);
const Qe = exact.Q;
let norm = 0;
for (let c = 0; c < n; c++) norm += Qe[c]!;
/** The error of a flux field: the sum of the absolute differences to the exact flux over the sum of the exact flux. */
const err = (Q: Float32Array) => {
  let e = 0;
  for (let c = 0; c < n; c++) e += Math.abs(Q[c]! - Qe[c]!);
  return e / norm;
};
// Local ('lag'): iterations from a cold start until the flux field is within 20 %, 5 % and 1 % of the exact one.
for (const radius of [0.9999, 0.99999, 0.999999]) {
  for (const weight of [0.9]) {
    const lag = new Flow(world, { ...defaultFlow(), solver: 'lag', iterations: 10, radius, weight });
    const hit: Record<string, number> = {};
    let e = 1;
    let it = 0;
    t0 = performance.now();
    for (; it < 60000 && !hit['1%']; it += 10) {
      lag.advance(trail, src, snk, false);
      e = err(lag.Q);
      for (const [name, level] of [
        ['20%', 0.2],
        ['5%', 0.05],
        ['1%', 0.01],
      ] as const)
        if (!hit[name] && e < level) hit[name] = it + 10;
    }
    console.log(
      JSON.stringify({
        solver: 'lag',
        radius,
        weight,
        hit,
        err: e,
        its: it,
        ms: Math.round(performance.now() - t0),
        stats: lag.stats,
      }),
    );
  }
}
// Plain damped Jacobi (no acceleration): radius 0 gives omega 1.
{
  const lag = new Flow(world, { ...defaultFlow(), solver: 'lag', iterations: 100, radius: 0, weight: 0.9 });
  const hit: Record<string, number> = {};
  let e = 1;
  let it = 0;
  const most = Number(args.plain ?? 400000);
  for (; it < most && !hit['5%']; it += 100) {
    lag.advance(trail, src, snk, false);
    e = err(lag.Q);
    for (const [name, level] of [
      ['20%', 0.2],
      ['5%', 0.05],
    ] as const)
      if (!hit[name] && e < level) hit[name] = it + 100;
  }
  console.log(JSON.stringify({ solver: 'jacobi', hit, err: e, its: it, stats: lag.stats }));
}
