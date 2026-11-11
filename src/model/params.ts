// Single source of truth for every parameter: UI controls, URL validation and GPU packing read this.
import type { EnvTool } from '../engine/types';

export const MAX_STRAINS = 4;

export interface Spec {
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  log?: boolean;
  /** Where the parameter comes from, e.g. "Jones 2010, Table 1". */
  ref?: string;
}

export const strainSpec = {
  share: {
    label: 'Population share',
    help: 'Relative number of agents in this strain.',
    min: 0.05,
    max: 1,
    step: 0.05,
  },
  sensorAngle: {
    label: 'Sensor angle',
    unit: '°',
    help: 'Angle between the front sensor and the left/right sensors (SA). Low values give connected networks, high values isolated islands.',
    min: 0,
    max: 180,
    step: 0.5,
    ref: 'Jones 2010, Table 1 and Fig. 13',
  },
  sensorOffset: {
    label: 'Sensor distance',
    unit: 'cells',
    help: 'How far ahead the sensors are (SO). This sets the scale of the pattern: small values give a fine mesh, large values a coarse one.',
    min: 1,
    max: 64,
    step: 0.5,
    ref: 'Jones 2010, Fig. 10',
  },
  rotationAngle: {
    label: 'Rotation angle',
    unit: '°',
    help: 'How far an agent turns toward the strongest sensor in one step (RA). RA larger than SA keeps the network changing; RA = SA lets it settle.',
    min: 0,
    max: 180,
    step: 0.5,
    ref: 'Jones 2010, Fig. 4 and 5',
  },
  stepSize: {
    label: 'Step size',
    unit: 'cells',
    help: 'How far an agent moves in one step (SS).',
    min: 0.1,
    max: 8,
    step: 0.05,
    ref: 'Jones 2010, Table 1',
  },
  deposit: {
    label: 'Deposit',
    help: 'Chemoattractant an agent leaves after a successful move (depT).',
    min: 0,
    max: 50,
    step: 0.5,
    ref: 'Jones 2010, Table 1',
  },
  decay: {
    label: 'Decay',
    help: 'Fraction of the trail that disappears every step (decayT). Low decay gives strong, long-lived gradients. In the Jones model the food scent decays with it, because Jones puts food into the trail map.',
    min: 0.0001,
    max: 0.9,
    step: 0.0001,
    log: true,
    ref: 'Jones 2010, Fig. 12',
  },
  randomTurn: {
    label: 'Random turn',
    help: 'Chance per step that an agent picks a random new heading (pCD).',
    min: 0,
    max: 0.5,
    step: 0.005,
    ref: 'Jones 2010, Table 1',
  },
  food: {
    label: 'Food attraction',
    help: 'How strongly the strain follows the scent of food. Negative values make food repel. Only the extended model has this setting: in the Jones model a strain weighs food as it weighs its own trail.',
    min: -2,
    max: 2,
    step: 0.05,
  },
  light: {
    label: 'Light avoidance',
    help: 'How strongly the strain flees light. Physarum avoids light. Only the extended model has light.',
    min: -2,
    max: 2,
    step: 0.05,
  },
} as const satisfies Record<string, Spec>;

export type StrainKey = keyof typeof strainSpec;

export interface Strain extends Record<StrainKey, number> {
  color: string;
  /** Row of the attraction matrix: weight of each strain's trail (−2 … +2). */
  attraction: number[];
}

export const attractionSpec = {
  label: 'Attraction',
  help: 'How strongly a strain follows (positive) or flees (negative) the trail of another strain. +1 on itself is chemoattraction, −1 chemorepulsion.',
  min: -2,
  max: 2,
  step: 0.05,
  ref: 'Fogleman 2020; Jones 2010, Fig. 15',
} as const satisfies Spec;

export const LAYOUTS = ['mixed', 'bands', 'sectors', 'colonies', 'ring', 'center', 'empty'] as const;
export const BOUNDARIES = ['wrap', 'box', 'dish'] as const;
export const STYLES = ['glow', 'gel', 'paper', 'agents'] as const;
export const RESOLUTIONS = [256, 512, 768, 1024, 1536, 2048, 3072, 4096] as const;
/**
 * A grid of fixed size, width × height cells, that does not follow the screen (ADR 0026). Its sides are those of the
 * grids that gridSize() gives (engine/sizing.ts): 16 to 4096.
 */
