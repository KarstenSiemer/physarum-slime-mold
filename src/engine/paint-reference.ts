// CPU mirror of shaders/paint.wgsl and gl/glsl/paint.frag, for tests only. sim.gpu.test.ts checks it against both
// backends; the engine tests in Node paint with it (engine-env.test.ts).
import type { Boundary } from '../model/params';
import { cellIndex, lightByte, segmentDistance } from './brush';
import { EnvKind, isPole, POLE_BYTE, type Stroke } from './types';

/**
 * Calls `visit` for every cell in the footprint of a stroke on a `w` × `h` grid, with the index of the cell and its
 * distance to the segment: a cell inside the arena of the stroke's boundary, or else of `boundary`, whose centre lies
 * within the radius of the segment. This is the rule of every kind of stroke in both paint passes (shaders/brush.wgsl
 * `strokeDistance` and `boxCell`, gl/glsl/brush.glsl). On a periodic grid a cell comes once for each of its copies
 * within the radius. `margin` (optional) receives the smallest |distance − radius| over the cells looked at: float32
 * on the GPU may round a cell that close to the brush edge the other way.
 */
export function strokeCells(
  w: number,
  h: number,
  stroke: Stroke,
  boundary: Boundary,
  visit: (cell: number, d: number) => void,
  margin?: { min: number },
) {
  const { from: a, to: b, radius: r } = stroke;
  const under = stroke.boundary ?? boundary;
  const x1 = Math.ceil(Math.max(a[0], b[0]) + r);
  const y1 = Math.ceil(Math.max(a[1], b[1]) + r);
  for (let y = Math.floor(Math.min(a[1], b[1]) - r); y <= y1; y++)
    for (let x = Math.floor(Math.min(a[0], b[0]) - r); x <= x1; x++) {
      const c = cellIndex(x, y, w, h, under);
      if (c < 0) continue;
      const d = segmentDistance(x + 0.5, y + 0.5, a, b);
      if (margin) margin.min = Math.min(margin.min, Math.abs(d - r));
      if (d <= r) visit(c, d);
    }
}

/**
 * Paints one stroke into `env` (4 bytes per cell: wall, food, light, electrode, as Sim.readEnv() returns them),
 * under the stroke's boundary or else `boundary`. A stroke of the Slime tool changes no byte: it writes only into the
 * slime field (slime-reference.ts slimePaint(), ADR 0055). `margin`: as for strokeCells().
 */
export function paintReference(
  env: Uint8Array,
  w: number,
  h: number,
  stroke: Stroke,
  boundary: Boundary,
  margin?: { min: number },
) {
  const kind = EnvKind[stroke.kind];
  const paint = (c: number, d: number) => {
    const i = c * 4;
    if (kind === EnvKind.erase) env.fill(0, i, i + 4);
    else if (kind === EnvKind.wall) env.set([255, 0, 0, 0], i);
    else if (kind === EnvKind.food) env[i + 1] = 255;
    else if (isPole(stroke.kind)) env[i + 3] = POLE_BYTE[stroke.kind];
    else if (kind === EnvKind.light) env[i + 2] = Math.max(env[i + 2] ?? 0, lightByte(d, stroke.radius));
  };
  strokeCells(w, h, stroke, boundary, paint, margin);
}
