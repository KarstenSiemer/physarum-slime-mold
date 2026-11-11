// The scent view (ADR 0009, amendments of 2026-11-11): the food scent and the light repellent over the picture, as a
// glow per layer that fades out as the scent gets weaker, on a fixed logarithmic scale, and one line where the food
// scent weighs as much as the trail of a strand. Display only. render.wgsl and gl/glsl/render.frag hold the same
// numbers (`scentView`); the legend (ui/ScentLegend.svelte) and the GPU tests take them from here.
import { MAX_STRAINS, type Settings, type Style } from '../model/params';
import { trailSaturation } from './pack';

/** log10 of the lowest level drawn: 0.01. Below it the glow is 0. */
export const SCENT_LOW = -2;
/** Powers of ten from 0.01 to the top of the glow, 10,000. From there up the glow stays at SCENT_GLOW. */
export const SCENT_TOP = 6;
/** Opacity of the glow at 10,000 and more. */
export const SCENT_GLOW = 0.45;
/** Opacity of the line at the mark (scentMark()). */
export const SCENT_LINE = 0.8;
/**
 * The glow over paper, times this: over a light colour the same opacity shows less. An opacity of 0.1 took the paper's
 * red from 243 to 232 of 255, and the green of the glow's background from 6 to 76 (agents: 0 to 75).
 */
export const SCENT_PAPER_FILL = 1.5;
/** Powers of ten per pixel below which the scent counts as flat. */
export const SCENT_FLAT = 1e-4;
/** The coarsest map the view reads when zoomed out (scentLevel()). */
export const SCENT_LEVELS_MAX = 3;

/** The levels the legend names: 0.01, 0.1, …, 10,000. */
export const SCENT_LEVELS = Array.from({ length: SCENT_TOP + 1 }, (_, i) => 10 ** (SCENT_LOW + i));

/**
 * The map the view reads at `scale` cells per pixel: 0 is the grid, k from 1 to SCENT_LEVELS_MAX a map of
 * cells over 2^k per side (scentLevelSize()). From 2 cells per pixel a pixel then reads texels next to those of the
 * pixels beside it: 4 cells far apart missed the cache (ADR 0009, amendment 2026-11-11).
 */
export function scentLevel(scale: number): number {
  return Math.min(SCENT_LEVELS_MAX, Math.max(0, Math.floor(Math.log2(scale))));
}

/** Texels per side of the map of level k: the grid side over 2^k, rounded up. */
export const scentLevelSize = (side: number, k: number) => (side + (1 << k) - 1) >> k;

type Rgb = readonly [number, number, number];

/**
 * Linear RGB of the glow and the line of the food scent, and of the glow of the repellent: OKLCH hue 145 (green) for
 * food, 340 (pink) for the repellent, away from the strain palette (hues 24, 85, 201, 294), the oat flake and the
 * walls. Light colours over the dark styles, dark ones over paper. Lightness and chroma: food 0.80 / 0.18 and its line
 * 0.90 / 0.14 (paper 0.55 / 0.15 and 0.42 / 0.12), repellent 0.74 / 0.19 (paper 0.52 / 0.19).
 */
export const SCENT_COLOURS: Record<'dark' | 'paper', { food: Rgb; line: Rgb; repellent: Rgb }> = {
  dark: { food: [0.1383, 0.7091, 0.1623], line: [0.3553, 0.9273, 0.3684], repellent: [0.9216, 0.1742, 0.6301] },
  paper: { food: [0.0207, 0.2429, 0.033], line: [0.0063, 0.1096, 0.0124], repellent: [0.4023, 0.024, 0.2555] },
};

export const scentColours = (style: Style) => SCENT_COLOURS[style === 'paper' ? 'paper' : 'dark'];

/**
 * The opacity of the glow for a scent `value`: 0 at 0.01, rising in a straight line with log10(value) to SCENT_GLOW
 * at 10,000, and SCENT_GLOW above it. A straight line in log10 gives every power of ten the same step of opacity, so
 * the glow fades out evenly toward 0.01 and has no edge there.
 */
export function scentGlow(value: number): number {
  if (!(value > 0)) return 0;
  return SCENT_GLOW * Math.min(Math.max((Math.log10(value) - SCENT_LOW) / SCENT_TOP, 0), 1);
}

/**
 * The opacity of the line where the food scent `value`, whose gradient has the length `slope` (per cell), equals
 * `mark`, at `scale` cells per pixel: about one pixel wide, from the distance to the mark in pixels.
 */
export function scentLine(value: number, slope: number, scale: number, mark: number): number {
  if (!(value > 0) || !(mark > 0)) return 0;
  const dt = Math.max((slope * scale) / (value * Math.LN10), SCENT_FLAT); // powers of ten per pixel
  return (1 - smoothstep(0.25, 1.25, Math.abs(Math.log10(value / mark)) / dt)) * SCENT_LINE;
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The mark: the food scent that weighs as much in a sensor as the trail of a strand (agents.wgsl `sense()`: a strain
 * reads `attraction · trail + food · scent`). `strand` is the trail of a strand: the summed trail that the auto levels
 * draw at full strength, their 99th percentile (Levels.strand). With trail saturation K, a sensor reads it as
 * strand / (1 + strand / K). The Jones model weighs food as the strain's own trail, so there the mark is the strand
 * itself. With several strains it is the lowest mark of the strains that follow their own trail and food: where food
 * outweighs a strand for at least one of them. 0: no mark (no strand measured, or no strain follows food).
 */
export function scentMark(s: Pick<Settings, 'model' | 'strains' | 'trailSaturation'>, strand: number): number {
  if (!(strand > 0)) return 0;
  const k = trailSaturation(s);
  const trail = k > 0 ? strand / (1 + strand / k) : strand;
  let mark = Infinity;
  s.strains.slice(0, MAX_STRAINS).forEach((st, i) => {
    const self = st.attraction[i] ?? 0;
    const food = s.model === 'jones' ? self : st.food;
    if (self > 0 && food > 0) mark = Math.min(mark, (self * trail) / food);
  });
  return Number.isFinite(mark) ? mark : 0;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * The view over linear colour `c`: the glow of the food scent, its line at the mark, then the glow of the repellent.
 * `food` and `repellent` are opacities of the glow (scentGlow()), `line` the line's (scentLine()); over paper the glow
 * is SCENT_PAPER_FILL times as opaque.
 */
export function scentOver(c: Rgb, style: Style, food: number, line: number, repellent: number): Rgb {
  const k = scentColours(style);
  const fill = style === 'paper' ? SCENT_PAPER_FILL : 1;
  return mix(mix(mix(c, k.food, food * fill), k.line, line), k.repellent, repellent * fill);
}