export type Lattice = [width: number, height: number];
export const LATTICE_SIDE = { min: 16, max: 4096 } as const;
/** The rule set (ADR 0022): only Jones' published rules, or Jones' rules and this app's additions. */
export const MODELS = ['jones', 'extended'] as const;

export type Layout = (typeof LAYOUTS)[number];
export type Boundary = (typeof BOUNDARIES)[number];
export type Style = (typeof STYLES)[number];
export type Model = (typeof MODELS)[number];

export const globalSpec = {
  density: {
    label: 'Agents per cell',
    help: 'Agents per cell of the grid. In a dish it counts the cells of the square around the dish, as Jones counts his population (%p) over a square lattice that his dish fills. Jones uses 0.03–0.15 (%p 3–15) with one agent per cell; GPU versions without the rule use 1–5.',
    min: 0.01,
    max: 8,
    step: 0.01,
    log: true,
    ref: 'Jones 2010, Table 1 (%p)',
  },
  diffusion: {
    label: 'Diffusion passes',
    help: 'How many 3 × 3 mean filters run per step. Jones uses 1, Fogleman 2; 0 turns diffusion off. The Jones model always runs 1.',
    min: 0,
    max: 4,
    step: 1,
    ref: 'Jones 2010, p. 132',
  },
  foodStrength: {
    label: 'Food strength',
    help: 'Scent that each food cell releases per step (wProj): 255 × this value. In the Jones model the scent spreads and decays like the trail, as food in Jones’ trail map does. In the extended model, Scent decay scales it. With a decay of 0.1 the scent fades within a few cells, so agents find food only when a sensor comes close. In a dense network, food becomes a hub with paths that lead in, and the rest goes on as before. With few agents, higher values pull the network tighter onto the food.',
    min: 0,
    max: 0.5,
    step: 0.005,
    ref: 'Jones 2010, Fig. 17 and 20',
  },
  lightStrength: {
    label: 'Light strength',
    help: 'Only the extended model has light. Each lit cell releases a repellent per step: 255 × this value, scaled with Scent decay. It spreads and fades like the food scent, with the same Scent decay. Jones’ papers have no light that releases a repellent.',
    min: 0,
    max: 0.5,
    step: 0.005,
  },
  // The range of the strain's Decay: the Jones model sets the scent decay to it, and a switch to the extended model
  // keeps it (ADR 0022, decision 26).
  scentDecay: {
    label: 'Scent decay',
    help: 'Only the extended model has this setting: in the Jones model the scent decays with the strain’s Decay. It is the fraction of the food and light scent that disappears every step. Lower values spread the scent farther. At 0.1 the scent falls to a third within 2 cells of a food, and at 0.003 within about 9 cells. Food and light release less at a lower decay. So the scent on a large food stays as strong as at 0.1, and the scent on a small food gets weaker.',
    min: 0.0001,
    max: 0.9,
    step: 0.0001,
    log: true,
  },
  coveredFoodFactor: {
    label: 'Covered food factor',
    help: 'The share of its scent that a food cell releases while an agent covers it, if Covered food releases less is on. Adamatzky and Jones 2010 use 0.001 for food areas. Jones and Adamatzky 2014 use 0.01 for food at a point.',
    min: 0.0001,
    max: 1,
    step: 0.0001,
    log: true,
    ref: 'Adamatzky and Jones 2010; Jones and Adamatzky 2014, Sec. 7.2',
  },
  trailSaturation: {
    label: 'Trail saturation',
    help: 'Only the extended model has this setting. Each sensor reads the trail t of each strain as t / (1 + t / K), with K this value. A trail far above K counts about as much as K, so a weak food scent can still turn an agent on a dense trail. Without food, one strain makes the same turns at every K. With food, most straight paths out of a food then run along the grid axes, because each sensor reads one grid cell. 0 turns it off.',
    min: 0,
    max: 1000,
    step: 1,
  },
  shrink: {
    label: 'Shrinkage',
    help: 'Chance per step that an agent dies. A full sheet then shrinks onto the food, like a starving plasmodium.',
    min: 0,
    max: 0.002,
    step: 0.00001,
    ref: 'Jones 2010, Fig. 21 (0.00025)',
  },
  speed: {
    label: 'Speed',
    unit: 'steps/s',
    help: 'Simulation steps per second (limited by the GPU).',
    min: 1,
    max: 960,
    step: 1,
    log: true,
  },
  exposure: {
    label: 'Exposure',
    unit: 'EV',
    help: 'Brightness offset on top of the automatic exposure.',
    min: -4,
    max: 4,
    step: 0.1,
  },
  bloom: {
    label: 'Glow',
    help: 'Strength of the soft glow around bright filaments.',
    min: 0,
    max: 2,
    step: 0.05,
  },
} as const satisfies Record<string, Spec>;

