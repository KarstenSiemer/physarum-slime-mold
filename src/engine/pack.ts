import {
  BOUNDARIES,
  COVERED_FOOD_FACTOR,
  emissionScale,
  LAYOUTS,
  MAX_STRAINS,
  type Settings,
  type Strain,
} from '../model/params';

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
] as const;
export const PARAMS_BYTES = (PARAM_SLOTS.length + 3) * 16;

const slot = (name: (typeof PARAM_SLOTS)[number]) => {
  const i = PARAM_SLOTS.indexOf(name);
  return (i > PARAM_SLOTS.indexOf('attraction') ? i + 3 : i) * 4;
};

/**
 * Claim rounds that place the agents on cells of their own with one agent per cell (init.wgsl claimStart and
 * settleStart, gl/glsl/init.frag modes 1 and 2). ROUNDS in those shaders is another count: the draws of an agent
 * without the rule. A CPU model of Shrinking plasmodium (0.64 agents per dish cell) placed every agent within 24
 * rounds. On the GPU, 1 to 4 of 61 seeds left one of its agents without a free cell, to start dead (ADR 0019).
 */
export const START_ROUNDS = 32;

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
 * Jones model never saturates (ADR 0022). Above 0 the agent passes are built with SATURATE.
 */
export const trailSaturation = (s: Pick<Settings, 'model' | 'trailSaturation'>) =>
  s.model === 'extended' ? s.trailSaturation : 0;

/** Factor on the food and light sources: 1 in the Jones model, emissionScale() in the extended model (ADR 0022). */
export const sourceScale = (s: Pick<Settings, 'model' | 'scentDecay'>) =>
  s.model === 'extended' ? emissionScale(s.scentDecay) : 1;

export function packParams(s: Settings, rt: Runtime, buf = new ArrayBuffer(PARAMS_BYTES)): ArrayBuffer {
  const u = new Uint32Array(buf);
  const f = new Float32Array(buf);
  u.fill(0);
  const strains = s.strains.slice(0, MAX_STRAINS); // 4 lanes per slot: a fifth would spill into the next slot
  u.set([rt.width, rt.height, rt.agents, rt.step], slot('grid'));
  u.set([s.seed, strains.length, BOUNDARIES.indexOf(s.boundary), s.collisions ? 1 : 0], slot('cfg'));
  const lanes = (name: Parameters<typeof slot>[0], get: (st: Strain) => number) => {
    strains.forEach((st, i) => (f[slot(name) + i] = get(st)));
  };
  lanes('sensorAngle', (st) => st.sensorAngle * DEG);
  lanes('sensorOffset', (st) => st.sensorOffset);
  lanes('rotationAngle', (st) => st.rotationAngle * DEG);
  lanes('stepSize', (st) => st.stepSize);
  lanes('deposit', (st) => st.deposit);
  lanes('keep', (st) => 1 - st.decay);
  lanes('randomTurn', (st) => st.randomTurn);
  lanes('food', (st) => st.food);
  lanes('light', (st) => st.light);
  strains.forEach((st, r) => {
    st.attraction.slice(0, strains.length).forEach((v, c) => (f[slot('attraction') + r * 4 + c] = v));
  });
  const g = sourceScale(s);
  f.set([255 * s.foodStrength * g, 255 * s.lightStrength * g, 1 - s.scentDecay, s.shrink], slot('scent'));
  const t = rt.tool;
  if (t) {
    f.set([t.x, t.y, t.radius, t.kind], slot('tool'));
    f.set([t.strain, t.revive, 0, 0], slot('tool2'));
  }
  u.set(strainEnds(strains, rt.agents), slot('strainEnd'));
  u.set([LAYOUTS.indexOf(s.layout), rt.walls ? 1 : 0, rt.round ?? 0], slot('extra'));
  f.set([trailSaturation(s), s.coveredFood ? COVERED_FOOD_FACTOR : 1], slot('model'));
  return buf;
}

/** Byte offset of the step counter (`grid.w`), patched before every step. */
export const STEP_OFFSET = (slot('grid') + 3) * 4;
