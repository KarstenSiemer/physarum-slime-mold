import { BOUNDARIES, emissionScale, LAYOUTS, MAX_STRAINS, type Settings, type Strain } from '../model/params';

// Slot order of `struct Params` in shaders/common.wgsl (16 bytes each); a test checks it.
export const PARAM_SLOTS = [
  'grid',
  'cfg',
  'sensorAngle',
  'sensorOffset',
  'rotationAngle',
  'stepSize',
  'deposit',
  'keep',
  'randomTurn',
  'food',
  'light',
  'attraction', // 4 slots
  'scent',
  'tool',
  'tool2',
  'strainEnd',
  'extra',
  'model',
  'growth',
  'shrinkage',
  'startEnd',
] as const;
export const PARAMS_BYTES = (PARAM_SLOTS.length + 3) * 16;

const slot = (name: (typeof PARAM_SLOTS)[number]) => {
  const i = PARAM_SLOTS.indexOf(name);
  return (i > PARAM_SLOTS.indexOf('attraction') ? i + 3 : i) * 4;
};

/**
 * Claim rounds that place the agents on cells of their own with one agent per cell (init.wgsl claimStart and
 * settleStart, gl/glsl/init.frag modes 1 and 2). ROUNDS in those shaders is another count: the draws of an agent
 * without the rule. In each round a waiting agent finds a free cell with about the share of the free cells, so after
 * n rounds about N · f^n agents of N wait, at the filled share f. Shrinking plasmodium fills 0.71 of Jones' dish
 * (ADR 0027): after 32 rounds 0 to 2 of its 45,000 agents started dead in 15 of 61 seeds on WebGPU (13 on WebGL2),
 * and after 64 rounds none in 61 seeds on either backend. Before Jones' dish (0.64 of the app's dish), 32 rounds left
 * one agent dead in 1 to 4 of 61 seeds (ADR 0019).
 */
export const START_ROUNDS = 64;

/**
 * Claim rounds for a start: the mixed layout on a grid without walls and dish gives every agent a free cell of its
 * own in the first round (a permutation of the grid), so one round does.
 */
export function startRounds(s: Pick<Settings, 'layout' | 'boundary'>, walls: boolean): number {
  return s.layout === 'mixed' && s.boundary !== 'dish' && !walls ? 1 : START_ROUNDS;
}

/**
 * Cells per side of a clearance tile (shaders/walls.wgsl, gl/glsl/walls.frag, ADR 0020): each tile keeps how far the
 * nearest wall lies at least, so that agents far from every wall skip the walks of their sensors and moves.
 */
export const CLEAR_TILE = 8;

/** Agent-pass tools (`Params.tool.w`). */
export const AgentToolKind = { inoculate: 1, cut: 2 } as const;

/** An agent tool for the steps of one `Sim.run()` call: it acts on every one of them (ADR 0023). */
export interface AgentTool {
  kind: (typeof AgentToolKind)[keyof typeof AgentToolKind];
  x: number;
  y: number;
  radius: number;
  strain: number;
  /** Inoculate: the chance per step that a dead agent of the strain is placed. Living agents never move. */
  revive: number;
}

/**
 * The chance that a dead agent is placed in one step that stands for `seconds` of holding the inoculate tool, at
 * `rate` placements per dead agent and second. Over any time t the agent stays dead with the chance e^(−rate · t),
 * however frames and steps cut t up: so the amount per second of holding does not depend on the frame rate or the
 * steps per second (ADR 0023).
 */
export function stepChance(rate: number, seconds: number): number {
  return rate > 0 && seconds > 0 ? -Math.expm1(-rate * seconds) : 0;
}

/**
 * The rate of the inoculate tool, in placements per dead agent of `strain` and second, for a brush of `radius` cells.
 * While every agent of the strain is dead, a second of holding places 30 times the brush area times the density (at
 * least 0.25): the brush fills to the density in about 1/30 s. A frame at 60 Hz placed the same before (2026-11-11).
 * With the rule, the free cells of the brush limit it (ADR 0008).
 */
export function inoculateRate(
  radius: number,
  s: Pick<Settings, 'density' | 'strains'>,
  agents: number,
  strain: number,
) {
  const total = s.strains.reduce((a, st) => a + st.share, 0);
  const share = (s.strains[strain]?.share ?? 1) / total;
  return (30 * Math.PI * radius * radius * Math.max(0.25, s.density)) / (agents * share);
}

