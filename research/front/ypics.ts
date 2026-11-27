// Pictures of one run in the Y-maze (ymaze.ts) at given steps after the start of the colony. Prototype code.
// Usage: node --import ./research/flow/register.mjs research/front/ypics.ts slimed=left pics=1000,2000 key=value ...
import { mkdirSync } from 'node:fs';
import type { Side } from '../flow/engine/y-maze';
import { yMazeLayout } from './layouts';
import { look, picture } from './picture';
import { Sim, frontFrom, params } from './sim';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const front = frontFrom(args, ['slimed', 'seed', 'pics', 'name', 'scent']);
const slimed = (args.slimed ?? '').split(',').filter(Boolean) as Side[];
const { layout } = yMazeLayout(slimed);
// `scent`: the steps of the food scent before the colony starts, 300 as the records of ADR 0065; 0 as the app (ADR 0073).
const sim = new Sim(
  layout,
  params({ seed: Number(args.seed ?? 1), startStep: 18000, front, scentSteps: Number(args.scent ?? 300) }),
);
const pics = (args.pics ?? '500,1000,2000').split(',').map(Number);
const out = `research/front/out/${args.name ?? 'ypics'}`;
mkdirSync(out, { recursive: true });
for (let k = 1; k <= Math.max(...pics); k++) {
  sim.advance();
  if (pics.includes(k)) {
    picture(sim, { x: 0, y: 0, w: sim.w, h: sim.h, zoom: 4 }, `${out}/y-${String(k)}.png`);
    look(sim, { x: 0, y: 0, w: sim.w, h: sim.h, zoom: 4 }, `${out}/look-${String(k)}.png`);
    console.log(k, sim.aliveCount, sim.frontTotal.toFixed(2), 'demand', sim.demand);
  }
}