export type GlobalKey = keyof typeof globalSpec;

/** Help for the model choice (ADR 0022); Learn → Controls lists it with the sliders. */
export const modelHelp = {
  label: 'Model',
  help: 'Jones has only the rules that Jeff Jones published: one strain, one agent per cell, and food in the trail map. Extended adds this app’s rules: several strains, agents that share a cell, light, no diffusion or more diffusion passes, a scent decay of its own, sensors that walls block, a Cut that also removes the trail, and Trail saturation. With Scent decay 0.1 and Trail saturation 0, Extended runs a scene of Jones exactly as Jones does, until you paint a wall or use the Cut tool. The scenes from Jones’ papers start with Jones, and all other scenes with Extended.',
  ref: 'Jones 2010; Adamatzky and Jones 2010; Jones and Adamatzky 2014',
} as const;

/** Help for the switch "Covered food releases less"; Learn → Controls lists it with the sliders. */
export const coveredFoodHelp = {
  label: 'Covered food releases less',
  help: 'A food cell releases less scent while an agent is on it or on one of its 8 neighbour cells. It then releases only the Covered food factor of its scent. With one agent per cell, covered food then pulls in almost no more agents, and food without agents pulls with full strength. Jones uses this rule in later papers with Adamatzky. The Jones model always has one agent per cell. In the extended model without that rule, agents stack on a food and hold each other there with their own trail. Then more agents can gather on covered food than without this option. Without the rule the option also costs time: up to 38 % of the steps per second on WebGL2, and up to 24 % on WebGPU.',
  ref: 'Adamatzky and Jones 2010; Jones and Adamatzky 2014, Sec. 7.2',
} as const;

/** Help for the view switch "Scent" (ADR 0009, amendment 2026-11-11); Learn → Controls lists it with the sliders. */
export const scentViewHelp = {
  label: 'Scent',
  help: 'Shows the scent of food as a green glow and the repellent of light as a pink glow over the picture. The glow is stronger where the scent is stronger, from 0.01 to 10,000 per cell. The scale does not change, so you can compare two scenes or the two models. A green line shows where the food scent is as strong as the trail of a strand. The simulation does not change.',
} as const;

/** The scent decay at which the extended model releases as much scent as the Jones model (emissionScale()). */
export const REFERENCE_SCENT_DECAY = 0.1;

/**
 * Factor on the food and light sources of the extended model (ADR 0022). The scent of a food much larger than its
 * spread settles where the decay removes what the source adds: s = (1 − d) · (s + source), so s = source · (1 − d) / d.
 * This factor scales the source by d / (1 − d), relative to REFERENCE_SCENT_DECAY, so that level is the same at every
 * decay. It is exactly 1 at the reference: x / x for the same x.
 */
export function emissionScale(scentDecay: number): number {
  return scentDecay / (1 - scentDecay) / (REFERENCE_SCENT_DECAY / (1 - REFERENCE_SCENT_DECAY));
}

