// Pictures of the lines of voronoi.gpu.test.ts: the agents or the trail mask (yellow) over the Voronoi diagram of the
// dots (blue), the repellents (red), the food dabs (green) and the circle of the measure (grey), as PNG files in a folder pictures/ beside the file. To
// look at a run; no number of the record comes from here.
// Usage: node --import ./research/flow/register.mjs research/voronoi/picture.ts <file.jsonl> [--step=5000] [--veins]
import { mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { presetById } from '../../src/model/presets.ts';
import { maskOfText } from '../coarsening/measure.ts';
import { writePng } from '../flow/prototype/world.ts';
import { voronoiEdges } from './measure.ts';
import { dishOf, jsonl, measureRadius } from './tables.ts';

const args = process.argv.slice(2);
const steps = args
  .find((a) => a.startsWith('--step='))
  ?.slice(7)
  .split(',')
  .map(Number);
const seeds = args
  .find((a) => a.startsWith('--seed='))
  ?.slice(7)
  .split(',')
  .map(Number);
const which = args.includes('--veins') ? 'veins' : 'cells';
for (const file of args.filter((a) => !a.startsWith('--'))) {
  const dir = join(dirname(file), 'pictures');
  mkdirSync(dir, { recursive: true });
  for (const line of jsonl(file)) {
    if (steps && !steps.includes(line.step)) continue;
    if (seeds && !seeds.includes(line.seed)) continue;
    const { w, h } = line;
    const dish = dishOf(w, h);
    const rgb = new Uint8Array(w * h * 3);
    const put = (x: number, y: number, c: [number, number, number]) => {
      const [u, v] = [Math.floor(x), Math.floor(y)];
      if (u >= 0 && v >= 0 && u < w && v < h) rgb.set(c, (v * w + u) * 3);
    };
    if (line.scene === 'voronoi') {
      for (const [x, y] of voronoiEdges(dish.dots, dish.centre, 109.5)) put(x, y, [40, 70, 200]);
      const r = measureRadius();
      for (let a = 0; a < 2000; a++) {
        const t = (a / 2000) * 2 * Math.PI;
        put(dish.centre[0] + r * Math.cos(t), dish.centre[1] + r * Math.sin(t), [70, 70, 70]);
      }
    }
    const mask = maskOfText(line[which] ?? '', w * h);
    for (let c = 0; c < w * h; c++) if (mask[c]) rgb.set([235, 220, 40], c * 3);
    // The scene's shapes: a repellent in red, a food dab in green (the ring of the Voronoi scene is not drawn).
    for (const e of presetById(line.scene)?.env ?? []) {
      if (e.to) continue;
      const [x, y] = [w / 2 + e.at[0] * w, h / 2 + e.at[1] * h];
      for (let v = -1; v <= 1; v++)
        for (let u = -1; u <= 1; u++) put(x + u, y + v, e.kind === 'light' ? [255, 60, 60] : [60, 255, 60]);
    }
    const name = [basename(file, '.jsonl'), line.dot, `f${String(line.food)}`, `l${String(line.light)}`]
      .concat([`s${String(line.seed)}`, String(line.step), which])
      .join('-');
    writePng(join(dir, `${name}.png`), w, h, rgb, 2);
    console.log(join(dir, `${name}.png`));
  }
}