export interface Runtime {
  width: number;
  height: number;
  agents: number;
  step: number;
  tool?: AgentTool | undefined;
  /** The environment may hold walls: moves and sensors then check every cell they cross (agents.wgsl `clearPath`). */
  walls?: boolean;
  /** The claim round of the start placement with one agent per cell (init.wgsl). */
  round?: number;
  /**
   * Agents alive at the start: the first ones of each strain (startEnds()). Fewer than `agents` when the capacity
   * holds more than the start population (ADR 0025). Default: `agents`.
   */
  start?: number;
}

/**
 * Exclusive end index of each strain's agents that the layout places at the start: the first `start` agents of the
 * population, split by the shares as strainEnds() splits all `agents`, each at the start of its strain's agents. With
 * `start` equal to `agents` these are strainEnds() (ADR 0025).
 */
export function startEnds(strains: readonly Strain[], agents: number, start = agents): number[] {
  const ends = strainEnds(strains, agents);
  if (start >= agents) return ends;
  const counts = strainAgents(strains, start);
  // Rounding can give a strain one start agent more than it has agents: it then starts them all.
  return ends.map((end, i) => Math.min(end, (i > 0 ? (ends[i - 1] ?? 0) : 0) + (counts[i] ?? 0)));
}

/**
 * Node counts of the levels 1 and up of a pyramid of sums over `n` elements with a fan-in of 4 (growth.wgsl,
 * gl/glsl/growth.frag): the last level has one node.
 */
export function pyramidLevels(n: number): number[] {
  const sizes: number[] = [];
  let m = n;
  do {
    m = Math.ceil(m / 4);
    sizes.push(m);
  } while (m > 1);
  return sizes;
}

/** Growth and shrinkage run (ADR 0025): only with one agent per cell, which constrain() also asks for. */
export const growthOn = (s: Pick<Settings, 'growth' | 'collisions'>) => s.growth && s.collisions;

type GrowthTests = Pick<Settings, 'growth' | 'collisions' | 'growthEvery' | 'shrinkEvery'>;

/**
 * Which tests of growth and shrinkage run in step `step` (Jones 2011, Sec. 5.1: every Gf and Sf steps): the steps
 * whose number is a multiple of the interval, from step 0 on. An interval of 0 turns that test off.
 */
export function growthTests(s: GrowthTests, step: number): { grow: boolean; shrink: boolean } {
  const on = growthOn(s);
  return {
    grow: on && s.growthEvery > 0 && step % s.growthEvery === 0,
    shrink: on && s.shrinkEvery > 0 && step % s.shrinkEvery === 0,
  };
}

/** Agents of each strain: alive and dead, as strainEnds() splits them. A strain keeps its agents for good. */
export function strainAgents(strains: readonly Strain[], agents: number): number[] {
  const ends = strainEnds(strains, agents);
  return strains.slice(0, MAX_STRAINS).map((_, i) => (ends[i] ?? 0) - (i > 0 ? (ends[i - 1] ?? 0) : 0));
}

/** Exclusive end index of each strain's agents, proportional to the population shares. */
export function strainEnds(strains: readonly Strain[], agents: number): number[] {
  const total = strains.reduce((a, s) => a + s.share, 0);
  let acc = 0;
  return Array.from({ length: MAX_STRAINS }, (_, i) => {
    acc += strains[i]?.share ?? 0;
    return i >= strains.length - 1 ? agents : Math.round((acc / total) * agents);
  });
}

const DEG = Math.PI / 180;

/**
 * K of the saturating trail perception (agents.wgsl sense()), or 0 when the sensors read the trail as it is: the
 * Jones model never saturates (ADR 0022). Above 0 the agent passes are built with SATURATE. A K below 1 is off: the
 * slider's steps are whole numbers, and a K that f32 cannot hold (1e-300 packs as 0) would divide every lane by 0.
 */
export const trailSaturation = (s: Pick<Settings, 'model' | 'trailSaturation'>) =>
  s.model === 'extended' && s.trailSaturation >= 1 ? s.trailSaturation : 0;

/**
 * Factor on the food and light sources: 1 in the Jones model, emissionScale() of the step order in the extended model
 * (ADR 0022, ADR 0027).
 */
