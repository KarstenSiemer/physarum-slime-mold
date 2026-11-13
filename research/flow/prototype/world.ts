// The grid of a scene as the app paints it, geodesic distances, zones and PNG output. Prototype code, not for the app.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fromShape, strokeOn } from '../../../src/engine/environment.ts';
import { paintReference } from '../../../src/engine/paint-reference.ts';
import type { EnvShape } from '../../../src/model/presets.ts';

export type Boundary = 'wrap' | 'box' | 'dish';

export interface World {
  w: number;
  h: number;
  boundary: Boundary;
  /** 1 where an agent can be and trail can lie: inside the arena and no wall. */
  open: Uint8Array;
  wall: Uint8Array;
  food: Uint8Array;
  light: Uint8Array;
  /** Chebyshev distance to the nearest wall cell or cell outside the arena, capped at 255. */
  clear: Uint8Array;
  /** Centre cell of each food shape, in the order of the shapes. */
  sites: { x: number; y: number; r: number }[];
}

const DISH_FILL = 0.945;

export function buildWorld(w: number, h: number, boundary: Boundary, shapes: readonly EnvShape[]): World {
  const env = new Uint8Array(w * h * 4);
  const sites: World['sites'] = [];
  for (const shape of shapes) {
    const st = strokeOn(fromShape(shape, boundary), w, h);
    if (!st) continue;
    paintReference(env, w, h, st, boundary);
    if (shape.kind === 'food') sites.push({ x: st.from[0], y: st.from[1], r: st.radius });
  }
  const n = w * h;
  const [open, wall, food, light] = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  const R = DISH_FILL * 0.5 * Math.min(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      const inside = boundary !== 'dish' || Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) <= R;
      wall[c] = inside && env[c * 4]! >= 128 ? 1 : 0;
      open[c] = inside && !wall[c] ? 1 : 0;
      food[c] = open[c] && env[c * 4 + 1]! > 0 ? 1 : 0;
      light[c] = open[c] ? env[c * 4 + 2]! : 0;
    }
  return { w, h, boundary, open, wall, food, light, clear: clearance(w, h, open), sites };
}

/** Chebyshev distance of every cell to the nearest cell that is not open (two chamfer passes are exact for it). */
function clearance(w: number, h: number, open: Uint8Array): Uint8Array {
  const d = new Uint8Array(w * h);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!open[y * w + x]) continue;
      const m = Math.min(at(x - 1, y), at(x - 1, y - 1), at(x, y - 1), at(x + 1, y - 1));
      d[y * w + x] = Math.min(255, m + 1);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      if (!open[y * w + x]) continue;
      const m = Math.min(at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1));
      d[y * w + x] = Math.min(d[y * w + x]!, Math.min(255, m + 1));
    }
  return d;
}

/**
 * Geodesic distance through open cells from the cells in `seeds` (8 neighbours, diagonals cost sqrt 2, no corner
 * cutting through walls). Infinity where no way leads.
 */
export function geodesic(world: World, seeds: number[], passable: (c: number) => boolean = (c) => !!world.open[c]) {
  const { w, h } = world;
  const dist = new Float64Array(w * h).fill(Infinity);
  // Dijkstra with a binary heap of [distance, cell].
  const heapD: number[] = [];
  const heapC: number[] = [];
  const push = (d: number, c: number) => {
    let i = heapD.length;
    heapD.push(d);
    heapC.push(c);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapD[p]! <= d) break;
      heapD[i] = heapD[p]!;
      heapC[i] = heapC[p]!;
      i = p;
    }
    heapD[i] = d;
    heapC[i] = c;
  };
  const pop = (): [number, number] => {
    const d0 = heapD[0]!;
    const c0 = heapC[0]!;
    const d = heapD.pop()!;
    const c = heapC.pop()!;
    const n = heapD.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let k = 2 * i + 1;
        if (k >= n) break;
        if (k + 1 < n && heapD[k + 1]! < heapD[k]!) k++;
        if (heapD[k]! >= d) break;
        heapD[i] = heapD[k]!;
        heapC[i] = heapC[k]!;
        i = k;
      }
      heapD[i] = d;
      heapC[i] = c;
    }
    return [d0, c0];
  };
  for (const s of seeds)
    if (passable(s)) {
      dist[s] = 0;
      push(0, s);
    }
  const SQ = Math.SQRT2;
  while (heapD.length > 0) {
    const [d, c] = pop();
    if (d > dist[c]!) continue;
    const x = c % w;
    const y = (c - x) / w;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const [nx, ny] = [x + dx, y + dy];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nc = ny * w + nx;
        if (!passable(nc)) continue;
        if (dx !== 0 && dy !== 0 && (!passable(y * w + nx) || !passable(ny * w + x))) continue;
        const through = d + (dx !== 0 && dy !== 0 ? SQ : 1);
        if (through < dist[nc]!) {
          dist[nc] = through;
          push(through, nc);
        }
      }
  }
  return dist;
}

