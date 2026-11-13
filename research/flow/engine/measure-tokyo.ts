// The measures of Tero et al. 2010 on the Tokyo dumps of the real engine (dump.gpu.test.ts): one line per dumped step.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/measure-tokyo.ts <name> [level] [steps]
// `level`: the trail above which a cell is part of the network (1.5). `steps`: the steps that get a picture (all).
// The lines of several runs go to summary.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { outDir } from '../prototype/out.ts';
import { measures, network, networkMask, tokyoWorld } from '../prototype/tokyo.ts';
import { picture, writePng } from '../prototype/world.ts';

const DIR = process.env.DIR ?? outDir('engine/');
const name = process.argv[2] ?? 'tokyo-webgpu-flow-s1';
const level = Number(process.argv[3] ?? 1.5);
const pics = (process.argv[4] ?? '').split(',').filter(Boolean).map(Number);
interface Row {
  step?: number;
  w?: number;
  alive?: number[];
  ms?: number;
}
let log: Row[] = [];
try {
  log = readFileSync(DIR + name + '.jsonl', 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Row);
} catch {
  // The run is still in work: its log comes at its end.
}
const n = log[0]?.w ?? Number(process.env.N ?? 512);
// The map of the app's scene (src/model/tokyo.ts).
const t = tokyoWorld(n, 'app');
const { world } = t;
const read = (file: string) =>
  new Float32Array(new Uint8Array(Buffer.from(readFileSync(DIR + file, 'utf8'), 'base64')).buffer);
// The steps of the run: its dumps of the trail (and not the pictures that an earlier call of this script wrote).
const steps = readdirSync(DIR)
  .filter((f) => f.startsWith(name + '-trail-') && f.endsWith('.f32.b64'))
  .map((f) => Number(/-trail-(\d+)\.f32\.b64$/.exec(f)?.[1]))
  .sort((a, b) => a - b);
const set33 = t.cities.map((c, i) => (c.stat ? i : -1)).filter((i) => i >= 0);
const set36 = t.cities.map((_, i) => i);
for (const step of steps) {
  const trail = read(`${name}-trail-${step}.f32.b64`);
  const mask = networkMask(world, trail, level);
  const net = network(mask, world.w, world.h, t.cities);
  const a = measures(net, t.cities, set33);
  const b = measures(net, t.cities, set36);
  const row = log.find((l) => l.step === step);
  // Trail on open cells that are not land: the colony must not cross the coast.
  let sea = 0;
  for (let c = 0; c < world.w * world.h; c++) if (world.open[c] && !t.land[c] && trail[c]! > level) sea++;
  console.log(
    `${name} ${String(step).padStart(6)} alive ${String(row?.alive?.[0] ?? 0).padStart(6)} | 33: ${a.joined} joined ${a.links} links TL ${a.tl.toFixed(2)} MD ${a.md.toFixed(2)} FT ${a.ft.toFixed(2)} | 36: ${b.joined} joined TL ${b.tl.toFixed(2)} MD ${b.md.toFixed(2)} FT ${b.ft.toFixed(2)} | sea ${sea} | ${String(row?.ms)} ms`,
  );
  if (pics.length === 0 || pics.includes(step)) {
    writePng(`${DIR}${name}-trail-${step}.png`, world.w, world.h, picture(world, trail, 12), 1);
    try {
      const d = read(`${name}-D-${step}.f32.b64`);
      // The flow memory on the cells of the land that hold a tube (the dump holds 0 elsewhere).
      const v: number[] = [];
      for (let c = 0; c < world.w * world.h; c++) if (t.land[c] && d[c]! > 0) v.push(d[c]!);
      v.sort((p, q) => p - q);
      const q = (f: number) => (v[Math.floor(f * (v.length - 1))] ?? 0).toExponential(1);
      const low = ((100 * v.filter((x) => x < 0.01).length) / Math.max(1, v.length)).toFixed(0);
      console.log(
        `    D on ${v.length} tube cells: 10 % ${q(0.1)}, 50 % ${q(0.5)}, 90 % ${q(0.9)}, 99 % ${q(0.99)}; below 0.01: ${low} %`,
      );
      writePng(`${DIR}${name}-D-${step}.png`, world.w, world.h, picture(world, d, 0.6, [255, 120, 80]), 1);
    } catch {
      // A run without the flow has no flow memory.
    }
  }
}
