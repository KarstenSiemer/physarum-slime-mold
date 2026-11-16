// Which foods of the scene Tokyo with light lie on dark ground that light encloses (ADR 0050): the parts of the land
// whose light byte is below `least`, joined over 8 neighbours, and the foods in each part.
// Usage: node --import ./research/flow/register.mjs research/flow/engine/light-islands.ts [n] [least]
import { presetById } from '../../../src/model/presets.ts';
import { tokyoWorld } from '../prototype/tokyo.ts';
import { buildWorld } from '../prototype/world.ts';

const n = Number(process.argv[2] ?? 512);
const least = Number(process.argv[3] ?? 1);
const t = tokyoWorld(n, 'app');
const { w, h } = t.world;
const shapes = presetById('tokyo-light')?.env;
if (!shapes) throw new Error('no scene tokyo-light');
const { light } = buildWorld(w, h, 'dish', shapes);
const dark = (c: number) => !!t.land[c] && !!t.world.open[c] && light[c]! < least;
const part = new Int32Array(w * h).fill(-1);
const sizes: number[] = [];
for (let s = 0; s < w * h; s++) {
  if (!dark(s) || part[s]! >= 0) continue;
  const id = sizes.length;
  const todo = [s];
  part[s] = id;
  let size = 0;
  while (todo.length > 0) {
    const c = todo.pop()!;
    size++;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const [x, y] = [(c % w) + dx, Math.floor(c / w) + dy];
        const m = y * w + x;
        if (x < 0 || y < 0 || x >= w || y >= h || !dark(m) || part[m]! >= 0) continue;
        part[m] = id;
        todo.push(m);
      }
  }
  sizes.push(size);
}
console.log(`${sizes.length} dark parts of the land, cells: ${[...sizes].sort((a, b) => b - a).join(' ')}`);
const main = sizes.indexOf(Math.max(...sizes));
t.cities.forEach((c, i) => {
  const cell = Math.floor(c.y) * w + Math.floor(c.x);
  const id = part[cell] ?? -1;
  if (id !== main)
    console.log(`food ${i} ${JSON.stringify(c)}: light ${light[cell]}, part ${id} of ${sizes[id] ?? 0} cells`);
});
