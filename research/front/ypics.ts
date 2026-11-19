// Pictures of one run in the Y-maze (ymaze.ts) at given steps after the start of the colony. Prototype code.
// Usage: node --import ./research/flow/register.mjs research/front/ypics.ts slimed=left pics=1000,2000 key=value ...
import { mkdirSync } from 'node:fs';
import type { Side } from '../flow/engine/y-maze';
import { yMazeLayout } from './layouts';
import { picture } from './picture';
import { Sim, frontFrom, params } from './sim';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const front = frontFrom(args, ['slimed', 'seed', 'pics', 'name']);
const slimed = (args.slimed ?? '').split(',').filter(Boolean) as Side[];
const { layout } = yMazeLayout(slimed);
const sim = new Sim(layout, params({ seed: Number(args.seed ?? 1), startStep: 18000, front }));
const pics = (args.pics ?? '500,1000,2000').split(',').map(Number);
const out = `research/front/out/${args.name ?? 'ypics'}`;
mkdirSync(out, { recursive: true });
for (let k = 1; k <= Math.max(...pics); k++) {
  sim.advance();
  if (pics.includes(k)) {
    picture(sim, { x: 0, y: 0, w: sim.w, h: sim.h, zoom: 4 }, `${out}/y-${String(k)}.png`);
    console.log(k, sim.aliveCount, sim.frontTotal.toFixed(2), 'demand', sim.demand);
  }
}