/** Help for the switch "One agent per cell (Jones 2010)"; Learn → Controls lists it with the sliders. */
export const collisionsHelp = {
  label: 'One agent per cell',
  help: 'Jones’ rule: a cell holds at most one agent. A blocked agent leaves no trail and turns to a random direction. These turns start new branches, so Jones’ networks need the rule: without it, agents pile up and the Transport network contracts into a few straight lines within a few thousand steps. The Jones model always has the rule, and only the extended model can switch it off. A switch restarts the population. With the rule, Agents per cell is at most 1.',
  ref: 'Jones 2010, p. 133 and 135',
} as const;

export interface Settings extends Record<GlobalKey, number> {
  seed: number;
  /** Cells on the long side of a grid shaped like the screen. A `lattice` replaces it. */
  resolution: number;
  /**
   * A grid of fixed size in place of one shaped like the screen, or null (ADR 0026). The scenes of Jones' papers run
   * on the lattice of their figure, because Jones' lengths are in cells.
   */
  lattice: Lattice | null;
  layout: Layout;
  boundary: Boundary;
  collisions: boolean;
  /**
   * The rule set (ADR 0022). 'jones' holds only Jones' published rules (constrain()); an old link without it loads as
   * 'jones' when its values fit.
   */
  model: Model;
  /** Food under agents releases `coveredFoodFactor` of its scent (coveredFoodHelp). */
  coveredFood: boolean;
  style: Style;
  /** The view draws the food scent and the light repellent over the picture (scentViewHelp). Display only. */
  showScent: boolean;
  strains: Strain[];
}

export const PALETTE = ['#f2c14e', '#3fc1c9', '#f25f5c', '#9b7fe6'];

export function defaultStrain(index: number, count = MAX_STRAINS): Strain {
  return {
    color: PALETTE[index % PALETTE.length] ?? '#ffffff',
    share: 1,
    sensorAngle: 22.5,
    sensorOffset: 9,
    rotationAngle: 45,
    stepSize: 1,
    deposit: 5,
    decay: 0.1,
    randomTurn: 0,
    food: 1,
    light: 1,
    attraction: Array.from({ length: count }, (_, j) => (j === index ? 1 : -1)),
  };
}

/**
 * A strain for slot `index` with the numbers of `base` (strain A of the scene) and the color of its slot.
 * It weighs its own trail as `base` weighs its own, and every other trail as `base` weighs the trail in
 * slot `index`. The other strains keep the weight their rows already hold for slot `index`: in Fogleman's
 * scenes each strain flees all others with its own factor, so there the new strain and the others can flee
 * each other with different weights. The defaults of defaultStrain() are Jones' values without the
 * one-agent-per-cell rule, which contract into a few lines.
 */
export function strainLike(base: Strain, index: number): Strain {
  const self = base.attraction[0] ?? 1;
  const other = base.attraction[index] ?? -1;
  return {
    ...base,
    color: PALETTE[index % PALETTE.length] ?? '#ffffff',
    attraction: Array.from({ length: MAX_STRAINS }, (_, j) => (j === index ? self : other)),
  };
}

export function defaultSettings(): Settings {
  return {
    seed: 1,
    resolution: 1536,
    lattice: null,
    layout: 'mixed',
    boundary: 'wrap',
    collisions: false,
    model: 'extended',
    coveredFood: false,
    style: 'glow',
    showScent: false,
    density: 1,
    diffusion: 1,
    foodStrength: 0.05,
    lightStrength: 0.05,
    scentDecay: 0.1,
    // Adamatzky and Jones 2010 (arXiv:0912.3967): each pixel of a food area releases 0.001 of its projection while a
    // particle lies in the 3 × 3 neighbourhood around it, as this app checks each food cell (ADR 0022).
    coveredFoodFactor: 0.001,
    trailSaturation: 0,
    shrink: 0,
    speed: 120,
    exposure: 0,
    bloom: 1,
    strains: [defaultStrain(0)],
  };
}

const clamp = (v: number, s: Spec) => Math.min(s.max, Math.max(s.min, v));

/** Decimals of a spec's step: 0.05 gives 2. */
const stepDecimals = (s: Spec) => Math.min(5, Math.max(0, -Math.floor(Math.log10(s.step))));