/** The cells of a food site: food cells within its radius (plus one cell). */
export function siteCells(world: World, k: number): number[] {
  const s = world.sites[k]!;
  const out: number[] = [];
  const r = Math.ceil(s.r + 1);
  for (let y = Math.floor(s.y - r); y <= s.y + r; y++)
    for (let x = Math.floor(s.x - r); x <= s.x + r; x++) {
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
      const c = y * world.w + x;
      if (world.food[c] && Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) <= s.r + 1) out.push(c);
    }
  return out;
}

export const centreCell = (world: World, k: number) =>
  Math.floor(world.sites[k]!.y) * world.w + Math.floor(world.sites[k]!.x);

// --- PNG -------------------------------------------------------------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}

/** Writes an RGB image (3 bytes per pixel, rows from the top). */
export function writePng(path: string, w: number, h: number, rgb: Uint8Array, scale = 1) {
  const [W, H] = [w * scale, h * scale];
  const raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const sy = Math.floor(y / scale);
    let o = y * (1 + W * 3) + 1;
    for (let x = 0; x < W; x++) {
      const i = (sy * w + Math.floor(x / scale)) * 3;
      raw[o++] = rgb[i]!;
      raw[o++] = rgb[i + 1]!;
      raw[o++] = rgb[i + 2]!;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  writeFileSync(path, Buffer.concat(parts));
}

/**
 * A picture of a field over the world: the field in `colour` on black, scaled so that `white` is full; walls grey,
 * food green, and optional overlay cells.
 */
export function picture(
  world: World,
  field: ArrayLike<number>,
  white: number,
  colour: [number, number, number] = [255, 220, 90],
  overlay?: { cells: ArrayLike<number>; colour: [number, number, number] }[],
): Uint8Array {
  const { w, h } = world;
  const rgb = new Uint8Array(w * h * 3);
  for (let c = 0; c < w * h; c++) {
    const v = Math.min(1, Math.max(0, field[c]! / white)) ** 0.6;
    let [r, g, b] = [colour[0] * v, colour[1] * v, colour[2] * v];
    if (world.wall[c]) [r, g, b] = [90, 90, 100];
    else if (!world.open[c]) [r, g, b] = [25, 25, 30];
    else if (world.food[c]) [r, g, b] = [Math.max(r, 40), Math.max(g, 150), Math.max(b, 60)];
    rgb[c * 3] = r;
    rgb[c * 3 + 1] = g;
    rgb[c * 3 + 2] = b;
  }
  for (const o of overlay ?? [])
    for (let c = 0; c < w * h; c++)
      if (o.cells[c]) {
        rgb[c * 3] = Math.min(255, rgb[c * 3]! * 0.6 + o.colour[0] * 0.4);
        rgb[c * 3 + 1] = Math.min(255, rgb[c * 3 + 1]! * 0.6 + o.colour[1] * 0.4);
        rgb[c * 3 + 2] = Math.min(255, rgb[c * 3 + 2]! * 0.6 + o.colour[2] * 0.4);
      }
  return rgb;
}
