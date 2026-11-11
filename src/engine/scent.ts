// The scent view (ADR 0009, amendment 2026-11-11): the food scent and the light repellent over the picture, on a
// fixed logarithmic scale. Display only. render.wgsl and gl/glsl/render.frag hold the same numbers (`scentView`); the
// legend (ui/ScentLegend.svelte) and the GPU tests take them from here.
import type { Style } from '../model/params';

/** log10 of the lowest level drawn: 0.01. Below it the view draws nothing. */
export const SCENT_LOW = -2;
/** Bands of one power of ten each, from 10^SCENT_LOW up. The last one holds everything from 10^(LOW + BANDS − 1). */
export const SCENT_BANDS = 7;
/** Opacity of the first band, and what each band above it adds. */
export const SCENT_FILL = [0.1, 0.05] as const;
/** Opacity of the line at each power of ten. */
export const SCENT_LINE = 0.75;
/**
 * The fill over paper, times this: over a light colour the same opacity shows less (the first band took the paper
 * from 243 to 232 of 255, against 0 to 63 over the glow's black).
 */
export const SCENT_PAPER_FILL = 1.5;

type Rgb = readonly [number, number, number];

/**
 * Linear RGB of the fill and the line of each layer: OKLCH hue 145 (green) for food, 340 (pink) for the repellent,
 * away from the strain palette (hues 24, 85, 201, 294), the oat flake and the walls. Light colours over the dark
 * styles, dark ones over paper.
 */
export const SCENT_COLOURS: Record<'dark' | 'paper', { food: [Rgb, Rgb]; repellent: [Rgb, Rgb] }> = {
  dark: {
    food: [
      [0.1383, 0.7091, 0.1623],
      [0.3553, 0.9273, 0.3684],
    ],
    repellent: [
      [0.9216, 0.1742, 0.6301],
      [0.9316, 0.4403, 0.7387],
    ],
  },
  paper: {
    food: [
      [0.0207, 0.2429, 0.033],
      [0.0063, 0.1096, 0.0124],
    ],
    repellent: [
      [0.4023, 0.024, 0.2555],
      [0.1955, 0.0055, 0.1219],
    ],
  },
};

export const scentColours = (style: Style) => SCENT_COLOURS[style === 'paper' ? 'paper' : 'dark'];

/** The levels at the edges of the bands: 0.01, 0.1, …, 10,000. */
export const SCENT_LEVELS = Array.from({ length: SCENT_BANDS }, (_, i) => 10 ** (SCENT_LOW + i));

/** ∫₀ˣ clamp(floor(u), 0, BANDS − 1) du: the band count, integrated, for the filter over a pixel. */
function stairs(x: number): number {
  const top = SCENT_BANDS - 1;
  const y = Math.min(Math.max(x, 0), top);
  const n = Math.floor(y);
  return y * n - 0.5 * n * (n + 1) + top * Math.max(x - top, 0);
}

/**
 * The opacity of the fill and of the line for a scent `value` whose gradient has the length `slope` (per cell), at
 * `scale` cells per pixel. The fill rises by one step per band; it is filtered over the pixel, so where the bands lie
 * closer than a pixel it shows their mean, and the lines fade out where they lie closer than 4 pixels. The passes take
 * the value and the gradient from one bilinear lookup of the scent at the pixel centre, also when zoomed out: the
 * scent is smooth over cells, and this filter does what the four taps of the trail do against aliasing.
 */
export function scentBands(value: number, slope: number, scale: number): [number, number] {
  if (!(value > 0)) return [0, 0];
  const t = Math.log10(value) - SCENT_LOW;
  const dt = Math.max((slope * scale) / (value * Math.LN10), 1e-3); // powers of ten per pixel
  const enter = Math.min(Math.max(t / dt + 0.5, 0), 1);
  const steps = (stairs(t + 0.5 * dt) - stairs(t - 0.5 * dt)) / dt;
  const fill = SCENT_FILL[0] * enter + SCENT_FILL[1] * steps;
  const k = Math.min(Math.max(Math.round(t), 0), SCENT_BANDS - 1);
  const d = Math.abs(t - k) / dt;
  const line = (1 - smoothstep(0.25, 1.25, d)) * (1 - smoothstep(0.25, 0.5, dt)) * SCENT_LINE;
  return [fill, line];
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * The view over linear colour `c`: the food layer, then the repellent, each its fill and then its line. `food` and
 * `repellent` are [opacity of the fill, opacity of the line] (scentBands()); over paper the fill is SCENT_PAPER_FILL
 * times as opaque.
 */
export function scentOver(
  c: Rgb,
  style: Style,
  food: readonly [number, number],
  repellent: readonly [number, number],
): Rgb {
  const k = scentColours(style);
  const fill = style === 'paper' ? SCENT_PAPER_FILL : 1;
  let o = mix(c, k.food[0], food[0] * fill);
  o = mix(o, k.food[1], food[1]);
  o = mix(o, k.repellent[0], repellent[0] * fill);
  return mix(o, k.repellent[1], repellent[1]);
}