/**
 * A value as a slider or its number field takes it. A log range spans orders of magnitude, so it keeps 3
 * significant digits: its step of 0.01 would turn a density of 0.012 into 0.01. A linear range snaps to its step.
 */
export function snap(v: number, s: Spec): number {
  const r = s.log ? Number(v.toPrecision(3)) : Number((Math.round(v / s.step) * s.step).toFixed(stepDecimals(s)));
  return clamp(r, s);
}

/** A value as the number field shows it: 3 significant digits on a log range, the step's decimals otherwise. */
export function fieldText(v: number, s: Spec): string {
  return s.log ? String(Number(v.toPrecision(3))) : v.toFixed(stepDecimals(s));
}

const num = (v: unknown, fallback: number, s: Spec) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, s) : fallback;
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The kinds of edit that a shared link's food, light and walls hold (kindsOf() in link.ts). */
export type Drawn = ReadonlySet<EnvTool>;

/**
 * Builds valid Settings from untrusted input (the URL). Only known keys are read,
 * numbers are clamped to their spec, everything else falls back to the default. `drawn`: what the link's drawing
 * holds, which decides the model of a link made before the model switch (runsAsJones()).
 */
export function sanitize(input: unknown, drawn: Drawn = new Set()): Settings {
  const raw = obj(input);
  const d = defaultSettings();
  const out = { ...d };
  for (const k of Object.keys(globalSpec) as GlobalKey[]) out[k] = num(raw[k], d[k], globalSpec[k]);
  out.diffusion = Math.round(out.diffusion);
  out.seed = typeof raw.seed === 'number' && Number.isInteger(raw.seed) ? raw.seed >>> 0 : d.seed;
  out.resolution = RESOLUTIONS.includes(raw.resolution as never) ? (raw.resolution as number) : d.resolution;
  // A link made before lattices holds none: it opens on the grid shaped like the screen that it was made on (ADR 0026).
  out.lattice = latticeOf(raw.lattice);
  out.layout = oneOf(raw.layout, LAYOUTS, d.layout);
  out.boundary = oneOf(raw.boundary, BOUNDARIES, d.boundary);
  out.style = oneOf(raw.style, STYLES, d.style);
  out.showScent = raw.showScent === true;
  out.collisions = raw.collisions === true;
  // A link made before the model switch holds no model. That code ran every link with this app's additions, so the
  // link opens with the extended model, and with Jones' model only if that runs it as it was made (ADR 0022).
  const old = !MODELS.includes(raw.model as Model);
  out.model = old ? 'extended' : (raw.model as Model);
  // K is a whole number (its step): a tiny K such as 1e-300 would pick the saturating passes and pack as 0 in f32.
  out.trailSaturation = Math.round(out.trailSaturation);
  out.coveredFood = raw.coveredFood === true;

  const strains = Array.isArray(raw.strains) ? raw.strains.slice(0, MAX_STRAINS) : [];
  const n = Math.max(1, strains.length);
  out.strains = Array.from({ length: n }, (_, i) => {
    const s = obj(strains[i]);
    const def = defaultStrain(i);
    const st = { ...def };
    for (const k of Object.keys(strainSpec) as StrainKey[]) st[k] = num(s[k], def[k], strainSpec[k]);
    st.color = typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : def.color;
    const row = Array.isArray(s.attraction) ? s.attraction : [];
    st.attraction = def.attraction.map((v, j) => num(row[j], v, attractionSpec));
    return st;
  });
  if (old && runsAsJones(out, drawn)) out.model = 'jones';
  return constrain(out);
}

/** A lattice from untrusted input: two whole numbers of cells from LATTICE_SIDE, else null. */
function latticeOf(v: unknown): Lattice | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const ok = v.every(
    (n) => Number.isInteger(n) && (n as number) >= LATTICE_SIDE.min && (n as number) <= LATTICE_SIDE.max,
  );
  return ok ? [v[0] as number, v[1] as number] : null;
}

/** Whether two lattices are the same; null for a grid shaped like the screen. */
export const sameLattice = (a: Lattice | null, b: Lattice | null) => a?.[0] === b?.[0] && a?.[1] === b?.[1];

