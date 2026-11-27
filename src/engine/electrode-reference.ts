// CPU mirror of the view of the electrodes (shaders/render.wgsl and gl/glsl/render.frag, `studAt` and `electrodes`;
// ADR 0058), for tests only: electrode.gpu.test.ts checks the picture of both backends against it. It reads the
// outline distances of the poles as Sim.readPoles() returns them and rebuilds each outline with outlineAt().
import type { Settings } from '../model/params';
import { coverOf, outlineAt, type OutlineGrid } from './outline-reference';

export type Rgb = [number, number, number];

/** The colour of each pole, linear RGB: the cathode blue, the anode red (CATHODE and ANODE in render.wgsl). */
export const POLE_COLOR = { cathode: [0.05, 0.32, 1], anode: [1, 0.08, 0.04] } as const satisfies Record<string, Rgb>;
/** Cells: the slope of a pole, from its outline to its flat top (POLE_RIM in render.wgsl and paint.wgsl). */
export const POLE_RIM = 1.5;
/** Cells that the shadow of a pole reaches beside its outline (POLE_SHADOW in render.wgsl). */
export const POLE_SHADOW = 2;
/** How dark the shadow of a pole is at its outline, per style: as the shadow of a wall (`walls` in render.wgsl). */
export const POLE_SHADE: Record<Settings['style'], number> = { glow: 0.75, agents: 0.75, gel: 0.6, paper: 0.3 };

const norm = (v: Rgb): Rgb => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: Rgb, b: Rgb) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [0, 1, 2].map((k) => (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * t) as Rgb;

/** Toward the light of the picture: top left, as for the gel and the walls (SUN in render.wgsl). Grid y points down. */
export const SUN = norm([-0.45, -0.6, 0.65]);
const HALF = norm([SUN[0], SUN[1], SUN[2] + 1]);
const SUN_XY = ((l) => [SUN[0] / l, SUN[1] / l] as const)(Math.hypot(SUN[0], SUN[1]));

/** A pole at a point: its lit surface, how much of the pixel it covers, and its shadow on what lies beside it. */
export interface Stud {
  color: Rgb;
  cover: number;
  shadow: number;
}

/**
 * The stud of the colour `base` at a point (render.wgsl `studAt`). `sd`: the distance to its outline in cells,
 * positive inside. `coverSd`: the same for the coverage. `grad`: the gradient of `sd` (outlineAt()). `scale`: the
 * cells per pixel of the view.
 *
 *  - It covers the pixel by a ramp one pixel wide across the outline.
 *  - The surface is a dome over the outer POLE_RIM cells: its height rises as t (2 − t), with t the share of the rim
 *    that lies behind. So its slope is 2 (1 − t) / POLE_RIM: steepest at the outline, and 0 from the rim on, where
 *    the top is flat. The light: the colour times 0.5 + 0.7 × diffuse, plus a highlight of 0.6 × shine^60.
 *  - A dark line along the outline: the colour goes toward a quarter of itself, by 0.6 at the outline and by nothing
 *    1.5 pixels inside it; that width is at least 0.35 cells and at most 0.75 cells.
 *  - The shadow lies outside the outline, on the side away from the light: full at the outline, gone POLE_SHADOW
 *    cells from it, times the cosine between the gradient and the direction of the light on the ground.
 */
export function studAt(base: Rgb, sd: number, coverSd: number, grad: readonly [number, number], scale: number): Stud {
  const cover = coverOf(coverSd, scale);
  const toLight = clamp(grad[0] * SUN_XY[0] + grad[1] * SUN_XY[1], 0, 1);
  const shadow = smoothstep(-POLE_SHADOW, 0, sd) * toLight * (1 - cover);
  if (cover <= 0) return { color: [0, 0, 0], cover, shadow };
  const t = clamp(sd / POLE_RIM, 0, 1);
  const rise = (2 * (1 - t)) / POLE_RIM;
  const n = norm([-grad[0] * rise, -grad[1] * rise, 1]);
  const diffuse = Math.max(dot(n, SUN), 0);
  const spec = Math.max(dot(n, HALF), 0) ** 60;
  const lit = base.map((v) => v * (0.5 + 0.7 * diffuse) + 0.6 * spec) as Rgb;
  const line = 1 - smoothstep(0, clamp(1.5 * scale, 0.35, 0.75), sd);
  return { color: mix(lit, base.map((v) => 0.25 * v) as Rgb, 0.6 * line), cover, shadow };
}

/** What the view draws of the electrodes at a point. */
export interface PoleSample {
  /** A pole lies within the reach of the outline distances: a byte of the 3 × 3 cells around the point is above 0. */
  near: boolean;
  cathode: Stud;
  anode: Stud;
  /** The share of the pixel that the two poles cover together, at most 1. */
  cover: number;
  /** The colour of the poles where they cover the pixel: each pole by its share. */
  surface: Rgb;
  /** The share of its light that the ground beside a pole keeps under the shadow. */
  lit: number;
}

/**
 * The electrodes at the grid position (px, py), in cells (render.wgsl `electrodes`). `poles`: the outline distances
 * of the electrodes, 4 bytes per cell as Sim.readPoles() returns them. `scale`: the cells per pixel of the view. A
 * cell holds one pole, so the two outlines never cross: where they meet, each pole covers its share of the pixel.
 */
export function polesAt(
  poles: Uint8Array,
  grid: OutlineGrid,
  px: number,
  py: number,
  scale: number,
  style: Settings['style'],
): PoleSample {
  const { layers, near } = outlineAt(poles, grid, px, py);
  const none: Stud = { color: [0, 0, 0], cover: 0, shadow: 0 };
  if (!near) return { near, cathode: none, anode: none, cover: 0, surface: [0, 0, 0], lit: 1 };
  const [c, a] = layers;
  const cathode = studAt([...POLE_COLOR.cathode], c.sd, c.coverSd, c.grad, scale);
  const anode = studAt([...POLE_COLOR.anode], a.sd, a.coverSd, a.grad, scale);
  const both = cathode.cover + anode.cover;
  const surface: Rgb =
    both > 0
      ? ([0, 1, 2].map(
          (k) => (cathode.cover * (cathode.color[k] ?? 0) + anode.cover * (anode.color[k] ?? 0)) / both,
        ) as Rgb)
      : [0, 0, 0];
  const lit = 1 - POLE_SHADE[style] * Math.max(cathode.shadow, anode.shadow);
  return { near, cathode, anode, cover: Math.min(both, 1), surface, lit };
}

/**
 * The picture `below` with the electrodes at (px, py) over it, linear RGB (render.wgsl `electrodes`): the shadow of
 * the poles on what lies beside them, then the poles. A pole covers all of what lies below it.
 */
export function electrodesOver(
  below: Rgb,
  poles: Uint8Array,
  grid: OutlineGrid,
  px: number,
  py: number,
  scale: number,
  style: Settings['style'],
): Rgb {
  const s = polesAt(poles, grid, px, py, scale, style);
  if (!s.near) return below;
  const ground = below.map((v) => v * s.lit) as Rgb;
  return s.cover > 0 ? mix(ground, s.surface, s.cover) : ground;
}
