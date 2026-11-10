// CPU mirror of shaders/paint.wgsl and gl/glsl/paint.frag, for tests only. sim.gpu.test.ts checks it against both
// backends; the engine tests in Node paint with it (engine-env.test.ts).
import type { Boundary } from '../model/params';
import { EnvKind, type Stroke } from './types';

function segmentDistance(px: number, py: number, a: [number, number], b: [number, number]) {
  const [abx, aby] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.min(1, Math.max(0, ((px - a[0]) * abx + (py - a[1]) * aby) / Math.max(abx * abx + aby * aby, 1e-6)));
  return Math.hypot(px - a[0] - t * abx, py - a[1] - t * aby);
}

/** Index of a cell, wrapped for the periodic boundary, or −1 outside a closed arena (common.wgsl `cellAt`). */
export function cellIndex(x: number, y: number, w: number, h: number, boundary: Boundary) {
  if (boundary === 'wrap') return (((y % h) + h) % h) * w + (((x % w) + w) % w);
  if (x < 0 || y < 0 || x >= w || y >= h) return -1;
  if (boundary === 'dish' && Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) > Math.min(w, h) / 2 - 1) return -1;
  return y * w + x;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Paints one stroke into `env` (4 bytes per cell: wall, food, light, unused, as Sim.readEnv() returns them),
 * under the stroke's boundary or else `boundary`. `margin` (optional) receives the smallest |distance − radius|
 * over the cells looked at: float32 on the GPU may round a cell that close to the brush edge the other way.
 */
export function paintReference(
  env: Uint8Array,
  w: number,
  h: number,
  stroke: Stroke,
  boundary: Boundary,
  margin?: { min: number },
) {
  const { from: a, to: b, radius: r } = stroke;
  const kind = EnvKind[stroke.kind];
  const under = stroke.boundary ?? boundary;
  const x1 = Math.ceil(Math.max(a[0], b[0]) + r);
  const y1 = Math.ceil(Math.max(a[1], b[1]) + r);
  for (let y = Math.floor(Math.min(a[1], b[1]) - r); y <= y1; y++)
    for (let x = Math.floor(Math.min(a[0], b[0]) - r); x <= x1; x++) {
      const c = cellIndex(x, y, w, h, under);
      if (c < 0) continue;
      const d = segmentDistance(x + 0.5, y + 0.5, a, b);
      if (margin) margin.min = Math.min(margin.min, Math.abs(d - r));
      if (d > r) continue;
      const i = c * 4;
      if (kind === EnvKind.erase) env.fill(0, i, i + 4);
      else if (kind === EnvKind.wall) env.set([255, 0, 0, 0], i);
      else if (kind === EnvKind.food) env[i + 1] = 255;
      else env[i + 2] = Math.max(env[i + 2] ?? 0, Math.floor(0.5 + 255 * smoothstep(r, 0.3 * r, d)));
    }
}
