// Checks the Tokyo world and the measures: the MST drawn as tubes must measure TL 1, MD 1, FT 0; with extra links
// that close loops, FT must be the share of links on loops.
// Usage: node --import ./research/flow/register.mjs research/flow/prototype/check-tokyo.ts
import { outDir } from './out.ts';
import { mapScale, measures, mst, network, tokyoWorld } from './tokyo.ts';
import { picture, writePng } from './world.ts';

const OUT = outDir(process.env.SUB);
const n = 400;
const t = tokyoWorld(n);
const set33 = t.cities.map((c, i) => (c.stat ? i : -1)).filter((i) => i >= 0);
const set36 = t.cities.map((_, i) => i);
const unit = n * mapScale();
const tree33 = mst(set33.map((i) => t.cities[i]!));
const tree36 = mst(set36.map((i) => t.cities[i]!));
console.log(
  JSON.stringify({
    land: t.landCells,
    sites: t.world.sites.length,
    cities: t.cities.length,
    mst33: +(tree33.length / unit).toFixed(3),
    mst36: +(tree36.length / unit).toFixed(3),
    expect: [2.254, 2.569],
  }),
);
// Every city on land?
const offLand = t.cities.filter((c) => !t.land[Math.floor(c.y) * n + Math.floor(c.x)]).map((c) => c.name);
console.log('cities off land:', JSON.stringify(offLand));
const draw = (mask: Uint8Array, a: { x: number; y: number }, b: { x: number; y: number }, r = 1.5) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  for (let s = 0; s <= len; s += 0.5) {
    const [px, py] = [a.x + ((b.x - a.x) * s) / len, a.y + ((b.y - a.y) * s) / len];
    for (let y = Math.floor(py - r); y <= py + r; y++)
      for (let x = Math.floor(px - r); x <= px + r; x++)
        if (Math.hypot(x + 0.5 - px, y + 0.5 - py) <= r) mask[y * n + x] = 1;
  }
};
const base = new Uint8Array(n * n);
for (let c = 0; c < n * n; c++) base[c] = t.world.food[c]!;
// (1) The MST of the 33.
const m1 = base.slice();
for (const l of tree33.links) draw(m1, t.cities[set33[l.a]!]!, t.cities[set33[l.b]!]!);
const net1 = network(m1, n, n, t.cities);
console.log('MST 33:', JSON.stringify(measures(net1, t.cities, set33)), 'links raw', net1.links.length);
// (2) The MST of the 36, measured on the 33 and on the 36.
const m2 = base.slice();
for (const l of tree36.links) draw(m2, t.cities[l.a]!, t.cities[l.b]!);
const net2 = network(m2, n, n, t.cities);
console.log('MST 36 on 36:', JSON.stringify(measures(net2, t.cities, set36)));
console.log('MST 36 on 33:', JSON.stringify(measures(net2, t.cities, set33)));
// (3) MST of 33 plus three extra links that close loops.
const m3 = m1.slice();
const by = (name: string) => t.cities.find((c) => c.name === name)!;
draw(m3, by('Mito'), by('Choshi'));
draw(m3, by('Odawara'), by('Hachioji'));
draw(m3, by('Tateyama'), by('Katsuura'));
const net3 = network(m3, n, n, t.cities);
console.log('MST 33 + 3 links:', JSON.stringify(measures(net3, t.cities, set33)));
const show = new Float32Array(n * n);
for (let c = 0; c < n * n; c++) show[c] = m3[c]!;
writePng(
  `${OUT}tokyo-world.png`,
  n,
  n,
  picture(t.world, show, 1, [255, 220, 90], [{ cells: t.land, colour: [60, 90, 140] }]),
  2,
);
console.log(t.cities.map((c) => c.name).join(' '));
