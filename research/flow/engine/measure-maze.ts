// The measures of the Maze on the dumps of the real engine (dump.gpu.test.ts): one line per dumped step, and pictures.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/measure-maze.ts <name>
// The lines of several runs go to summary.ts: `... measure-maze.ts maze-webgpu-flow-s1 >> rows.txt`.
import { readdirSync, readFileSync } from 'node:fs';
import { mazeWorld, measure, zones } from '../prototype/maze.ts';
import { outDir } from '../prototype/out.ts';
import { picture, writePng } from '../prototype/world.ts';

const DIR = process.env.DIR ?? outDir('engine/');
const name = process.argv[2] ?? 'maze-webgpu-flow-s1';
const world = mazeWorld();
const z = zones(world);
const n = world.w * world.h;
const read = (file: string) =>
  new Float32Array(new Uint8Array(Buffer.from(readFileSync(DIR + file, 'utf8'), 'base64')).buffer);
const steps = readdirSync(DIR)
  .filter((f) => f.startsWith(name + '-trail-'))
  .map((f) => Number(/trail-(\d+)/.exec(f)?.[1]))
  .sort((a, b) => a - b);
const log = readFileSync(DIR + name + '.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as { step?: number; alive?: number[]; ms?: number });
for (const step of steps) {
  const trail = read(`${name}-trail-${step}.f32.b64`);
  const row = log.find((l) => l.step === step);
  // The dumps hold no agents: the measure of the agents per cell is 0 here.
  const m = measure(world, z, step, row?.alive?.[0] ?? 0, trail, new Uint8Array(n));
  let [dp, dd] = [0, 0];
  try {
    const d = read(`${name}-D-${step}.f32.b64`);
    for (let c = 0; c < n; c++) {
      if (z.path[c]) dp += d[c]!;
      else if (z.dead[c]) dd += d[c]!;
    }
    writePng(`${DIR}${name}-D-${step}.png`, world.w, world.h, picture(world, d, 0.6, [255, 120, 80]), 2);
  } catch {
    // A run without the flow has no flow memory.
  }
  writePng(`${DIR}${name}-trail-${step}.png`, world.w, world.h, picture(world, trail, 12), 2);
  console.log(
    `${name} ${step} alive ${m.alive} ratio ${m.ratio.toFixed(2)} tP ${m.trailPath.toFixed(3)} tD ${m.trailDead.toFixed(4)} joined ${String(m.joined)} tube ${m.tube.toFixed(2)} dP ${(dp / z.pathCells).toFixed(4)} dD ${(dd / z.deadCells).toFixed(5)} ms ${String(row?.ms)}`,
  );
}
