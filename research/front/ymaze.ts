// The Y-maze of Reid et al. 2012 on the CPU (ADR 0056): which arm does the colony choose? Prototype code.
// Usage: node --import ./research/flow/register.mjs research/front/ymaze.ts case=one seeds=1-40 [key=value ...]
// `case`: one (slime on the left arm for an odd seed, on the right one for an even seed), both or none. The other
// keys set the rules of stage 4 (`front` of sim.ts) and `limit`, the most steps after the start of the colony.
import { mkdirSync, appendFileSync } from 'node:fs';
import type { Side } from '../flow/engine/y-maze';
import { yMazeLayout } from './layouts';
import { Sim, noFront, params, type Front } from './sim';

export interface YRun {
  seed: number;
  slimed: Side[];
  /** The arm whose food held plasm first, or 'split' for both in one step, or 'none'. */
  chosen: Side | 'split' | 'none';
  /** Steps from the start of the colony to the first food, and to the other food. */
  first: number;
  other: number;
  /** The agents at the first touch. */
  agents: number;
  ms: number;
}

/** The slime of a case for a seed: one arm alternates by seed, as y-maze.gpu.test.ts does it. */
export const slimedOf = (kind: string, seed: number): Side[] =>
  kind === 'one' ? [seed % 2 === 1 ? 'left' : 'right'] : kind === 'both' ? ['left', 'right'] : [];

export function runY(seed: number, slimed: Side[], front: Front, limit = 10000, after = 2000, age = 18000): YRun {
  const { layout } = yMazeLayout(slimed);
  const t0 = performance.now();
  const sim = new Sim(layout, params({ seed, startStep: age, front }));
  const touched = { left: -1, right: -1 };
  const foods = { left: layout.sites[0]!, right: layout.sites[1]! };
  let agents = 0;
  for (let k = 0; k < limit; k++) {
    sim.advance();
    for (const side of ['left', 'right'] as const)
      if (touched[side] < 0 && Array.from(foods[side]).some((c) => sim.trail[c]! >= 1)) touched[side] = k + 1;
    if (touched.left >= 0 && touched.right >= 0) break;
    const first = Math.max(touched.left, touched.right);
    if (first >= 0 && agents === 0) agents = sim.aliveCount;
    if (first >= 0 && k + 1 - first >= after) break;
  }
  const [l, r] = [touched.left, touched.right];
  const chosen: YRun['chosen'] =
    l < 0 && r < 0 ? 'none' : l === r ? 'split' : r < 0 || (l >= 0 && l < r) ? 'left' : 'right';
  const first = Math.min(...[l, r].filter((v) => v >= 0), Infinity);
  const other = l >= 0 && r >= 0 ? Math.max(l, r) - first : -1;
  return { seed, slimed, chosen, first, other, agents, ms: Math.round(performance.now() - t0) };
}

const isMain = process.argv[1]?.endsWith('ymaze.ts');
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=') as [string, string]));
  const [from = 1, to = from] = (args.seeds ?? '1-4').split('-').map(Number);
  const kind = args.case ?? 'one';
  const front: Front = { ...noFront() };
  for (const key of Object.keys(front) as (keyof Front)[])
    if (key in args)
      (front as unknown as Record<string, unknown>)[key] = ['holdOn', 'holdBirthsOn', 'solver', 'speedOn'].includes(key)
        ? args[key]
        : Number(args[key]);
  for (const key of ['sink', 'colony', 'holdBirths', 'rim'] as const) if (key in args) front[key] = args[key] === '1';
  const limit = Number(args.limit ?? 10000);
  const name = args.name ?? `y-${kind}`;
  mkdirSync('research/front/out', { recursive: true });
  const file = `research/front/out/${name}.jsonl`;
  for (let seed = from; seed <= to; seed++) {
    const run = runY(seed, slimedOf(kind, seed), front, limit);
    appendFileSync(file, JSON.stringify({ ...run, front }) + '\n');
    console.log(
      `seed ${String(seed)} slime ${run.slimed.join('+') || '-'}: ${run.chosen} first ${String(run.first)} other +${String(run.other)} agents ${String(run.agents)} (${String(run.ms)} ms)`,
    );
  }
}
