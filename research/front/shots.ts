// Pictures of a run at given steps: the fields side by side (picture()) and the lit picture of the veins (look()),
// fitted and close at the head of the farthest plasm. Prototype code. Usage as comb.ts, with `zoom` for the close view.
import { mkdirSync } from 'node:fs';
import { box, dish } from './layouts';
import { alignment, crown, head, murray, veinDelay } from './measure';
import { look, picture } from './picture';
import { Sim, frontFrom, params } from './sim';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const num = (k: string, d: number) => (k in args ? Number(args[k]) : d);
const front = frontFrom(args, ['scene', 'side', 'long', 'size', 'zoom', 'pics', 'name', 'flow', 'seed', 'scent']);
const scene = args.scene ?? 'lane';
const side = num('side', 80);
const long = num('long', 300);
const layout = scene === 'lane' ? box(side, long, [[side / 2, 8, 5]]) : dish(side, [[side / 2, side / 2, 5]]);
// `scent`: the steps of the food scent before the colony starts, 300 as the records of ADR 0065; 0 as the app (ADR 0073).
const sim = new Sim(
  layout,
  params({ seed: num('seed', 1), flow: num('flow', 8), front, scentSteps: num('scent', 300) }),
);
const pics = (args.pics ?? '4000').split(',').map(Number);
const out = `research/front/out/${args.name ?? 'shots'}`;
mkdirSync(out, { recursive: true });
const zoom = num('zoom', 6);
const size = num('size', 70);
for (let k = 1; k <= Math.max(...pics); k++) {
  sim.advance();
  if (!pics.includes(k)) continue;
  let [best, far] = [-1, -1];
  const [fx, fy] = layout.start;
  for (let c = 0; c < sim.cells; c++)
    if (sim.trail[c]! >= 1) {
      const d = Math.hypot((c % sim.w) + 0.5 - fx, Math.floor(c / sim.w) + 0.5 - fy);
      if (d > far) [far, best] = [d, c];
    }
  look(sim, { x: 0, y: 0, w: sim.w, h: sim.h, zoom: 3 }, `${out}/look-${String(k)}.png`);
  picture(sim, { x: 0, y: 0, w: sim.w, h: sim.h, zoom: 3 }, `${out}/fields-${String(k)}.png`);
  if (best >= 0) {
    const x = Math.min(Math.max(Math.round((best % sim.w) - size / 2), 0), Math.max(0, sim.w - size));
    const y = Math.min(Math.max(Math.round(Math.floor(best / sim.w) - size * 0.7), 0), Math.max(0, sim.h - size));
    look(sim, { x, y, w: Math.min(size, sim.w), h: size, zoom }, `${out}/look-close-${String(k)}.png`);
  }
  const m = murray(sim);
  console.log(
    JSON.stringify({
      step: k,
      alive: sim.aliveCount,
      crown: crown(sim),
      head: head(sim),
      align: alignment(sim),
      delay: veinDelay(sim),
      murray: {
        junctions: m.n.length,
        median: Math.round(m.median * 100) / 100,
        arctan: Math.round(m.arctan * 100) / 100,
      },
    }),
  );
}
