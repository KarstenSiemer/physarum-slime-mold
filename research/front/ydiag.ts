// The two arms of one Y-maze run side by side over time: how far the plasm and the territory reach along each arm,
// and how many agents each arm holds. Prototype code.
import { yMazeLayout } from './layouts';
import { Sim, noFront, params, type Front } from './sim';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
const front: Front = { ...noFront() };
for (const key of Object.keys(front) as (keyof Front)[])
  if (key in args)
    (front as unknown as Record<string, unknown>)[key] = ['holdOn', 'holdBirthsOn', 'solver', 'speedOn'].includes(key)
      ? args[key]
      : Number(args[key]);
for (const key of ['sink', 'colony', 'holdBirths', 'rim'] as const) if (key in args) front[key] = args[key] === '1';
const { layout, maze } = yMazeLayout(['left']);
const sim = new Sim(layout, params({ seed: Number(args.seed ?? 1), startStep: 18000, front }));
for (let k = 1; k <= 3400; k++) {
  sim.advance();
  if (k % 200 !== 0) continue;
  const row: Record<string, number> = { k };
  for (const side of ['left', 'right'] as const) {
    let [plasm, terr, agents] = [0, 0, 0];
    for (const c of maze.arm[side]) {
      const a = maze.along[c]!;
      if (sim.trail[c]! >= 1) plasm = Math.max(plasm, a);
      if (sim.territory[c]) terr = Math.max(terr, a);
      agents += sim.occ[c]!;
    }
    row[`${side.charAt(0)}Plasm`] = Math.round(plasm);
    row[`${side.charAt(0)}Terr`] = Math.round(terr);
    row[`${side.charAt(0)}Agents`] = agents;
  }
  console.log(JSON.stringify(row));
}
