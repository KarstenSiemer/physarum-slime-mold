// The tubes that the flux has left, and the ground that their starvation marks, on the dumps of the real engine
// (dump.gpu.test.ts with VITE_GROUND=1): one line per dumped step, for decision 19 of ADR 0029.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/strands.ts <name> <maze|tokyo> [x,y,r]
//
// A line counts cells. A cell holds a tube while its tube body is at least 0.05: the dump of the flow memory D is above
// 0 there and 0 elsewhere. h = 0.01 is the flow memory at which starvation is half its top value (FLOW.half), and the
// growth gate lets no agent divide below it (decision 9). Fresh ground has D = 0.2.
//
// - tubes, faint: the cells with a tube; of them those with D below h (the flux has left them, and their agents starve).
// - closed, marked: the cells without a tube with D below h (no agent divides there, and an agent there dies with at
//   least 1 % per step) and with D below 0.2 (a tube starved there, and the ground is not fresh again yet).
// - Tokyo: the cells of the land; `net` the cells of the network of the measures (trail above 1.5, measure-tokyo.ts).
// - The Maze: `dead` and `route` hold the same counts in the dead ends and on the corridor of the shortest route
//   (prototype/maze.ts), and `ratio` the mean trail in the dead ends over that on the route (measure-maze.ts).
// - line, faintLine: the network of the measures of Tero et al. 2010 as lines one cell wide (trail above 1.5, thinned
//   as measure-tokyo.ts thins it), in cells; of them the cells of a faint strand: no cell within STRAND cells holds a
//   tube with D of at least h. Such a line is a strand of agents with a trail above the level of the measure that no
//   flux feeds. The cells of a food source do not count.
// - With a disc x,y,r in cells (the grid of the run), `disc` holds the same counts inside it.
import { readdirSync, readFileSync } from 'node:fs';
import { mazeWorld, zones } from '../prototype/maze.ts';
import { outDir } from '../prototype/out.ts';
import { networkMask, thin, tokyoWorld } from '../prototype/tokyo.ts';
import type { World } from '../prototype/world.ts';

const DIR = process.env.DIR ?? outDir('engine/');
const [name = '', scene = 'tokyo', discArg] = process.argv.slice(2);
const H = 0.01;
const FRESH = 0.2;
const LEVEL = 1.5;
/** Cells around a cell of a line in which a fed tube makes the line fed: a tube band is wider than its line. */
const STRAND = 2;

const read = (file: string) =>
  new Float32Array(new Uint8Array(Buffer.from(readFileSync(DIR + file, 'utf8'), 'base64')).buffer);
const steps = readdirSync(DIR)
  .filter((f) => f.startsWith(name + '-ground-') && f.endsWith('.f32.b64'))
  .map((f) => Number(/-ground-(\d+)\.f32\.b64$/.exec(f)?.[1]))
  .sort((a, b) => a - b);
if (steps.length === 0) {
  console.error(`no dump ${name}-ground-<step>.f32.b64 in ${DIR}: run dump.gpu.test.ts with VITE_GROUND=1`);
  process.exit(1);
}
const log = readFileSync(DIR + name + '.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as { step?: number; alive?: number[]; recover?: number });

let world: World;
let land: Uint8Array;
let zone: { dead: Uint8Array; path: Uint8Array } | undefined;
if (scene === 'maze') {
  world = mazeWorld();
  const z = zones(world);
  zone = { dead: z.dead, path: z.path };
  land = world.open;
} else {
  const t = tokyoWorld(512, 'app');
  world = t.world;
  land = t.land;
}
const n = world.w * world.h;
const disc = discArg?.split(',').map(Number);
const inDisc = (c: number) => {
  if (!disc) return false;
  const [x = 0, y = 0, r = 0] = disc;
  return Math.hypot((c % world.w) + 0.5 - x, Math.floor(c / world.w) + 0.5 - y) < r;
};

interface Counts {
  tubes: number;
  faint: number;
  closed: number;
  marked: number;
  net: number;
  line: number;
  faintLine: number;
  trail: number;
  cells: number;
}
const zero = (): Counts => ({
  tubes: 0,
  faint: 0,
  closed: 0,
  marked: 0,
  net: 0,
  line: 0,
  faintLine: 0,
  trail: 0,
  cells: 0,
});

for (const step of steps) {
  const trail = read(`${name}-trail-${step}.f32.b64`);
  const tube = read(`${name}-D-${step}.f32.b64`);
  const ground = read(`${name}-ground-${step}.f32.b64`);
  const mask = networkMask(world, trail, LEVEL);
  const line = mask.slice();
  thin(line, world.w, world.h);
  // Whether a tube with D of at least h lies within STRAND cells of a cell.
  const fedNear = (c: number) => {
    const [x, y] = [c % world.w, Math.floor(c / world.w)];
    for (let dy = -STRAND; dy <= STRAND; dy++)
      for (let dx = -STRAND; dx <= STRAND; dx++) {
        const [u, v] = [x + dx, y + dy];
        if (u >= 0 && v >= 0 && u < world.w && v < world.h && tube[v * world.w + u]! >= H) return true;
      }
    return false;
  };
  const all = zero();
  const dead = zero();
  const route = zero();
  const inside = zero();
  for (let c = 0; c < n; c++) {
    if (!land[c] || !world.open[c]) continue;
    const parts = [all];
    if (zone?.dead[c]) parts.push(dead);
    else if (zone?.path[c]) parts.push(route);
    if (inDisc(c)) parts.push(inside);
    const d = tube[c]!;
    const onLine = line[c] === 1 && !world.food[c];
    const faintLine = onLine && !fedNear(c);
    for (const p of parts) {
      p.cells++;
      p.trail += trail[c]!;
      if (mask[c] && !world.food[c]) p.net++;
      if (onLine) p.line++;
      if (faintLine) p.faintLine++;
      if (d > 0) {
        p.tubes++;
        if (d < H) p.faint++;
      } else {
        if (ground[c]! < H) p.closed++;
        if (ground[c]! < FRESH) p.marked++;
      }
    }
  }
  const row = log.find((l) => l.step === step);
  const round = (p: Counts) => ({ ...p, trail: Math.round(p.trail) });
  console.log(
    JSON.stringify({
      name,
      step,
      recover: row?.recover,
      alive: row?.alive?.[0],
      ...round(all),
      ...(zone
        ? {
            ratio: +(dead.trail / dead.cells / (route.trail / route.cells)).toFixed(5),
            dead: round(dead),
            route: round(route),
          }
        : {}),
      ...(disc ? { disc: round(inside) } : {}),
    }),
  );
}
