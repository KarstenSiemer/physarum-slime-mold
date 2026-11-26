// Why the Y-maze with slime on one arm loses its choice under the rules of ADR 0100 (the port of option 1 of ADR
// 0097): the births and deaths by kind on each part of the maze, and the budget against the agents of the front, from
// the start of the colony to the first food. Prototype code, as ymaze.ts.
// Usage: node --import ./research/flow/register.mjs research/front/ymaze-why.ts seeds=1-10 name=<out> [key=value ...]
// The records go to research/front/out/<name>.jsonl, one line per seed.
import { appendFileSync, mkdirSync } from 'node:fs';
import { yMazeLayout } from './layouts';
import { slimedOf } from './ymaze';
import { Sim, frontFrom, params, type Ledger } from './sim';

type Part = 'blank' | 'slime' | 'base';
const PARTS: Part[] = ['blank', 'slime', 'base'];
const zero = () => ({ jones: 0, front: 0, respawn: 0, starve: 0, crowd: 0 });

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const [from = 1, to = from] = (args.seeds ?? '1-4').split('-').map(Number);
const front = frontFrom(args, ['seeds', 'limit', 'name']);
const limit = Number(args.limit ?? 10000);
const name = args.name ?? 'ywhy';
mkdirSync(`research/front/out/${name}`.replace(/\/[^/]*$/, ''), { recursive: true });
for (let seed = from; seed <= to; seed++) {
  const slimed = slimedOf('one', seed);
  const { layout, maze } = yMazeLayout(slimed, 19);
  const blankSide = slimed[0] === 'left' ? 'right' : 'left';
  const part = new Uint8Array(layout.w * layout.h).fill(2);
  for (const c of maze.arm[blankSide]) part[c] = 0;
  for (const c of maze.arm[slimed[0]!]) part[c] = 1;
  const sim = new Sim(layout, params({ seed, startStep: 18000, front, scentSteps: 0 }));
  const counts = PARTS.map(zero);
  const at = (id: number) => part[Math.floor(sim.ay[id]!) * layout.w + Math.floor(sim.ax[id]!)] ?? 2;
  const ledger: Ledger = {
    born(id, kind) {
      const c = counts[at(id)]!;
      if (kind === 1) c.jones++;
      else if (kind === 2) c.front++;
      else c.respawn++;
    },
    died(id, cause) {
      counts[at(id)]![cause]++;
    },
    budget() {
      // The budget is read from the sim in the loop.
    },
  };
  sim.ledger = ledger;
  const foods = { left: layout.sites[0]!, right: layout.sites[1]! };
  const touched = { left: -1, right: -1 };
  // The budget against the agents of the front, and the agents on each part, every 100 steps.
  const trace: { k: number; budget: number; front: number; agents: number[] }[] = [];
  let full = 0;
  let steps = 0;
  for (let k = 0; k < limit; k++) {
    sim.advance();
    steps++;
    if (sim.frontAgents > 0 && sim.budget >= sim.frontAgents) full++;
    if ((k + 1) % 100 === 0) {
      const agents = [0, 0, 0];
      for (let i = 0; i < sim.cap; i++) if (sim.alive[i]) agents[at(i)]!++;
      trace.push({ k: k + 1, budget: Math.round(sim.budget), front: sim.frontAgents, agents });
    }
    for (const side of ['left', 'right'] as const)
      if (touched[side] < 0 && Array.from(foods[side]).some((c) => sim.trail[c]! >= 1)) touched[side] = k + 1;
    if (touched.left >= 0 || touched.right >= 0) break;
  }
  const chosen = touched.left >= 0 && touched.right >= 0 ? 'split' : touched[blankSide] >= 0 ? 'blank' : 'slime';
  const byPart = Object.fromEntries(PARTS.map((p, i) => [p, counts[i]]));
  const rec = { seed, chosen, first: steps, full: full / steps, byPart, trace, front };
  appendFileSync(`research/front/out/${name}.jsonl`, JSON.stringify(rec) + '\n');
  const b = counts[0]!;
  const s = counts[1]!;
  console.log(
    `seed ${String(seed)} ${chosen} at ${String(steps)}; budget full ${(full / steps).toFixed(2)}; blank J/F/R ${String(b.jones)}/${String(b.front)}/${String(b.respawn)}, slime J/F/R ${String(s.jones)}/${String(s.front)}/${String(s.respawn)}`,
  );
}