/**
 * Whether the Jones model runs the settings of a link made before the model switch as that code ran them (owner rule
 * of 2026-11-11, ADR 0022, decision 24). That code ran every link with this app's additions, as the extended model at
 * a source factor of 1 does. The link must fit Jones' model (jonesFits()), and what Jones' model binds or leaves out
 * must have had no effect: food weighed as the strain's own trail with the strain's decay, no light with an effect,
 * no trail saturation, and no walls, because only the extended model's sensors check walls on their way.
 */
export function runsAsJones(s: Settings, drawn: Drawn = new Set()): boolean {
  const st = s.strains[0];
  if (!st || !jonesFits(s) || s.trailSaturation !== 0 || drawn.has('wall')) return false;
  const food =
    !drawn.has('food') || s.foodStrength === 0 || (st.food === st.attraction[0] && s.scentDecay === st.decay);
  const light = !drawn.has('light') || s.lightStrength === 0 || st.light === 0;
  return food && light;
}

/**
 * Invariants between parameters, applied to URL input and to UI changes alike. A Jones model that holds a value Jones
 * does not have becomes the extended model (jonesFits()), and its other values are bound to Jones' (asJones()).
 */
export function constrain(s: Settings): Settings {
  const density = s.collisions ? Math.min(s.density, 1) : s.density; // one agent per cell at most
  const strains = s.strains.length > MAX_STRAINS ? s.strains.slice(0, MAX_STRAINS) : s.strains;
  const out = density === s.density && strains === s.strains ? s : { ...s, density, strains };
  if (out.model !== 'jones') return out;
  return jonesFits(out) ? asJones(out) : { ...out, model: 'extended' };
}

/**
 * Whether the settings fit Jones' model (owner decision 2026-11-11, ADR 0022): one strain that follows (+1) or flees
 * (−1) its own trail (Jones 2010, Sec. 3.5), one agent per cell (p. 133) and one 3 × 3 mean per step (Table 1). Jones
 * has no other value for these settings, so the panel offers none in the Jones model.
 */
export function jonesFits(s: Settings): boolean {
  const self = s.strains[0]?.attraction[0];
  return s.strains.length === 1 && s.collisions && s.diffusion === 1 && (self === 1 || self === -1);
}

/**
 * The Jones model's values of the settings that are not Jones' own (ADR 0022). Food goes into his one trail map
 * (Jones 2010, p. 144): its scent decays with the strain's decay, and the strain weighs it as its own trail. Jones'
 * papers have neither light that releases a repellent nor trail saturation, so their values return to the defaults,
 * and a link holds none of them. Returns `s` itself when it holds these values already.
 */
function asJones(s: Settings): Settings {
  const d = defaultSettings();
  const st = s.strains[0];
  if (!st) return s;
  const self = st.attraction[0] ?? 1;
  const light = defaultStrain(0).light;
  // One population: a share means nothing for one strain, and the panel offers none in the Jones model.
  const strainOk = st.food === self && st.light === light && st.share === 1;
  const ok = strainOk && s.scentDecay === st.decay && s.lightStrength === d.lightStrength && s.trailSaturation === 0;
  if (ok) return s;
  return {
    ...s,
    scentDecay: st.decay,
    lightStrength: d.lightStrength,
    trailSaturation: 0,
    strains: strainOk ? s.strains : [{ ...st, food: self, light, share: 1 }],
  };
}

/**
 * The settings in Jones' model: strain A alone, which follows or flees its own trail with weight 1, one agent per
 * cell, one 3 × 3 mean per step, and the bound values of asJones(). The panel's switch to Jones uses it.
 */
export function toJones(s: Settings): Settings {
  const st = s.strains[0] ?? defaultStrain(0);
  const self = (st.attraction[0] ?? 1) < 0 ? -1 : 1;
  const attraction = st.attraction.map((v, j) => (j === 0 ? self : v));
  return constrain({ ...s, model: 'jones', collisions: true, diffusion: 1, strains: [{ ...st, attraction }] });
}
