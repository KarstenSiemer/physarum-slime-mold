// A colony that grows from one food in an open dish or along a lane: does a crown form at the head of a tube?
// Prototype code. Usage:
//   node --import ./research/flow/register.mjs research/front/comb.ts scene=dish steps=6000 pics=2000,4000,6000 ...
// `scene`: dish (a dish of `side` cells, the food in the middle) or lane (a box of `side` × `long` cells, the food at
// one end). The other keys set the rules of stage 4 (`front` of sim.ts), `flow`, `seed` and `name`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { box, dish } from './layouts';
import { picture } from './picture';
import { Sim, frontFrom, params } from './sim';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const num = (k: string, d: number) => (k in args ? Number(args[k]) : d);
const scene = args.scene ?? 'dish';
const side = num('side', 160);
const long = num('long', 260);
const steps = num('steps', 6000);
const pics = (args.pics ?? '').split(',').filter(Boolean).map(Number);
const front = frontFrom(args, ['scene', 'side', 'long', 'steps', 'pics', 'name', 'flow', 'seed', 'food', 'covered']);
const name = args.name ?? scene;
const out = `research/front/out/${name}`;
mkdirSync(out, { recursive: true });

const layout = scene === 'lane' ? box(side, long, [[side / 2, 8, 5]]) : dish(side, [[side / 2, side / 2, 5]]);
const sim = new Sim(
  layout,
  params({
    seed: num('seed', 1),
    flow: num('flow', 8),
    foodStrength: num('food', 0.03),
    covered: num('covered', 1),
    front,
  }),
);
const [fx, fy] = layout.start;
const log: Record<string, number>[] = [];
const t0 = performance.now();
for (let k = 1; k <= steps; k++) {
  sim.advance();
  if (k % 250 === 0 || pics.includes(k)) {
    let reach = 0;
    let slimed = 0;
    let plasm = 0;
    for (let c = 0; c < sim.cells; c++) {
      if (!layout.open[c]) continue;
      if (sim.hasSlime(c)) slimed++;
      if (sim.trail[c]! >= 1) {
        plasm++;
        reach = Math.max(reach, Math.hypot((c % sim.w) + 0.5 - fx, Math.floor(c / sim.w) + 0.5 - fy));
      }
    }
    const row = {
      step: k,
      alive: sim.aliveCount,
      reach: Math.round(reach * 10) / 10,
      slimed,
      plasm,
      births: sim.births,
      fresh: sim.freshBirths,
      held: sim.heldMoves,
      heldB: sim.heldBirths,
      starved: sim.starved,
      respawned: sim.respawned,
      sink: Math.round(sim.frontTotal * 100) / 100,
      ms: Math.round(performance.now() - t0),
    };
    log.push(row);
    console.log(JSON.stringify(row));
  }
  if (pics.includes(k)) {
    picture(sim, { x: 0, y: 0, w: sim.w, h: sim.h, zoom: 3 }, `${out}/full-${String(k)}.png`);
    // A close view at the head of the farthest plasm.
    let best = -1;
    let far = 0;
    for (let c = 0; c < sim.cells; c++)
      if (sim.trail[c]! >= 1) {
        const d = Math.hypot((c % sim.w) + 0.5 - fx, Math.floor(c / sim.w) + 0.5 - fy);
        if (d > far) [far, best] = [d, c];
      }
    if (best >= 0) {
      const size = 64;
      const x = Math.min(Math.max(Math.round((best % sim.w) - size / 2), 0), sim.w - size);
      const y = Math.min(Math.max(Math.round(Math.floor(best / sim.w) - size / 2), 0), sim.h - size);
      picture(sim, { x, y, w: size, h: size, zoom: 7 }, `${out}/close-${String(k)}.png`);
    }
  }
}
writeFileSync(`${out}/log.json`, JSON.stringify({ args, front, log }, null, 1));
