// The Maze with flow: the agent model coupled to a flux field between one source and one sink (flow.ts: the exact
// solver, the local solver with fixed pressures, or Ma's walkers). Prototype code.
// Usage: node --import ./research/flow/register.mjs research/flow/prototype/run-maze.ts key=value ...   (see `opt` below)
import { appendFileSync, writeFileSync } from 'node:fs';
import { defaultFlow, Flow, type FlowParams } from './flow.ts';
import { Jones, mazeParams } from './jones.ts';
import { mazeWorld, measure, zones } from './maze.ts';
import { outDir } from './out.ts';
import { centreCell, picture, writePng } from './world.ts';

const OUT = outDir(process.env.SUB);
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const num = (k: string, d: number) => (k in args ? Number(args[k]) : d);
const opt = {
  name: args.name ?? 'run',
  seed: num('seed', 1),
  steps: num('steps', 15000),
  /** The step at which the flow starts: the network forms first, as the plasmodium fills the maze first. */
  flowFrom: num('flowFrom', 0),
  solver: (args.solver ?? 'exact') as FlowParams['solver'],
  i0: num('i0', 8),
  gamma: num('gamma', 1.8),
  rate: num('rate', 0.003),
  base: num('base', 0.02),
  every: num('every', 8),
  tolerance: num('tolerance', 1e-4),
  iterations: num('iterations', 8),
  radius: num('radius', 0.99999),
  walkers: num('walkers', 200),
  dt: num('dt', 0.8),
  dNew: num('dNew', 0.2),
  recover: num('recover', 0.00023),
  bodyRate: num('bodyRate', 0.02),
  /** Health of a tube cell: s = D^2 / (D^2 + half^2). Deposit of an agent: deposit · (lo + (hi − lo) · s). */
  lo: num('lo', 1),
  hi: num('hi', 1),
  half: num('half', 0.01),
  /** Chance that a dead agent comes to life on the empty cell it draws: birth · max(0, D − dBirth) / (1 − dBirth). */
  birth: num('birth', 0),
  dBirth: num('dBirth', 0.5),
  /** Chance per step that an agent dies where s = 0: death · (1 − s)^deathPow. */
  death: num('death', 0),
  deathPow: num('deathPow', 1),
  shrink: num('shrink', 0.0001),
  pictures: (args.pictures ?? '1000,2000,5000,10000,15000').split(',').map(Number),
};
const world = mazeWorld();
const z = zones(world);
const n = world.w * world.h;
const sim = new Jones(world, { ...mazeParams(opt.seed), shrink: opt.shrink }, 0.12);
const flow = new Flow(world, {
  ...defaultFlow(),
  solver: opt.solver,
  i0: opt.i0,
  gamma: opt.gamma,
  rate: opt.rate,
  base: opt.base,
  dNew: opt.dNew,
  recover: opt.recover,
  bodyRate: opt.bodyRate,
  every: opt.every,
  tolerance: opt.tolerance,
  iterations: opt.iterations,
  radius: opt.radius,
  walkers: opt.walkers,
  dt: opt.dt,
  seed: opt.seed,
});
const [src, snk] = [centreCell(world, 0), centreCell(world, 1)];
const scale = new Float32Array(n).fill(1);
const death = new Float32Array(n);
const birth = new Float32Array(n);
const coupled = opt.lo !== 1 || opt.hi !== 1 || opt.death > 0 || opt.birth > 0;
const log = `${OUT}${opt.name}.jsonl`;
writeFileSync(log, JSON.stringify({ opt, route: z.route }) + '\n');
const t0 = performance.now();
let solverIts = 0;
/** The first step at which the dead ends hold less than 10 % and 2 % of the trail per cell that the route holds. */
const fade: Record<string, number> = {};
for (let s = 1; s <= opt.steps; s++) {
  sim.advance();
  if (s > opt.flowFrom) {
    flow.advance(sim.trail, src, snk);
    solverIts += flow.stats.iterations;
    if (coupled) {
      for (let c = 0; c < n; c++) {
        const d2 = flow.D[c]! * flow.D[c]!;
        const sat = d2 / (d2 + opt.half * opt.half);
        scale[c] = opt.lo + (opt.hi - opt.lo) * sat;
        death[c] = opt.death * (1 - sat) ** opt.deathPow;
        birth[c] = flow.tube(c) > 0 ? (opt.birth * Math.max(0, flow.D[c]! - opt.dBirth)) / (1 - opt.dBirth) : 0;
      }
      sim.depositScale = scale;
      sim.deathChance = opt.death > 0 ? death : null;
      sim.birthChance = opt.birth > 0 ? birth : null;
    }
  }
  if (s % 250 === 0) {
    const m = measure(world, z, s, sim.aliveCount, sim.trail, sim.occ);
    for (const [name, level] of [
      ['10%', 0.1],
      ['2%', 0.02],
    ] as const)
      if (fade[name] === undefined && m.trailDead < level * m.trailPath) fade[name] = s;
    // Flow memory on the route and in the dead ends, and the share of the flux that the strongest cell row carries.
    let [dp, dd] = [0, 0];
    for (let c = 0; c < n; c++) {
      const v = flow.tube(c) * flow.D[c]!;
      if (z.path[c]) dp += v;
      else if (z.dead[c]) dd += v;
    }
    const line = {
      ...m,
      dPath: dp / z.pathCells,
      dDead: dd / z.deadCells,
      its: solverIts / 250,
      births: sim.births,
      deaths: sim.deaths,
      flow: flow.stats,
      fade,
      s: Math.round((performance.now() - t0) / 1000),
    };
    solverIts = 0;
    appendFileSync(log, JSON.stringify(line) + '\n');
  }
  if (opt.pictures.includes(s)) {
    writePng(`${OUT}${opt.name}-trail-${s}.png`, world.w, world.h, picture(world, sim.trail, 12), 2);
    if (s > opt.flowFrom) {
      const shown = new Float32Array(n);
      for (let c = 0; c < n; c++) shown[c] = flow.tube(c) * flow.D[c]!;
      writePng(`${OUT}${opt.name}-D-${s}.png`, world.w, world.h, picture(world, shown, 0.6, [255, 120, 80]), 2);
      writePng(`${OUT}${opt.name}-Q-${s}.png`, world.w, world.h, picture(world, flow.Q, 2, [120, 220, 255]), 2);
    }
  }
}
console.log(`${opt.name} done in ${Math.round((performance.now() - t0) / 1000)} s`, JSON.stringify(fade));
