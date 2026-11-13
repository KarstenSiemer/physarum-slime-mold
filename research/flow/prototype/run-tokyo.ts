// The Tokyo layout with flow: the land is full of plasmodium at the start (Tero's second protocol, and the start of
// his model), all food sources are there, and the flux runs between changing pairs of food sources. Prototype code.
// Usage: node --import ./research/flow/register.mjs research/flow/prototype/run-tokyo.ts key=value ...   (see `opt` below)
import { appendFileSync, writeFileSync } from 'node:fs';
import { defaultFlow, Flow, type FlowParams } from './flow.ts';
import { defaultMulti, FlowMulti, type Terminals } from './flow-multi.ts';
import { Jones, mazeParams, pcg } from './jones.ts';
import { outDir } from './out.ts';
import { measures, network, networkMask, tokyoWorld } from './tokyo.ts';
import { picture, writePng } from './world.ts';

const OUT = outDir(process.env.SUB);
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const num = (k: string, d: number) => (k in args ? Number(args[k]) : d);
const opt = {
  name: args.name ?? 'tokyo',
  seed: num('seed', 1),
  n: num('n', 400),
  steps: num('steps', 20000),
  flowFrom: num('flowFrom', 500),
  density: num('density', 0.12),
  solver: (args.solver ?? 'lag') as FlowParams['solver'],
  i0: num('i0', 8),
  gamma: num('gamma', 1.8),
  rate: num('rate', 0.003),
  base: num('base', 0.02),
  iterations: num('iterations', 16),
  radius: num('radius', 0.99999),
  walkers: num('walkers', 2000),
  /** Pairs of food sources that carry a flux at the same time, and the steps that a pair keeps it. */
  lanes: num('lanes', 4),
  dwell: num('dwell', 300),
  /** 'pairs': a lane holds a source and a sink. 'star': a lane holds a source, and every other food site is a sink. */
  terminals: args.terminals ?? 'labels',
  every: num('every', 8),
  half: num('half', 0.01),
  death: num('death', 0.02),
  birth: num('birth', 0.2),
  dBirth: num('dBirth', 0.5),
  fScale: num('fScale', 1),
  mode: (args.mode ?? 'current') as 'pressure' | 'current' | 'walkers',
  shrink: num('shrink', 0),
  sensorAngle: num('sa', 45),
  sensorOffset: num('so', 7),
  foodStrength: num('food', 0.03),
  pictures: (args.pictures ?? '').split(',').filter(Boolean).map(Number),
  measureEvery: num('measureEvery', 2000),
};
const t = tokyoWorld(opt.n);
const { world } = t;
const n = world.w * world.h;
const sim = new Jones(
  world,
  {
    ...mazeParams(opt.seed),
    shrink: opt.shrink,
    sensorAngle: opt.sensorAngle,
    sensorOffset: opt.sensorOffset,
    foodSource: 255 * opt.foodStrength,
  },
  opt.density,
  t.land,
);
const exact = opt.solver === 'exact';
const flowE = new Flow(world, {
  ...defaultFlow(),
  solver: opt.solver,
  i0: opt.i0,
  gamma: opt.gamma,
  rate: opt.rate,
  base: opt.base,
  walkers: opt.walkers,
  every: 1,
  tolerance: 1e-4,
  seed: opt.seed,
});
const flowM = new FlowMulti(
  world,
  {
    ...defaultMulti(),
    i0: opt.i0,
    gamma: opt.gamma,
    rate: opt.rate,
    base: opt.base,
    iterations: opt.iterations,
    radius: opt.radius,
    fScale: opt.fScale,
    mode: opt.mode,
    walkers: opt.walkers,
    seed: opt.seed,
  },
  t.land,
);
const flow = exact ? flowE : flowM;
// The terminal of a site: its centre cell.
const sites = world.sites.map((s) => Math.floor(s.y) * world.w + Math.floor(s.x));
/** The two sites of lane k at a step: they change every `dwell` steps, the lanes one after another. */
function pairOf(step: number, k: number, dwell: number, lanes: number): [number, number] {
  const epoch = Math.floor((step + Math.floor((k * dwell) / lanes)) / dwell);
  const h = pcg(epoch ^ pcg((k + 1) ^ pcg(opt.seed ^ 0x7e0)));
  const a = h % sites.length;
  const b = (a + 1 + (pcg(h) % (sites.length - 1))) % sites.length;
  return [sites[a]!, sites[b]!];
}
/**
 * 'pairs': a random source site and a random sink site. 'star': a random source site, every other site a sink.
 * 'labels': every site pushes or pulls. Sites 2j and 2j + 1 always do the opposite; which of the two pushes is drawn
 * again every `dwell` steps, but not for the first two sites (so two sites alone never swap).
 */
