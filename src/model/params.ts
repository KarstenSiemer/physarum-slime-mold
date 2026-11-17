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
    help: 'How strongly the strain flees light. Physarum avoids light. Only the extended model has this setting: in the Jones model a strain weighs the repellent as it weighs its own trail, with the opposite sign.',
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

/**
 * Start layouts. 'food': every agent starts dead, and the engine places about FOOD_START agents of each strain on a
 * food of its own, strain A on the first food, strain B on the second (ADR 0025, ADR 0032): a small colony to grow
 * from, as Jones starts his foraging runs at a food source. 'line': a vertical strip through the middle of the grid, as
 * Tsuda, Jones et al. 2011 (p. 11) start their agents (ADR 0047; init.wgsl LINE).
 */
export const LAYOUTS = ['mixed', 'bands', 'sectors', 'colonies', 'ring', 'center', 'empty', 'food', 'line'] as const;

/** Agents of a strain that the start layout 'food' places on the food of the strain (ADR 0025). */
export const FOOD_START = 50;
export const BOUNDARIES = ['wrap', 'box', 'dish'] as const;
export const STYLES = ['glow', 'gel', 'paper', 'agents'] as const;
/** How the gel style colours thin gel against thick gel (ADR 0009, amendment 2026-11-14; GEL_FX in engine/render.ts). */
export const GEL_COLORS = ['mild', 'strong'] as const;
export const RESOLUTIONS = [256, 512, 768, 1024, 1536, 2048, 3072, 4096] as const;
/**
 * A grid of fixed size, width × height cells, that does not follow the screen (ADR 0026). Its sides are those of the
 * grids that gridSize() gives (engine/sizing.ts): 16 to 4096.
 */
export type Lattice = [width: number, height: number];
export const LATTICE_SIDE = { min: 16, max: 4096 } as const;
/** The rule set (ADR 0022): only Jones' published rules, or Jones' rules and this app's additions. */
export const MODELS = ['jones', 'extended'] as const;
/**
 * The order of a step (ADR 0027). Move first: every agent moves and deposits, then every agent senses and turns, then
 * the map diffuses (Jones 2010, p. 133). Sense first: every agent senses and turns, then moves and deposits, then the
 * map diffuses (Jones 2011, p. 1350, and his later papers; Fogleman 2020). Each scene uses the order of its paper.
 */
export const STEP_ORDERS = ['move-first', 'sense-first'] as const;
export type StepOrder = (typeof STEP_ORDERS)[number];

export type Layout = (typeof LAYOUTS)[number];
export type Boundary = (typeof BOUNDARIES)[number];
export type Style = (typeof STYLES)[number];
export type GelColor = (typeof GEL_COLORS)[number];
export type Model = (typeof MODELS)[number];