export const sourceScale = (s: Pick<Settings, 'model' | 'scentDecay' | 'stepOrder'>) =>
  s.model === 'extended' ? emissionScale(s.scentDecay, s.stepOrder) : 1;

/**
 * Packs the settings for the GPU. In the Jones model the GPU runs Jones' one trail map whatever the settings hold
 * (ADR 0022): the scent decays with the strain's decay, the strain weighs food as its own trail, light has no source
 * and no weight, and the cut tool leaves the chemicals in the wound (Jones 2010, p. 148).
 */
export function packParams(s: Settings, rt: Runtime, buf = new ArrayBuffer(PARAMS_BYTES)): ArrayBuffer {
  const jones = s.model === 'jones';
  const u = new Uint32Array(buf);
  const f = new Float32Array(buf);
  u.fill(0);
  const strains = s.strains.slice(0, MAX_STRAINS); // 4 lanes per slot: a fifth would spill into the next slot
  u.set([rt.width, rt.height, rt.agents, rt.step], slot('grid'));
  u.set([s.seed, strains.length, BOUNDARIES.indexOf(s.boundary), s.collisions ? 1 : 0], slot('cfg'));
  const lanes = (name: Parameters<typeof slot>[0], get: (st: Strain, i: number) => number) => {
    strains.forEach((st, i) => (f[slot(name) + i] = get(st, i)));
  };
  lanes('sensorAngle', (st) => st.sensorAngle * DEG);
  lanes('sensorOffset', (st) => st.sensorOffset);
  lanes('rotationAngle', (st) => st.rotationAngle * DEG);
  lanes('stepSize', (st) => st.stepSize);
  lanes('deposit', (st) => st.deposit);
  lanes('keep', (st) => 1 - st.decay);
  lanes('randomTurn', (st) => st.randomTurn);
  lanes('food', (st, i) => (jones ? (st.attraction[i] ?? 0) : st.food));
  lanes('light', (st) => (jones ? 0 : st.light));
  strains.forEach((st, r) => {
    st.attraction.slice(0, strains.length).forEach((v, c) => (f[slot('attraction') + r * 4 + c] = v));
  });
  const g = sourceScale(s);
  const light = jones ? 0 : 255 * s.lightStrength * g;
  const scentDecay = jones ? (strains[0]?.decay ?? s.scentDecay) : s.scentDecay;
  f.set([255 * s.foodStrength * g, light, 1 - scentDecay, s.shrink], slot('scent'));
  const t = rt.tool;
  if (t) {
    f.set([t.x, t.y, t.radius, t.kind], slot('tool'));
    // tool2.z: 1 keeps the chemicals in a cut (diffuse.wgsl), as Jones did; the extended model clears them.
    f.set([t.strain, t.revive, jones && t.kind === AgentToolKind.cut ? 1 : 0, 0], slot('tool2'));
  }
  u.set(strainEnds(strains, rt.agents), slot('strainEnd'));
  // The start layout 'food' starts every agent dead, as 'empty' does; the engine then places the colony (ADR 0025).
  const layout = LAYOUTS.indexOf(s.layout === 'food' ? 'empty' : s.layout);
  u.set([layout, rt.walls ? 1 : 0, rt.round ?? 0], slot('extra'));
  // model.z: walls diffuse as part of Jones' lattice in the Jones model, and are sinks in the extended model; model.w:
  // 1 if a step senses first, in either model (ADR 0027).
  const senseFirst = s.stepOrder === 'sense-first' ? 1 : 0;
  f.set([trailSaturation(s), s.coveredFood ? s.coveredFoodFactor : 1, jones ? 1 : 0, senseFirst], slot('model'));
  // Growth and shrinkage (ADR 0025): an interval of 0 turns a test off, and both are off without the rule.
  const on = growthOn(s);
  u.set([on ? s.growthEvery : 0, s.growthWindow, s.growthMin, s.growthMax], slot('growth'));
  u.set([on ? s.shrinkEvery : 0, s.shrinkWindow, s.shrinkMin, s.shrinkMax], slot('shrinkage'));
  u.set(startEnds(strains, rt.agents, rt.start), slot('startEnd'));
  return buf;
}

/** Byte offset of the step counter (`grid.w`), patched before every step. */
export const STEP_OFFSET = (slot('grid') + 3) * 4;