function terminalsOf(step: number, k: number): Terminals {
  if (opt.terminals === 'labels') {
    // Half of the sites give, half take. Site 0 always gives, so two sites alone never swap; the others are shuffled.
    const epoch = Math.floor((step + Math.floor((k * opt.dwell) / opt.lanes)) / opt.dwell);
    const order = sites.map((_, i) => i).slice(1);
    let h = pcg(epoch ^ pcg((k + 1) ^ pcg(opt.seed ^ 0x1ab)));
    for (let i = order.length - 1; i > 0; i--) {
      h = pcg(h);
      const j = h % (i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const give = Math.floor(sites.length / 2) - 1;
    return {
      sources: [sites[0]!, ...order.slice(0, give).map((i) => sites[i]!)],
      sinks: order.slice(give).map((i) => sites[i]!),
    };
  }
  const [a, b] = pairOf(step, k, opt.dwell, opt.lanes);
  return opt.terminals === 'star'
    ? { sources: [a], sinks: sites.filter((c) => c !== a) }
    : { sources: [a], sinks: [b] };
}
const set33 = t.cities.map((c, i) => (c.stat ? i : -1)).filter((i) => i >= 0);
const set36 = t.cities.map((_, i) => i);
const death = new Float32Array(n);
const birth = new Float32Array(n);
const log = `${OUT}${opt.name}.jsonl`;
writeFileSync(log, JSON.stringify({ opt, land: t.landCells, agents: sim.n }) + '\n');
const t0 = performance.now();
let gateSum = 0;
for (let s = 1; s <= opt.steps; s++) {
  sim.advance();
  if (s > opt.flowFrom) {
    if (exact) {
      // One new random pair at every solve (Tero 2010: a random pair at each time step); solved every `every` steps.
      if ((s - opt.flowFrom - 1) % opt.every === 0) flowE.advance(sim.trail, [pairOf(s, 0, opt.every, 1)], true);
      else flowE.follow(sim.trail);
    } else {
      flowM.advance(
        sim.trail,
        Array.from({ length: opt.lanes }, (_, k) => terminalsOf(s, k)),
        true,
      );
    }
    gateSum += flow.gate;
    for (let c = 0; c < n; c++) {
      const d2 = flow.D[c]! * flow.D[c]!;
      const sat = d2 / (d2 + opt.half * opt.half);
      death[c] = opt.death * (1 - sat);
      birth[c] = flow.tube(c) > 0 ? (opt.birth * Math.max(0, flow.D[c]! - opt.dBirth)) / (1 - opt.dBirth) : 0;
    }
    sim.deathChance = death;
    sim.birthChance = opt.birth > 0 ? birth : null;
  }
  if (s % opt.measureEvery === 0 || s === opt.steps) {
    const mask = networkMask(world, sim.trail, 1.5);
    const net = network(mask, world.w, world.h, t.cities);
    const m33 = measures(net, t.cities, set33);
    const m36 = measures(net, t.cities, set36);
    const line = {
      step: s,
      alive: sim.aliveCount,
      births: sim.births,
      deaths: sim.deaths,
      gate: +(gateSum / opt.measureEvery).toFixed(3),
      m33,
      m36,
      s: Math.round((performance.now() - t0) / 1000),
    };
    gateSum = 0;
    appendFileSync(log, JSON.stringify(line) + '\n');
  }
  if (opt.pictures.includes(s)) {
    writePng(`${OUT}${opt.name}-trail-${s}.png`, world.w, world.h, picture(world, sim.trail, 12), 2);
    if (s > opt.flowFrom) {
      const shown = new Float32Array(n);
      for (let c = 0; c < n; c++) shown[c] = flow.tube(c) * flow.D[c]!;
      writePng(`${OUT}${opt.name}-D-${s}.png`, world.w, world.h, picture(world, shown, 0.6, [255, 120, 80]), 2);
    }
  }
}
console.log(`${opt.name} done in ${Math.round((performance.now() - t0) / 1000)} s`);
