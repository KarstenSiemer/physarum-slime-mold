// The births and the deaths of a run by zone and by the flow memory of the cell (ADR 0053), on the maps of
// births.gpu.test.ts: one line per window.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/births.ts <scene> <name> [<name> ...]
//
// A scene with a lattice and two foods (the mazes) has zones: the corridor of the shortest route and the dead ends
// (prototype/maze.ts). Another scene has one zone, all its open cells.
//
// Per zone the line holds:
// - born: the children per 1,000 steps onto starved cells (D < h = 0.01), onto open cells (h ≤ D ≤ 0.5) and onto fed
//   cells (D > 0.5), by the flow memory of the step before the birth.
// - died: the deaths per 1,000 steps.
// - ground: the shares of the cells at the end of the window: a tube with D below h and one with D from h on (tube
//   body from 0.05 on), then ground without a tube that is closed (D < h), marked (h ≤ D < 0.2: a tube starved there,
//   and births are allowed again) and fresh (D = 0.2).
// - opens: the steps until the closed ground of the zone is open again, as its first quartile, its median and its
//   third quartile: ln(h / D) / ln(1 + r), the time in which the flow memory D of ground without a tube grows back
//   to h. r is FLOW.recover of src/engine/flow.ts; RECOVER=0.00023 gives the time of the runs before ADR 0054.
// - trail: the mean trail of the zone.
import { readdirSync, readFileSync } from 'node:fs';
import { FLOW } from '../../../src/engine/flow.ts';
import { PRESETS } from '../../../src/model/presets.ts';
import { zones } from '../prototype/maze.ts';
import { outDir } from '../prototype/out.ts';
import { buildWorld, geodesic, siteCells } from '../prototype/world.ts';

const DIR = process.env.DIR ?? outDir('engine/');
const [scene = 'snail-maze', ...names] = process.argv.slice(2);
const preset = PRESETS.find((p) => p.id === scene);
if (!preset) throw new Error(`no scene ${scene}`);
const settings = preset.settings();
const H = 0.01;
const FRESH = 0.2;
const BODY = 0.05;
const RECOVER = Number(process.env.RECOVER ?? FLOW.recover);

const read = (file: string) =>
  new Float32Array(new Uint8Array(Buffer.from(readFileSync(DIR + file, 'utf8'), 'base64')).buffer);

for (const name of names) {
  const log = readFileSync(DIR + name + '.jsonl', 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { start: number; steps: number; w: number; h: number; alive: number[] });
  const starts = readdirSync(DIR)
    .filter((f) => f.startsWith(name + '-born-starved-') && f.endsWith('.f32.b64'))
    .map((f) => Number(/-(\d+)\.f32\.b64$/.exec(f)?.[1]))
    .sort((a, b) => a - b);
  const [w, h] = [log[0]?.w ?? 0, log[0]?.h ?? 0];
  const n = w * h;
  const world = buildWorld(w, h, settings.boundary, preset.env ?? []);
  // The zones of a maze: a scene with a lattice and two foods. The cells that no way from the first food reaches hold
  // no colony, so they are not open here (measure-mazes.ts).
  const maze = settings.lattice !== null && world.sites.length === 2;
  if (maze) {
    const reach = geodesic(world, siteCells(world, 0));
    for (let c = 0; c < n; c++) if (!Number.isFinite(reach[c]!)) world.open[c] = 0;
  }
  const z = maze ? zones(world) : undefined;
  const parts: [string, (c: number) => boolean][] = z
    ? [
        ['all', () => true],
        ['route', (c) => z.path[c] === 1],
        ['dead', (c) => z.dead[c] === 1],
      ]
    : [['all', () => true]];
  for (const start of starts) {
    const steps = log.find((l) => l.start === start)?.steps ?? 1;
    const map = (kind: string) => read(`${name}-${kind}-${String(start)}.f32.b64`);
    const [starved, open, fed, died] = [map('born-starved'), map('born-open'), map('born-fed'), map('died')];
    const [trail, ground, body] = [map('trail'), map('ground'), map('body')];
    const out = parts.map(([label, inPart]) => {
      const sum = { cells: 0, starved: 0, open: 0, fed: 0, died: 0, trail: 0 };
      const kinds = { faint: 0, tube: 0, closed: 0, marked: 0, fresh: 0 };
      const waits: number[] = [];
      for (let c = 0; c < n; c++) {
        if (!world.open[c] || !inPart(c)) continue;
        sum.cells++;
        sum.starved += starved[c]!;
        sum.open += open[c]!;
        sum.fed += fed[c]!;
        sum.died += died[c]!;
        sum.trail += trail[c]!;
        const d = ground[c]!;
        if (body[c]! >= BODY) kinds[d < H ? 'faint' : 'tube']++;
        else kinds[d < H ? 'closed' : d < FRESH ? 'marked' : 'fresh']++;
        if (body[c]! < BODY && d < H) waits.push(Math.log(H / Math.max(d, 1e-4)) / Math.log(1 + RECOVER));
      }
      waits.sort((a, b) => a - b);
      const quartile = (q: number) => (waits[Math.floor(q * (waits.length - 1))] ?? 0).toFixed(0);
      const rate = (v: number) => ((v * 1000) / steps).toFixed(0);
      const share = (v: number) => (v / Math.max(sum.cells, 1)).toFixed(3);
      return (
        `${label} cells ${String(sum.cells)} born starved ${rate(sum.starved)} open ${rate(sum.open)} fed ${rate(sum.fed)}` +
        ` died ${rate(sum.died)} ground faint ${share(kinds.faint)} tube ${share(kinds.tube)} closed ${share(kinds.closed)}` +
        ` marked ${share(kinds.marked)} fresh ${share(kinds.fresh)} opens ${quartile(0.25)},${quartile(0.5)},${quartile(0.75)}` +
        ` trail ${(sum.trail / Math.max(sum.cells, 1)).toFixed(4)}`
      );
    });
    const alive = log.find((l) => l.start === start)?.alive[0] ?? 0;
    console.log(`${name} ${String(start)}+${String(steps)} alive ${String(alive)} | ${out.join(' | ')}`);
  }
}
