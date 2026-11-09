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

export type Layout = (typeof LAYOUTS)[number];
export type Boundary = (typeof BOUNDARIES)[number];
export type Style = (typeof STYLES)[number];

export const globalSpec = {
  density: {
    label: 'Agents per cell',
    help: 'Population density. Jones uses 0.03–0.15 (%p 3–15) with collisions; GPU versions without collisions use 1–5.',
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
    help: 'Weight of food projected into the scent field per step (wProj). Higher values tighten the network around food.',
    min: 0,
    max: 0.5,
    step: 0.005,
    ref: 'Jones 2010, Fig. 17 and 20',
  },
  lightStrength: {
    label: 'Light strength',
    help: 'Strength of the repellent that light projects per step.',
    min: 0,
    max: 0.5,
    step: 0.005,
  },
  scentDecay: {
    label: 'Scent decay',
    help: 'Fraction of the food and light scent that disappears every step.',
    min: 0.001,
    max: 0.9,
    step: 0.001,
    log: true,
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

export interface Settings extends Record<GlobalKey, number> {
  seed: number;
  resolution: number;
  layout: Layout;
  boundary: Boundary;
  collisions: boolean;
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
 * slot `index`, so the new strain and the others treat each other alike. The defaults of defaultStrain()
 * are Jones' values without the one-agent-per-cell rule, which contract into a few lines.
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
    style: 'glow',
    density: 1,
    diffusion: 1,
    foodStrength: 0.05,
    lightStrength: 0.05,
    scentDecay: 0.1,
    shrink: 0,
    speed: 120,
    exposure: 0,
    bloom: 1,
    strains: [defaultStrain(0)],
  };
}

const clamp = (v: number, s: Spec) => Math.min(s.max, Math.max(s.min, v));
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
