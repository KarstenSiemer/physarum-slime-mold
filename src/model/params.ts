// Single source of truth for every parameter: UI controls, URL validation and GPU packing read this.

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
    help: 'Fraction of the trail that disappears every step (decayT). Low decay gives strong, long-lived gradients.',
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
    help: 'How strongly the strain follows the scent of food. Negative values make food repel.',
    min: -2,
    max: 2,
    step: 0.05,
  },
  light: {
    label: 'Light avoidance',
    help: 'How strongly the strain flees light. Physarum avoids light.',
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
/** The rule set (ADR 0022): Jones' published rules only, or with this app's additions. */
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
    help: 'How many 3 × 3 mean filters run per step. Jones uses 1, Fogleman 2; 0 turns diffusion off.',
    min: 0,
    max: 4,
    step: 1,
    ref: 'Jones 2010, p. 132',
  },
  foodStrength: {
    label: 'Food strength',
    help: 'Scent that each food cell releases per step (wProj): 255 × this value, in the extended model scaled with Scent decay. With Scent decay 0.1 the scent fades within a few cells, so agents find food only when a sensor comes close. In a dense network, food becomes a hub with paths leading in, and the rest goes on as before. With few agents, higher values pull the network tighter onto the food.',
    min: 0,
    max: 0.5,
    step: 0.005,
    ref: 'Jones 2010, Fig. 17 and 20',
  },
  lightStrength: {
    label: 'Light strength',
    help: 'Repellent that each lit cell releases per step: 255 × this value, in the extended model scaled with Scent decay. It spreads and fades like the food scent, with the same Scent decay.',
    min: 0,
    max: 0.5,
    step: 0.005,
  },
  scentDecay: {
    label: 'Scent decay',
    help: 'Fraction of the food and light scent that disappears every step. Lower values spread the scent farther: at 0.1 it falls to a third within 2 cells of a food, at 0.003 within about 9 cells, one sensor distance. In the Jones model a lower decay also makes the scent stronger: at 0.001 the scent on a food is 28 to 111 times as strong as at 0.1, and the food keeps pulling in more of the network. In the extended model, food and light release less at a lower decay. Then the scent on a large food stays as strong as at 0.1, and the scent on a small food gets weaker.',
    min: 0.001,
    max: 0.9,
    step: 0.001,
    log: true,
  },
  trailSaturation: {
    label: 'Trail saturation',
    help: 'Extended model only. Each sensor reads the trail t of each strain as t / (1 + t / K), with K this value. A trail far above K counts about as much as K, so a weak food scent can still turn an agent on a dense trail. Without food, one strain makes the same turns at every K. 0 turns it off.',
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
  help: 'Jones uses only rules that Jeff Jones published, in his 2010 paper and in later papers. Every scene starts with it. Extended adds rules of this app: food and light release less scent at a lower Scent decay, so a lower decay spreads the scent farther without making it stronger, and Trail saturation is available.',
  ref: 'ADR 0022',
} as const;

/**
 * Adamatzky and Jones 2010 (Road planning with slime mould, arXiv:0912.3967): each pixel of a food area has its
 * projection multiplied by 0.001 while a particle lies in the 3 × 3 neighbourhood around the pixel. Here every food cell
 * is such a pixel (ADR 0022). Jones and Adamatzky 2014 keep 1 % for food at a point.
 */
export const COVERED_FOOD_FACTOR = 0.001;

/** Help for the switch "Covered food releases less"; Learn → Controls lists it with the sliders. */
export const coveredFoodHelp = {
  label: 'Covered food releases less',
  help: 'A food cell releases 0.1 % of its scent while an agent is on it or on one of its 8 neighbour cells. Food that the network covers then stops pulling in more agents, and uncovered food pulls with full strength. Jones uses this rule in later papers with Adamatzky. It works in both models.',
  ref: 'Adamatzky and Jones 2010; Jones and Adamatzky 2014, Sec. 7.2',
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
  help: 'Jones’ rule: a cell holds at most one agent. A blocked agent leaves no trail and turns to a random direction. These turns start new branches, so Jones’ networks need the rule: without it, agents pile up and the Transport network contracts into a few straight lines within a few thousand steps. Switching the rule restarts the population. Turning it on caps Agents per cell at 1.',
  ref: 'Jones 2010, p. 133 and 135',
} as const;

export interface Settings extends Record<GlobalKey, number> {
  seed: number;
  resolution: number;
  layout: Layout;
  boundary: Boundary;
  collisions: boolean;
  /** The rule set (ADR 0022); old links without it load as 'jones'. */
  model: Model;
  /** Food under agents releases COVERED_FOOD_FACTOR of its scent (coveredFoodHelp). */
  coveredFood: boolean;
  style: Style;
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
    layout: 'mixed',
    boundary: 'wrap',
    collisions: false,
    model: 'jones',
    coveredFood: false,
    style: 'glow',
    density: 1,
    diffusion: 1,
    foodStrength: 0.05,
    lightStrength: 0.05,
    scentDecay: 0.1,
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

/**
 * Builds valid Settings from untrusted input (the URL). Only known keys are read,
 * numbers are clamped to their spec, everything else falls back to the default.
 */
export function sanitize(input: unknown): Settings {
  const raw = obj(input);
  const d = defaultSettings();
  const out = { ...d };
  for (const k of Object.keys(globalSpec) as GlobalKey[]) out[k] = num(raw[k], d[k], globalSpec[k]);
  out.diffusion = Math.round(out.diffusion);
  out.seed = typeof raw.seed === 'number' && Number.isInteger(raw.seed) ? raw.seed >>> 0 : d.seed;
  out.resolution = RESOLUTIONS.includes(raw.resolution as never) ? (raw.resolution as number) : d.resolution;
  out.layout = oneOf(raw.layout, LAYOUTS, d.layout);
  out.boundary = oneOf(raw.boundary, BOUNDARIES, d.boundary);
  out.style = oneOf(raw.style, STYLES, d.style);
  out.collisions = raw.collisions === true;
  out.model = oneOf(raw.model, MODELS, d.model);
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
  return constrain(out);
}

/** Invariants between parameters, applied to URL input and to UI changes alike. */
export function constrain(s: Settings): Settings {
  const density = s.collisions ? Math.min(s.density, 1) : s.density; // one agent per cell at most
  const strains = s.strains.length > MAX_STRAINS ? s.strains.slice(0, MAX_STRAINS) : s.strains;
  return density === s.density && strains === s.strains ? s : { ...s, density, strains };
}
