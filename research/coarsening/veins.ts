// The veins of the masks that coarsen.gpu.test.ts wrote (out/masks/): one line per mask with the number of veins,
// their mean length and the degrees of the junctions. The graph comes from the skeleton code of the Tokyo measures
// (research/flow/prototype/tokyo.ts: Zhang–Suen thinning, junctions, chains); veins() of measure.ts cuts the loose
// ends off.
// Usage: node --import ./research/flow/register.mjs research/coarsening/veins.ts <label> [folder of the masks]
// It writes research/coarsening/out/veins-<label>.jsonl.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { network } from '../flow/prototype/tokyo.ts';
import { maskOfText, veins } from './measure.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const label = process.argv[2] ?? 'coarsen-webgpu';
const dir = process.argv[3] ?? join(HERE, 'out', 'masks');
// A fixed pattern, and the label compared as text: the label comes from the command line.
const name = /^(.+)-so(\d+)-s(\d+)-(\d+)\.b64$/;
const files = readdirSync(dir)
  .map((f) => ({ f, m: name.exec(f) }))
  .filter((x) => x.m?.[1] === label)
  .map(({ f, m }) => ({ f, so: Number(m?.[2]), seed: Number(m?.[3]), step: Number(m?.[4]) }))
  .sort((a, b) => a.so - b.so || a.seed - b.seed || a.step - b.step);
const round = (v: number) => Math.round(v * 100) / 100;
const lines: string[] = [];
for (const { f, so, seed, step } of files) {
  const text = readFileSync(join(dir, f), 'utf8');
  const cells = Buffer.from(text, 'base64').length * 8;
  const side = Math.round(Math.sqrt(cells));
  const mask = maskOfText(text, cells);
  let av = 0;
  for (const m of mask) av += m;
  const { lengths, degrees } = veins(network(mask, side, side, []).links);
  const total = lengths.reduce((s, l) => s + l, 0);
  // The degrees of the junctions as counts: k3 junctions with three veins, and so on.
  const k: Record<string, number> = {};
  for (const d of degrees) k[`k${String(d)}`] = (k[`k${String(d)}`] ?? 0) + 1;
  const mean = round(total / Math.max(1, lengths.length));
  lines.push(JSON.stringify({ so, seed, step, av, veins: lengths.length, length: round(total), mean, ...k }));
}
writeFileSync(join(HERE, 'out', `veins-${label}.jsonl`), lines.join('\n') + '\n');
console.log(`${String(lines.length)} masks -> out/veins-${label}.jsonl`);