export const globalSpec = {
  density: {
    label: 'Agents per cell',
    help: 'Agents per cell of the grid. In a dish it counts the cells of the square around the dish, as Jones counts his population (%p) over a square lattice. His dish spans 0.945 of its side, and so does this app’s. Jones uses 0.03–0.15 (%p 3–15) with one agent per cell; GPU versions without the rule use 1–5.',
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
  // The mean window of Jones' later papers (ADR 0046): the Jones model only (meanWindowOf()).
  meanWindow: {
    label: 'Mean window',
    unit: 'cells wide',
    help: 'Only the Jones model has this setting. It is the side of the square over which the trail map spreads in each step: 3 is the mean of 3 × 3 cells, as in Jones 2010. A wider window spreads the trail and the food scent farther in one step, so a food pulls from farther away and the network gets coarser and smoother. Jones’ later papers use 5 × 5 as their usual window, and 15 × 15 for a field between electrodes. The window reaches through walls, as every mean of the Jones model does. With Move first and a window above 3, the view needs more memory. The extended model always uses 3 × 3; it has Diffusion passes instead.',
    min: 3,
    max: 15,
    step: 2,
    ref: 'Jones and Adamatzky 2015, arXiv:1503.06973, p. 7; Tsuda, Jones et al. 2011, arXiv:1204.1752, p. 10',
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
    help: 'Each lit cell releases a repellent per step: 255 × this value, scaled with Scent decay. It spreads and fades like the food scent, with the same Scent decay. The rule is the repellent source of Jones’ papers. To treat light as such a repellent is this app’s choice: Jones’ own light rule of 2012 makes the sensors of a lit agent weaker, and this app does not have it.',
    min: 0,
    max: 0.5,
    step: 0.005,
  },
  // Light stops growth (ADR 0050), a rule of the extended model. 0 is the code before: growth does not read light.
  // The default is 1 (the owner, 2026-11-16): no agent is born on a fully lit cell.
  lightGrowth: {
    label: 'Light stops growth',
    help: 'Only the extended model has this setting. A birth onto a lit cell fails with this chance, times the brightness of the cell. At 0 growth does not read light, and a colony grows over lit ground as over dark ground. At 1, the default, no agent is born on a fully lit cell, so the colony grows around the light. Agents can still walk onto lit ground: Light avoidance of a strain turns them at the edge. The real plasmodium grows away from bright light. The rule is this app’s own: Jones’ papers have none for growth and light.',
    min: 0,
    max: 1,
    step: 0.01,
  },
  // The Electrode tool (ADR 0047). 1 is the ±255 of Tsuda, Jones et al. 2011, which the ranges of the food and of the
  // repellent do not reach: so the electrodes have a strength of their own.
  electrodeStrength: {
    label: 'Electrode strength',
    help: 'Each cell of an electrode releases 255 × this value per step: the cathode an attractant and the anode a repellent. At 1 these are the +255 of a current sink and the −255 of a current source in the model of Tsuda, Jones and colleagues. In the Jones model both go into Jones’ trail map, above and below 0. In the extended model the field of the cathode spreads with the food scent and that of the anode with the repellent of light, Scent decay scales them, and a strain weighs them with Food attraction and Light avoidance. An electrode is no food: the flow in the tubes, Covered food and the start on food do not count it. Paint the poles with the Electrode tool.',
    min: 0,
    max: 1,
    step: 0.01,
    ref: 'Tsuda, Jones et al. 2011, arXiv:1204.1752, p. 10',
  },
  // The range of the strain's Decay: the Jones model sets the scent decay to it, and a switch to the extended model
  // keeps it (ADR 0022, decision 26).
  scentDecay: {
    label: 'Scent decay',
    help: 'Only the extended model has this setting: in the Jones model the scent decays with the strain’s Decay. It is the fraction of the food and light scent that disappears every step. Lower values spread the scent farther. With one diffusion pass, the scent beside a long food falls to a tenth within 4 cells at 0.1 and within 24 cells at 0.003: Scent reach shows it in cells. Food and light release less at a lower decay. So the scent on a large food stays as strong as at 0.1, and the scent on a small food gets weaker.',
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
    label: 'Random shrinkage',
    help: 'Chance per step that an agent dies. A full sheet then shrinks onto the food, as in Jones’ Fig. 21. Growth and shrinkage is the rule of Jones’ later papers: there an agent dies only where agents crowd.',
    min: 0,
    max: 0.002,
    step: 0.00001,
    ref: 'Jones 2010, Fig. 21 (0.00025)',
  },
  // Growth and shrinkage (Jones 2011, Sec. 5.1; ADR 0025). The defaults are the values of Jones 2011. Each window
  // count includes the agent itself (ADR 0024, decision 6).
  capacity: {
    label: 'Capacity',
    help: 'The most agents that the simulation holds per cell, alive and dead. Agents per cell sets how many live at the start. The others wait as dead agents, and Growth and the Inoculate tool bring them to life. Capacity is never below Agents per cell. With one agent per cell, Capacity is at most 1: then there is room for an agent in every cell. More capacity uses more memory. A change restarts the scene.',
    min: 0.01,
    max: 8,
    step: 0.01,
    log: true,
  },
  growthEvery: {
    label: 'Growth test every',
    unit: 'steps',
    help: 'How often each agent tests whether it divides (Gf). 0 turns the growth test off: then no agent divides, and the Cut tool and a wall painted onto agents move them elsewhere, as without Growth and shrinkage. Jones uses 3 (2011, 2017), 5 (2014) and 10 (2015).',
    min: 0,
    max: 100,
    step: 1,
    ref: 'Jones 2011, Sec. 5.1',
  },
  growthWindow: {
    label: 'Growth window',
    unit: 'cells wide',
    help: 'The square around an agent in which it counts the agents for the growth test, given by its side (Gw): 9 is a square of 9 × 9 cells. The count includes the agent itself. Jones uses 9 × 9.',
    min: 3,
    max: 15,
    step: 2,
    ref: 'Jones 2011, Sec. 5.1',
  },
  growthMin: {
    label: 'Growth minimum',
    help: 'An agent that moved divides only if its growth window holds at least this many agents (Gmin). The count includes the agent itself, so 0 and 1 have the same effect. It is at most Growth maximum. Jones uses 1 (2011 to 2015) and 0 (2017).',
    min: 0,
    max: 225,
    step: 1,
    ref: 'Jones 2011, Sec. 5.1',
  },
  growthMax: {
    label: 'Growth maximum',
    help: 'An agent that moved divides only if its growth window holds at most this many agents (Gmax). So agents divide where the colony is thin, at its edge. It is at least 1 and at most the cells of the window. Jones uses 10 (2011 to 2015) and 15 (2017).',
    min: 1,
    max: 225,
    step: 1,
    ref: 'Jones 2011, Sec. 5.1',
  },
  shrinkEvery: {
    label: 'Shrinkage test every',
    unit: 'steps',
    help: 'How often each agent tests whether it survives (Sf). 0 turns the shrinkage test off. Jones uses 3 (2011, 2017), 10 (2014) and 2 (2015).',
    min: 0,
    max: 100,
    step: 1,
    ref: 'Jones 2011, Sec. 5.1',
  },
  shrinkWindow: {
    label: 'Shrinkage window',
    unit: 'cells wide',
    help: 'The square around an agent in which it counts the agents for the shrinkage test, given by its side (Sw): 5 is a square of 5 × 5 cells. The count includes the agent itself. Jones uses 5 × 5 (2011, 2017) and 9 × 9 (2014, 2015).',
    min: 3,
    max: 15,
    step: 2,
    ref: 'Jones 2011, Sec. 5.1',
  },
  shrinkMin: {
    label: 'Shrinkage minimum',
    help: 'An agent survives the shrinkage test only if its shrinkage window holds at least this many agents (Smin). The count includes the agent itself. It is at most Shrinkage maximum. Jones uses 0.',
    min: 0,
    max: 225,
    step: 1,
    ref: 'Jones 2011, Sec. 5.1',
  },
  shrinkMax: {
    label: 'Shrinkage maximum',
    help: 'An agent survives the shrinkage test only if its shrinkage window holds at most this many agents (Smax). More agents delete it, so crowded paths stay thin. It is at least 1, because the count includes the agent itself, and at most the cells of the window. Jones uses 20 of 25 (2011), 24 of 25 (2017), 80 of 81 (2014) and 79 of 81 (2015).',
    min: 1,
    max: 225,
    step: 1,
    ref: 'Jones 2011, Sec. 5.1',
  },
  // The slime field (ADR 0055): the extended model only. The default is the time that ADR 0054 took for the mark of
  // starved ground, 6 days. The same setting gives that mark its time (engine/flow.ts recoverShare()).
  slimeLife: {
    label: 'Slime life time',
    unit: 'hours',
    help: 'Only the extended model has this setting. Slime is the layer that a slime mold leaves on the ground where it was. A cell gets slime in every step in which it holds plasmodium: the trail of a strain there is strong enough for a tube to grow. The slime stays for this many hours of model time after the last such step. An hour is 1,800 steps. At 0 the model has no slime. The picture shows the slime as a wet film on the ground, which gets thinner until this time is over (the switch Show slime). No rule reads the slime yet, so the slime changes no run. With Flow in the tubes the setting does one more thing: it says how long the ground that a starved tube left stays marked. That ground is fresh again after about this time, and children can be born onto it after about six tenths of this time: after 6 days and 3.7 days at the default of 144 hours. At 0 the mark keeps these times. The papers report no life time of slime: 144 hours is the longest time for which one of them reports that a slime mold avoids slime.',
    min: 0,
    max: 240,
    step: 1,
    ref: 'Reid et al. 2012, PNAS 109: 17490; Reid et al. 2013, Behav. Ecol. 24: 812, as Tröger et al. 2024 cite it',
  },
  // Flow in the tubes (ADR 0029): the extended model only. Tero et al. 2010 call the total flux between a source
  // and a sink I0, in units of the flux at which a tube grows at half its top rate.
  flowStrength: {
    label: 'Flow strength',
    help: 'The flux that each food gives or takes while Flow in the tubes is on (I0 of Tero et al.). A low value keeps only the tubes that the network needs, so it gets close to a tree. A high value also keeps side routes, so the network has more loops and survives a cut tube. The unit is the flux through one cell at which the flow memory of the cell goes to one half. Dead agents come back to life only where that memory is above one half. So without Growth and shrinkage a tube needs enough flux for each of its cells: in the Maze a strength of 2 is too low, and 4 is enough.',
    min: 0.1,
    max: 32,
    step: 0.1,
    log: true,
    ref: 'Tero et al. 2010, Science 327: 439, Fig. 3 and S1',
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

/**
 * The reach of the food scent and the light repellent in the extended model (ADR 0036): the cells over which the scent
 * beside a long food falls to a tenth, ln(10) / κ. A 3 × 3 mean filter scales the mode e^(−κ x), the same along y, by
 * (1 + 2 cosh κ) / 3; once the scent no longer changes, the decay d and p passes leave the mode as it is:
 * (1 − d) ((1 + 2 cosh κ) / 3)^p = 1. Both backends measure this κ to four digits beside a line of food
 * (research/scent/README.md). Around a small dab the scent falls faster, as it spreads in two directions. 0 without
 * diffusion: the scent then stays on the food.
 */
export function scentReach(decay: number, passes: number): number {
  if (passes <= 0) return 0;
  return Math.LN10 / Math.acosh((3 * (1 - decay) ** (-1 / passes) - 1) / 2);
}

/** The scent decay whose reach is `reach` cells with `passes` diffusion passes: the inverse of scentReach(). */
export function decayForReach(reach: number, passes: number): number {
  return 1 - ((1 + 2 * Math.cosh(Math.LN10 / reach)) / 3) ** -passes;
}

/**
 * Scent reach, a second way to set Scent decay (ADR 0036): no setting of its own, so a link and a scene hold only the
 * decay. Its range follows from the range of Scent decay and the diffusion passes (scentReachSpec()); the range here is
 * that of one pass, for Learn.
 */
export function scentReachSpec(passes = 1): Spec {
  return {
    label: 'Scent reach',
    help: 'Only the extended model has this setting. It sets Scent decay in another way: as the number of cells over which the scent beside a long food falls to a tenth. Around a small dab the scent falls faster, because it spreads in all directions. More diffusion passes give a longer reach at the same decay, and the repellent of light has the same reach. A longer reach widens the scent, but it hardly steers agents from farther away: in the measurements, food steered agents only up to about 12 to 14 cells from it, at every decay. A higher Trail saturation lets food steer agents from farther away.',
    min: scentReach(globalSpec.scentDecay.max, passes),
    max: scentReach(globalSpec.scentDecay.min, passes),
    step: 0.1,
    unit: 'cells',
    log: true,
  };
}

/**
 * The setting `lightStrength` as the Jones model shows it (ADR 0044): the strength of a repellent source. Jones'
 * papers project a repellent as a value below 0 onto the lattice that also holds the trail and the food (Jones and
 * Adamatzky 2015, Sec. 4.1; Tsuda et al. 2012, p. 10). The same key and range as Light strength, so a link and a
 * switch of the model keep the value.
 */
export const repellentSpec = {
  ...globalSpec.lightStrength,
  label: 'Repellent strength',
  help: 'A repellent source, such as salt or a current source. Each of its cells puts a value below 0 into Jones’ trail map per step: −255 × this value. It spreads and decays like the trail and the food, and agents turn away from it. A strain that flees its own trail turns toward it. Paint a source with the Repellent tool.',
  ref: 'Jones and Adamatzky 2015, Sec. 4.1',
} as const;

/** Help for the model choice (ADR 0022); Learn → Controls lists it with the sliders. */
export const modelHelp = {
  label: 'Model',
  help: 'Jones has only the rules that Jeff Jones published: one strain, one agent per cell, and food and repellents in the trail map. Extended adds this app’s rules: several strains, agents that share a cell, a weight of its own for food and for light, no diffusion or more diffusion passes, a scent decay of its own, sensors that walls block, walls that take in the trail, a Cut that also removes the trail, and Trail saturation. With Scent decay 0.1, a strain decay of 0.1 and Trail saturation 0, Extended runs a scene of Jones exactly as Jones does, until you paint a wall or use the Cut tool. Every scene of Jones has a decay of 0.1. The scenes from Jones’ papers start with Jones, and all other scenes with Extended.',
  ref: 'Jones 2010; Adamatzky and Jones 2010; Jones and Adamatzky 2014; Jones and Adamatzky 2015',
} as const;

/** Help for the choice "Step order" (ADR 0027); Learn → Controls lists it with the sliders. */
export const stepOrderHelp = {
  label: 'Step order',
  help: 'Move first: all agents move and leave trail, then all sense and turn, then the trail spreads. The agents then sense fresh trail before it spreads, as in Jones 2010. Sense first: all agents sense and turn, then move and leave trail, then the trail spreads, as in Jones’ later papers and in Michael Fogleman’s version. Each scene uses the order of its paper: the scenes of Jones 2010 move first, all other scenes and the default settings sense first.',
  ref: 'Jones 2010, p. 133; Jones 2011, p. 1350; Fogleman 2020',
} as const;

/** Help for the switch "Covered food releases less"; Learn → Controls lists it with the sliders. */
export const coveredFoodHelp = {
  label: 'Covered food releases less',
  help: 'A food cell releases less scent while an agent is on it or on one of its 8 neighbour cells. It then releases only the Covered food factor of its scent. With one agent per cell, covered food then pulls in almost no more agents, and food without agents pulls with full strength. Jones uses this rule in later papers with Adamatzky. The Jones model always has one agent per cell. In the extended model without that rule, agents stack on a food and hold each other there with their own trail. Then more agents can gather on covered food than without this option. Without the rule the option also costs time: up to 38 % of the steps per second on WebGL2, and up to 24 % on WebGPU.',
  ref: 'Adamatzky and Jones 2010; Jones and Adamatzky 2014, Sec. 7.2',
} as const;

/** Help for the switch "Flow in the tubes" (ADR 0029); Learn → Controls lists it with the sliders. */
export const flowHelp = {
  label: 'Flow in the tubes',
  help: 'Only the extended model has this rule. It follows the slime mold: a tube that carries much flow gets thicker, and a tube with little flow decays. Each food that the colony covers gives or takes a fixed flux, and as many foods give as take. The flux runs through the tubes from the foods that give to the foods that take (Kirchhoff’s law, as in the model of Tero, Kobayashi and Nakagaki). Each strain is a slime mold of its own and has its own flow: its flux runs only through its own tubes, between the foods that it covers. With two foods, the first one gives and the other takes. With more, the app draws again every ten minutes of model time which foods give and which take. Each cell remembers the flux that passed it. Where that memory is low, the tube starves: its agents die. With Growth and shrinkage they do not divide there, and no child is born there. A tube without any flux starves after about half an hour of model time. The ground that it leaves stays closed for children for about six tenths of the Slime life time: for 3.7 days of model time at 144 hours. Where the memory is high, dead agents come back to life, so the tube gets wider. Thirty steps are one minute of model time. With two foods, one thick tube along a short route remains. With many foods, a network with loops remains. While the colony covers fewer than two foods, no flux runs between foods, and the memory stays as it is. On fresh ground few agents starve: without Growth and shrinkage, half of a colony is gone after about 8 hours of model time. The rule costs time: the app solves the pressure in the tubes with 16 passes over the grid at each step, for each strain.',
  ref: 'Tero, Kobayashi and Nakagaki 2007, J. Theor. Biol. 244: 553; Tero et al. 2010, Science 327: 439; Marbach et al. 2023, eLife 12: e78100',
} as const;

/** Help for the switch "Draw the tubes by their flow" below Flow in the tubes (ADR 0034); Learn → Controls lists it. */
export const tubeViewHelp = {
  label: 'Draw the tubes by their flow',
  help: 'Changes only the picture, not the simulation. Each tube is as wide and as bright as its flow memory says. The flow memory is the conductivity of a tube: it grows where much flow runs, and it falls where little flow runs. So a tube that keeps much flow stays thick, and a tube with little flow gets thin and faint. A new tube starts with a middle value: it is thick at first, until its flow memory follows its flow. For the flow of a liquid in a round tube the conductivity grows with the fourth power of the radius (Poiseuille’s law), so the picture draws a radius that grows with the fourth root of the conductivity. A tube with the largest value is 3 cells wider on each side. Plasmodium without a tube stays in the picture at a quarter of its brightness. A wall stops a tube: no tube is drawn across it. Small grains move in each tube with the flow of the plasm, and they move faster where the flow is faster. They go back and forth, as the plasm of the real slime mold does about every 2 minutes; the model holds only the mean flow, so this swing is in the picture alone. Without the switch the picture shows the trail alone, as it does without the flow.',
} as const;

/** Help for the view switch "Scent" (ADR 0009, amendments of 2026-11-11 and 2026-11-12); Learn → Controls lists it. */
export const scentViewHelp = {
  label: 'Scent',
  help: 'Shows the scent of food as a green glow and the repellent as a pink glow over the picture. The glow is stronger where the scent is stronger, from 0.01 to 10,000 per cell. The scale does not change, so you can compare two scenes or the two models. A green line shows where food steers an agent as strongly as a strand of trail holds it: inside the line, food steers it more. The simulation does not change.',
} as const;

/** Help for the view switch "Show slime" (ADR 0055, decision 8); Learn → Controls lists it. */
export const slimeViewHelp = {
  label: 'Show slime',
  help: 'Changes only the picture, not the simulation. The picture shows the slime as a wet film on the ground: where the colony was, and where you painted slime. The film is thick where a tube stayed for a long time, and thin where the colony only passed. So the film keeps the shape of the tube that made it, as the slime track of a real slime mold does: a tube leaves its coat of slime behind. A tube that stays for 2.3 hours of model time leaves the thickest film. The food, the trail, the tubes, the light, the walls and the electrodes lie on the film. The film gets thinner in a straight line as the slime gets older, and it is gone after the Slime life time. The Scent view does not draw it. Without the switch the ground is plain.',
} as const;

/** The scent decay at which the extended model releases as much scent as the Jones model (emissionScale()). */
export const REFERENCE_SCENT_DECAY = 0.1;

/**
 * Factor on the food and light sources of the extended model (ADR 0022, decision 13; ADR 0027, decision 5). The scent
 * of a food much larger than its spread settles where the decay removes what the source adds, in the map that the
 * agents sense. Moving first, they sense it after the step's sources and before its diffusion:
 * s = (1 − d) · s + source, so s = source / d, and the factor is d relative to REFERENCE_SCENT_DECAY. Sensing first,
 * they sense it after the diffusion: s = (1 − d) · (s + source), so s = source · (1 − d) / d, and the factor is
 * d / (1 − d) relative to the reference, the factor of the code before ADR 0027. Either way that level is the same at
 * every decay, and the factor is exactly 1 at the reference: x / x for the same x.
 */
export function emissionScale(scentDecay: number, order: StepOrder): number {
  if (order === 'sense-first')
    return scentDecay / (1 - scentDecay) / (REFERENCE_SCENT_DECAY / (1 - REFERENCE_SCENT_DECAY));
  return scentDecay / REFERENCE_SCENT_DECAY;
}

/** Help for the switch "Growth and shrinkage"; Learn → Controls lists it with the sliders (ADR 0025). */
export const growthHelp = {
  label: 'Growth and shrinkage',
  help: 'Jones’ rule from 2011 for the size of the population. Every few steps, each agent that moved counts the agents in a square around it, itself included. If the count lies between Growth minimum and Growth maximum, the agent divides: a dead agent comes to life in a random empty cell next to it. Every few steps, each agent also counts the agents in its shrinkage square. If that count is below Shrinkage minimum or above Shrinkage maximum, the agent dies. So a colony grows at its thin edge, and crowded paths stay thin. A child needs a dead agent: Capacity sets how many agents the simulation holds. In a full scene with the default Capacity, growth only replaces the agents that shrinkage removes, and in a dense scene of Jones shrinkage first removes many agents. With the rule, the Cut tool and a wall painted onto agents kill them, as a wound takes away the plasm of the slime mold, and the colony grows back from the edge; without it, they move the agents elsewhere. The rule needs one agent per cell, because the counts assume it. On a device with little memory, the switch can lower the grid, which restarts the scene. The scene Foraging maze uses the rule.',
  ref: 'Jones 2011, Nat. Comput. 10: 1345, Sec. 5.1; Jones and Adamatzky 2014; Jones 2015; Jones, Mayne and Adamatzky 2017',
} as const;

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
  /**
   * Growth and shrinkage of the population (growthHelp, ADR 0025), with the growth* and shrink* values. Only with
   * one agent per cell (constrain()).
   */
  growth: boolean;
  /** The order of a step (STEP_ORDERS, stepOrderHelp), in both models: each scene sets the order of its paper. */
  stepOrder: StepOrder;
  /** Flow in the tubes (flowHelp, ADR 0029), with `flowStrength`. Only in the extended model (constrain()). */
  flow: boolean;
  style: Style;
  /** In the gel style: how pale and how clear thin gel is against thick gel. Display only. */
  gelColor: GelColor;
  /** The view draws the food scent and the light repellent over the picture (scentViewHelp). Display only. */
  showScent: boolean;
  /**
   * While the flow in the tubes is on, the view draws every tube as wide and as bright as its flow memory says, and
   * grains that move with the flow (tubeViewHelp, ADR 0034). Display only.
   */
  showTubes: boolean;
  /**
   * The view draws the slime as a wet film on the ground, while the model has slime (slimeViewHelp, ADR 0055,
   * decision 8). Display only.
   */
  showSlime: boolean;
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
    growth: false,
    stepOrder: 'sense-first',
    flow: false,
    style: 'glow',
    gelColor: 'mild',
    showScent: false,
    showTubes: true,
    showSlime: true,
    density: 1,
    diffusion: 1,
    meanWindow: 3,
    foodStrength: 0.05,
    lightStrength: 0.05,
    electrodeStrength: 1,
    lightGrowth: 1,
    scentDecay: 0.1,
    // Adamatzky and Jones 2010 (arXiv:0912.3967): each pixel of a food area releases 0.001 of its projection while a
    // particle lies in the 3 × 3 neighbourhood around it, as this app checks each food cell (ADR 0022).
    coveredFoodFactor: 0.001,
    trailSaturation: 0,
    shrink: 0,
    // 0: as many as Agents per cell (capacityOf()), so the buffer holds the start population and no more.
    capacity: 0,
    // Jones 2011 (Nat. Comput. 10: 1345, Sec. 5.1): both tests every 3 steps; divide with 1 to 10 agents in the
    // 9 × 9 window, survive with 0 to 20 in the 5 × 5 window. Off until `growth` is on.
    growthEvery: 3,
    growthWindow: 9,
    growthMin: 1,
    growthMax: 10,
    shrinkEvery: 3,
    shrinkWindow: 5,
    shrinkMin: 0,
    shrinkMax: 20,
    // 6 days (ADR 0055): the time of the mark of starved ground of ADR 0054.
    slimeLife: 144,
    // Tero et al. 2010 use I0 = 2 per tube (Fig. 4); a tube of this app is about 4 cells wide (ADR 0029).
    flowStrength: 8,
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
 * significant digits: its step of 0.01 would turn a density of 0.012 into 0.01. A linear range snaps to its step,
 * counted from its minimum when the minimum is off the steps: a window of 3 to 15 cells in steps of 2 stays odd.
 */
export function snap(v: number, s: Spec): number {
  const base = Number.isInteger(s.min / s.step) ? 0 : s.min;
  const r = s.log
    ? Number(v.toPrecision(3))
    : Number((base + Math.round((v - base) / s.step) * s.step).toFixed(stepDecimals(s)));
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

/** The settings of growth and shrinkage that are whole numbers: the test intervals and the count limits. */
const GROWTH_COUNTS = ['growthEvery', 'growthMin', 'growthMax', 'shrinkEvery', 'shrinkMin', 'shrinkMax'] as const;

/** The kinds of edit that a shared link's food, light and walls hold (kindsOf() in link.ts). */
export type Drawn = ReadonlySet<EnvTool>;

/**
 * The mark `rules` that a shared link holds beside its settings (encodeSettings() in url.ts): the number of the
 * newest ADR that changed what the settings of a link mean. A link without the mark was made before ADR 0044, when
 * drawn light had no effect in the Jones model (sanitize()).
 */
export const LINK_RULES = 44;

/**
 * Builds valid Settings from untrusted input (the URL). Only known keys are read,
 * numbers are clamped to their spec, everything else falls back to the default. `drawn`: what the link's drawing
 * holds, which decides the model of a link made before the model switch (runsAsJones()), and the repellent of a Jones
 * link made before ADR 0044. `order`: the step order of a link that names none, the one of its scene (stepOrderOf()).
 */
export function sanitize(input: unknown, drawn: Drawn = new Set(), order: StepOrder = 'sense-first'): Settings {
  const raw = obj(input);
  const d = defaultSettings();
  const out = { ...d };
  for (const k of Object.keys(globalSpec) as GlobalKey[]) out[k] = num(raw[k], d[k], globalSpec[k]);
  out.diffusion = Math.round(out.diffusion);
  // A link from before the mean window holds none: it keeps the 3 × 3 mean (ADR 0046). The side is odd.
  out.meanWindow = snap(out.meanWindow, globalSpec.meanWindow);
  out.seed = typeof raw.seed === 'number' && Number.isInteger(raw.seed) ? raw.seed >>> 0 : d.seed;
  out.resolution = RESOLUTIONS.includes(raw.resolution as never) ? (raw.resolution as number) : d.resolution;
  // A link made before lattices holds none: it opens on the grid shaped like the screen that it was made on (ADR 0026).
  out.lattice = latticeOf(raw.lattice);
  out.layout = oneOf(raw.layout, LAYOUTS, d.layout);
  out.boundary = oneOf(raw.boundary, BOUNDARIES, d.boundary);
  out.style = oneOf(raw.style, STYLES, d.style);
  out.gelColor = oneOf(raw.gelColor, GEL_COLORS, d.gelColor);
  out.showScent = raw.showScent === true;
  // A link from before the picture of the tubes holds no switch for it: the picture is on, as for a new scene. It
  // changes no result (ADR 0034).
  out.showTubes = raw.showTubes !== false;
  // So with the film of the slime (ADR 0055, decision 8): a link from before it holds no switch for it, and the film
  // is on. It changes no result.
  out.showSlime = raw.showSlime !== false;
  out.collisions = raw.collisions === true;
  // A link made before the model switch holds no model. That code ran every link with this app's additions, so the
  // link opens with the extended model, and with Jones' model only if that runs it as it was made (ADR 0022).
  const old = !MODELS.includes(raw.model as Model);
  out.model = old ? 'extended' : (raw.model as Model);
  // K is a whole number (its step): a tiny K such as 1e-300 would pick the saturating passes and pack as 0 in f32.
  out.trailSaturation = Math.round(out.trailSaturation);
  out.coveredFood = raw.coveredFood === true;
  // A link of the extended model holds Light stops growth only when it is not 0 (linkSettings() in url.ts). So a link
  // without it runs with 0: a link made before the rule runs as it was made, with growth that does not read light
  // (ADR 0050). A link of the Jones model gets the default back below (asJones() in constrain()).
  if (typeof raw.lightGrowth !== 'number') out.lightGrowth = 0;
  // So with Slime life time (ADR 0055, decision 10): a link without it, or with a value that is no number, has no
  // slime, and its starved ground keeps the time of ADR 0054, so the link runs as it was made. Whole hours, the step of
  // the setting: a time such as 1e-300 would be above 0 and give the mark of starved ground a share that f32 cannot
  // hold (engine/flow.ts recoverShare()).
  out.slimeLife = Number.isFinite(raw.slimeLife) ? Math.round(out.slimeLife) : 0;
  // Growth and shrinkage (ADR 0025): whole steps and counts, and windows of an odd side, so that the agent sits in the
  // middle of its window. A link without them keeps growth off.
  out.growth = raw.growth === true;
  for (const k of GROWTH_COUNTS) out[k] = Math.round(out[k]);
  for (const k of ['growthWindow', 'shrinkWindow'] as const) out[k] = snap(out[k], globalSpec[k]);
  // Capacity 0 stands for as many as Agents per cell (capacityOf()): a link keeps it 0, not the range's minimum.
  if (typeof raw.capacity !== 'number' || !(raw.capacity > 0)) out.capacity = 0;
  // A link from before the step orders holds none: the order of its scene, or sense first without a scene, the order of
  // the code before (ADR 0027).
  out.stepOrder = oneOf(raw.stepOrder, STEP_ORDERS, order);
  // A link from before the flow holds none: it stays off (ADR 0029).
  out.flow = raw.flow === true;

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
  // A Jones link made before ADR 0044 ran its drawn light without an effect (ADR 0022, decision 8). The Jones model
  // now reads drawn light as a repellent source, so such a link opens with a repellent strength of 0 and runs as it
  // was made. A link made since holds the mark `rules`.
  const before44 = !(typeof raw.rules === 'number' && raw.rules >= LINK_RULES);
  if (out.model === 'jones' && before44 && drawn.has('light')) out.lightStrength = 0;
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
 * no trail saturation, no flow in the tubes, which only the extended model has (ADR 0029), and no walls, because only
 * the extended model's sensors check walls on their way. A link whose light had an effect stays extended, as before
 * ADR 0044: there its light keeps the weight and the scent decay that the link holds.
 */
export function runsAsJones(s: Settings, drawn: Drawn = new Set()): boolean {
  const st = s.strains[0];
  if (!st || !jonesFits(s) || s.trailSaturation !== 0 || s.flow || drawn.has('wall')) return false;
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
  // The window counts of growth and shrinkage assume one agent per cell (Jones 2011, Sec. 5.1).
  const growth = s.growth && s.collisions;
  const limits = growthLimits(s);
  const same = density === s.density && strains === s.strains && growth === s.growth && limits === undefined;
  const out = same ? s : { ...s, density, strains, growth, ...limits };
  if (out.model !== 'jones') return asExtended(out);
  return jonesFits(out) ? asJones(out) : asExtended({ ...out, model: 'extended' });
}

/** The 3 × 3 mean window: the window of Jones 2010, and the only one of the extended model (ADR 0046). */
export const MEAN_WINDOW = 3;

/**
 * The side of the mean window that a step runs (ADR 0046): the setting in the Jones model, 3 in the extended model,
 * whatever the settings hold. Odd, from 3 to the largest side of the setting.
 */
export function meanWindowOf(s: Pick<Settings, 'model' | 'meanWindow'>): number {
  if (s.model !== 'jones') return MEAN_WINDOW;
  const { min, max } = globalSpec.meanWindow;
  const side = Math.min(max, Math.max(min, Math.round(s.meanWindow)));
  return side % 2 === 1 ? side : side - 1;
}

/**
 * The extended model's value of the setting that only the Jones model has (ADR 0046): the mean window returns to
 * 3 × 3, and a link holds none of it. Returns `s` itself when it holds that value already.
 */
function asExtended(s: Settings): Settings {
  return s.meanWindow === MEAN_WINDOW ? s : { ...s, meanWindow: MEAN_WINDOW };
}

/**
 * The limits of growth and shrinkage (ADR 0025, review of 2026-11-11), or undefined when the settings keep them: each
 * maximum from 1 to the cells of its window, and each minimum at most its maximum. Shrinkage maximum 0 or a minimum
 * above the maximum deletes every agent, and a growth maximum below 1 or below the minimum never divides one.
 */
function growthLimits(s: Settings) {
  const gMax = Math.min(Math.max(s.growthMax, 1), s.growthWindow ** 2);
  const sMax = Math.min(Math.max(s.shrinkMax, 1), s.shrinkWindow ** 2);
  const [gMin, sMin] = [Math.min(s.growthMin, gMax), Math.min(s.shrinkMin, sMax)];
  if (gMax === s.growthMax && sMax === s.shrinkMax && gMin === s.growthMin && sMin === s.shrinkMin) return undefined;
  return { growthMax: gMax, shrinkMax: sMax, growthMin: gMin, shrinkMin: sMin };
}

/**
 * The most agents per cell that the simulation holds, alive and dead (ADR 0025): Capacity, at least the start
 * population (Agents per cell), and at most one agent per cell with the rule. Capacity keeps the value the user set,
 * also while Agents per cell lies above it or the rule caps it: it acts again when they change back. 0 means as many
 * as Agents per cell.
 */
export const capacityOf = (s: Pick<Settings, 'capacity' | 'density' | 'collisions'>) =>
  Math.min(Math.max(s.capacity, s.density), s.collisions ? 1 : Infinity);

/**
 * Whether the settings fit Jones' model (owner decision 2026-11-11, ADR 0022): one strain that follows (+1) or flees
 * (−1) its own trail (Jones 2010, Sec. 3.5), one agent per cell (p. 133) and one mean per step (Table 1). Jones
 * has no other value for these settings, so the panel offers none in the Jones model. The window of that mean is a
 * setting of the Jones model (Mean window, ADR 0046).
 */
export function jonesFits(s: Settings): boolean {
  const self = s.strains[0]?.attraction[0];
  return s.strains.length === 1 && s.collisions && s.diffusion === 1 && (self === 1 || self === -1);
}

/**
 * The Jones model's values of the settings that are not Jones' own (ADR 0022). Food goes into his one trail map
 * (Jones 2010, p. 144): its scent decays with the strain's decay, and the strain weighs it as its own trail. A
 * repellent source goes into the same map with a value below 0 (Jones and Adamatzky 2015, Sec. 4.1; ADR 0044): the
 * strain weighs it as its own trail too, and its strength stays the user's. Jones' papers have neither trail
 * saturation, nor a flow in the tubes, nor light that stops growth, nor slime, so their values return to the defaults,
 * and a link holds none of them. Returns `s` itself when it holds these values already.
 */
function asJones(s: Settings): Settings {
  const d = defaultSettings();
  const st = s.strains[0];
  if (!st) return s;
  const self = st.attraction[0] ?? 1;
  // One population: a share means nothing for one strain, and the panel offers none in the Jones model.
  const strainOk = st.food === self && st.light === self && st.share === 1;
  const bound = s.scentDecay === st.decay && s.trailSaturation === 0;
  // The flow in the tubes is this app's rule (ADR 0029): the Jones model never has it, and a link holds none of it.
  // Light stops growth is this app's rule too (ADR 0050): the Jones model packs none of it (packParams()).
  // So is the slime (ADR 0055): the Jones model has none, and packs a life time of 0 (engine/slime.ts slimeSteps()).
  const own = s.lightGrowth === d.lightGrowth && s.slimeLife === d.slimeLife;
  const ok = strainOk && bound && !s.flow && s.flowStrength === d.flowStrength && own;
  if (ok) return s;
  return {
    ...s,
    scentDecay: st.decay,
    trailSaturation: 0,
    flow: false,
    flowStrength: d.flowStrength,
    lightGrowth: d.lightGrowth,
    slimeLife: d.slimeLife,
    strains: strainOk ? s.strains : [{ ...st, food: self, light: self, share: 1 }],
  };
}

/**
 * The settings in Jones' model: strain A alone, which follows or flees its own trail with weight 1, one agent per
 * cell, one mean per step, and the bound values of asJones(). The panel's switch to Jones uses it.
 */
export function toJones(s: Settings): Settings {
  const st = s.strains[0] ?? defaultStrain(0);
  const self = (st.attraction[0] ?? 1) < 0 ? -1 : 1;
  const attraction = st.attraction.map((v, j) => (j === 0 ? self : v));
  return constrain({ ...s, model: 'jones', collisions: true, diffusion: 1, strains: [{ ...st, attraction }] });
}
