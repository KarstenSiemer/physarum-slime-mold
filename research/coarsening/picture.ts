// A picture of a dump of coarsen.gpu.test.ts: a trail (out/trails/*.f32.b64) or a vein mask (out/masks/*.b64), as a
// PNG beside the dump. To look at a run; no number of the record comes from here.
// Usage: node --import ./research/flow/register.mjs research/coarsening/picture.ts <file>... [--level=0.5]
import { readFileSync } from 'node:fs';
import { writePng } from '../flow/prototype/world.ts';
import { LEVEL, maskOfText, veinMask } from './measure.ts';

const args = process.argv.slice(2);
const level = Number(args.find((a) => a.startsWith('--level='))?.slice(8) ?? LEVEL);
for (const file of args.filter((a) => !a.startsWith('--'))) {
  const text = readFileSync(file, 'utf8');
  const isTrail = file.endsWith('.f32.b64');
  const trail = isTrail ? new Float32Array(new Uint8Array(Buffer.from(text, 'base64')).buffer) : undefined;
  const cells = trail ? trail.length : Buffer.from(text, 'base64').length * 8;
  const side = Math.round(Math.sqrt(cells));
  // The scene deposits 5 per move, and the level is in deposits.
  const mask = trail ? veinMask(trail, cells, level * 5, 1) : maskOfText(text, cells);
  const rgb = new Uint8Array(cells * 3);
  for (let c = 0; c < cells; c++) {
    // Left of the trail's picture: the trail, white at two deposits. The mask is drawn in white on black.
    const v = trail ? Math.min(255, Math.round(((trail[c] ?? 0) / 10) ** 0.6 * 255)) : mask[c] ? 255 : 0;
    rgb.set(trail && mask[c] ? [v, v, 255] : [v, v, v], c * 3);
  }
  writePng(file.replace(/\.b64$/, '.png'), side, side, rgb, 2);
  console.log(file.replace(/\.b64$/, '.png'));
}
