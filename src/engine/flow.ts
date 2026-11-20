// Flow in the tubes (ADR 0029): the constants of the rule, the uniform block of its passes and the schedule of the
// foods that give and take. The passes are shaders/flow.wgsl and gl/glsl/flow.frag; flow-reference.ts mirrors them on
// the CPU for the tests. Every strain has a flow of its own (ADR 0031): the passes run once per strain, on the trail
// of that strain, with a state of their own.
import { MAX_STRAINS, type Settings, type StepOrder } from '../model/params';
import { SITE_BLOCK, type FlowSites } from './sites';

/**
 * Whether the flow runs: the switch, in the extended model only (constrain() turns it off in the Jones model; this
 * also holds a setting that reached a simulation past it).
 */
export const flowOn = (s: Pick<Settings, 'flow' | 'model'>) => s.flow && s.model === 'extended';

/**
 * The strains that have a flow of their own (ADR 0031): every strain of the settings, at most the four that a
 * simulation runs (pack.ts packParams()).
 */
export const flowStrains = (s: Pick<Settings, 'strains'>) => Math.min(s.strains.length, MAX_STRAINS);

/** Thirty steps are one minute of model time (ADR 0029): the scale of every time below. */
export const STEPS_PER_MINUTE = 30;

/**
 * The constants of the rule. Each one with its source or its measurement is in ADR 0029.
 * - `gamma`: the exponent of f(Q) = Q^gamma / (1 + Q^gamma) (Tero et al. 2010, Fig. 4: 1.8).
 * - `rate`: a cell's flow memory D moves this share of the way to f(Q) per step: 333 steps, 11 min.
 * - `recover`: the flow memory of ground without a tube grows by this share per step, up to `fresh`: from `floor` to
 *   `fresh` in 6 days, and to `half`, where ground is open for births again, in 3.7 days (ADR 0054; an eighth of the
 *   share of ADR 0029, decision 19). A starved tube that vanishes leaves its ground at `floor` (flow.wgsl update).
 *   This is the share at the default of the setting Slime life time, 144 hours; recoverShare() gives the share of the
 *   settings (ADR 0055, decision 5).
 * - `base`: conductivity of a tube without flow memory; `food`: conductivity of a food cell.
 * - `ghost`: a conductivity that every open cell has for the pressure only, so that a cell beside the network holds
 *   the pressure of its neighbours before it joins.
 * - `weight`, `radius`: the damped Jacobi iteration and the spectral radius that its acceleration is tuned for. Only
 *   a cell that conducts takes the acceleration. With it a pressure swings for hundreds of iterations; a cell without
 *   a tube would swing by itself, and add to the swing of the network each time the trail gives it a tube.
 * - `bodyRate`: the tube body follows the trail at this rate per step (50 steps, 1.7 min); below `bodyLow` no tube.
 * - `fresh`: flow memory of ground that never held a tube; `floor`: the least flow memory.
 * - `trailLow`, `trailFull`: the trail of a strain, in deposits of that strain at Jones' decay of 0.1, below which a
 *   cell holds no plasmodium of the strain and from which it holds a full tube. For another decay the levels follow
 *   the trail that a cell then holds (trailLevels()).
 * - `death`: chance per step that an agent on a starved cell dies; `half`: the flow memory at which it is half that.
 * - `birth`: the top chance that a dead agent comes to life on the empty cell it draws; from `birthFrom` on.
 * - `head`: the most pressure that a food site works against, per unit of its flux: a site gives or takes less as its
 *   pressure nears this distance from the mean of all sites, and nothing beyond it. `headSoft`: the share of the limit
 *   over which the flux falls to nothing.
 */
export const FLOW = {
  gamma: 1.8,
  rate: 0.003,
  recover: 0.00002875,
  base: 0.02,
  food: 4,
  ghost: 1e-5,
  weight: 0.9,
  radius: 0.99999,
  bodyRate: 0.02,
  bodyLow: 0.05,
  fresh: 0.2,
  floor: 1e-4,
  trailLow: 0.2,
  trailFull: 1,
  death: 0.02,
  half: 0.01,
  birth: 0.2,
  birthFrom: 0.5,
  head: 4096,
  headSoft: 0.25,
} as const;

/** Pressure iterations per step, the pressure fields that run side by side, and the steps that a field keeps its roles. */
export const FLOW_ITERATIONS = 16;
export const FLOW_LANES = 4;
export const FLOW_HOLD = 300;
/**
 * The most food sites that give or take, and the ports of a strain (flow.wgsl `ports`). With more food strokes, strokes
 * spread evenly over the list take part (sites.ts SiteCells).
 */
export const FLOW_SITES = 64;

/**
 * Slots of 16 bytes in the uniform block `Flow` (flow.wgsl, flow.frag): seven of constants, then the sites, then the
 * constants of the rules of stage 4 (ADR 0067, decision 9; territory.ts packTerritory()): 2 slots of the push, then 1
 * of the sinks (FLOW_SINK_SLOT; sinks.ts packSinks()), then 1 of what the sinks take (FLOW_TAKE_SLOT; ADR 0070). The
 * passes of the flow read the block up to the sites; only the passes of stage 4 read the slots after them.
 */
export const FLOW_CONSTANT_SLOTS = 7;
export const FLOW_TERRITORY_SLOT = FLOW_CONSTANT_SLOTS + FLOW_SITES;
export const FLOW_SINK_SLOT = FLOW_TERRITORY_SLOT + 2;
export const FLOW_TAKE_SLOT = FLOW_SINK_SLOT + 1;
export const FLOW_TERRITORY_SLOTS = 4;
export const FLOW_SLOTS = FLOW_TERRITORY_SLOT + FLOW_TERRITORY_SLOTS;
export const FLOW_BYTES = FLOW_SLOTS * 16;

/** PCG hash of common.wgsl and common.glsl. */
export function pcg(v: number): number {
  const state = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/**
 * The role of each food site in each pressure field at a step: 1 gives the flux, 2 takes it, 0 neither, as one number
 * per site whose digit k in base 3 is its role in field k. `covered`: whether the plasmodium covers each site; only
 * these sites get a role, and only when there are two or more of them.
 *
 * - Two covered sites: the first one gives and the other takes, in every field and at every step. A new draw could
 *   only swap them: the same flux in every tube, and a pressure that has to settle again.
 * - Three or more: in each field, as many sites give as take, and with an odd count one site does neither. A hash
 *   of the site, the field, the seed and the time orders the sites: the first half gives, the second half takes. The
 *   order is new every FLOW_HOLD steps, each field at another time.
 *
 * The passes compute the same in `update` (flow.wgsl, flow.frag), from the tube body of the step before; this copy is
 * for the CPU mirror of the passes and for the tests.
 */
export function flowRoles(covered: readonly boolean[], step: number, seed: number): number[] {
  const codes = new Array<number>(covered.length).fill(0);
  const sites = covered.flatMap((c, i) => (c ? [i] : []));
  if (sites.length < 2) return codes;
  const half = Math.floor(sites.length / 2);
  for (let k = 0; k < FLOW_LANES; k++) {
    const epoch = Math.floor((step + Math.floor((k * FLOW_HOLD) / FLOW_LANES)) / FLOW_HOLD);
    const salt = pcg((epoch ^ pcg(((k + 1) ^ pcg((seed ^ 0x1ab) >>> 0)) >>> 0)) >>> 0);
    const hash = (i: number) => pcg((i ^ salt) >>> 0);
    for (const i of sites) {
      let digit: number;
      if (sites.length === 2) digit = i === sites[0] ? 1 : 2;
      else {
        // The rank of the site among the covered sites, by hash and then by its place in the list.
        const h = hash(i);
        const rank = sites.filter((j) => j !== i && (hash(j) < h || (hash(j) === h && j < i))).length;
        digit = rank < half ? 1 : rank < 2 * half ? 2 : 0;
      }
      codes[i] = (codes[i] ?? 0) + digit * 3 ** k;
    }
  }
  return codes;
}

/** Jones' decay of the trail (2010, Table 1): the levels of a tube are in deposits at this decay. */
export const JONES_DECAY = 0.1;

/**
 * The trail that a cell holds in the end when an agent enters it at every step, in deposits, for a decay per step
 * (diffuse.wgsl). A step that senses first adds the deposits before the decay: T ← (T + 1) · (1 − decay), which
 * ends at (1 − decay) / decay. A step that moves first adds them after it: T ← T · (1 − decay) + 1, which ends at
 * 1 / decay. The decay stays inside the range of its slider.
 */
export function heldTrail(decay: number, order: StepOrder): number {
  const d = Math.min(Math.max(decay, 1e-4), 0.9);
  return order === 'move-first' ? 1 / d : (1 - d) / d;
}

/**
 * The trail of a strain below which a cell holds no tube of it, and from which it holds a full tube (ADR 0032): 0.2
 * and 1 deposits at Jones' decay, and in the same ratio to the trail that a cell holds at the decay of the strain. A
 * trail that decays fast stays weak: a strain with a decay of 0.6 holds a thirteenth of the trail, so its levels are
 * a thirteenth too. At a decay of 0.1 the factor is 1, and the levels are those of ADR 0029, bit for bit.
 */
export function trailLevels(
  strain: Pick<Settings['strains'][number], 'deposit' | 'decay'>,
  order: StepOrder,
): [low: number, full: number] {
  const deposit = Math.max(strain.deposit, 1e-6);
  const scale = heldTrail(strain.decay, order) / heldTrail(JONES_DECAY, order);
  return [FLOW.trailLow * deposit * scale, FLOW.trailFull * deposit * scale];
}

/**
 * The Slime life time in hours for which `FLOW.recover` is the share of the mark of starved ground: 144, the 6 days of
 * ADR 0054. It is the default of the setting (a test checks it), but the rule holds the number: another default must
 * not change the time that a life time gives the mark.
 */
const RECOVER_LIFE = 144;

/**
 * The share by which the flow memory of ground without a tube grows per step (ADR 0055, decision 5): the setting Slime
 * life time gives the mark of starved ground its time. `FLOW.recover` times 144 / the life time in hours, so the mark
 * fades in about the life time. The division comes first: at 144 hours it gives 1, and the share is `FLOW.recover`
 * bit for bit, so a scene keeps its bytes; at 18 hours it gives 8, the share of ADR 0029, decision 19 (0.00023).
 * Without slime, at a life time of 0, the mark keeps the share of ADR 0054, `FLOW.recover`.
 */
export function recoverShare(s: Pick<Settings, 'slimeLife'>): number {
  return s.slimeLife > 0 ? FLOW.recover * (RECOVER_LIFE / s.slimeLife) : FLOW.recover;
}

/**
 * The uniform block of the flow passes of the strain `strain` (ADR 0031): the constants, the first cell of the first
 * site (the passes recentre the pressure by it while no site gives or takes, flow.wgsl referenceCell()), the strain,
 * the blocks of the list of cells, and the sites: per site its first cell and the run of its cells in the list of
 * cells (sites.ts FlowSites). The
 * passes take the step and the seed from the parameters of the simulation. The levels of the trail are those of the
 * strain (trailLevels()). Every strain has the same sites and the same other constants: the agent passes read the
 * constants from the block of any strain, and the pass of the ports reads the sites from the block of the first.
 */
export function packFlow(
  s: Pick<Settings, 'flowStrength' | 'strains' | 'stepOrder' | 'slimeLife'>,
  sites: FlowSites,
  buf = new ArrayBuffer(FLOW_BYTES),
  strain = 0,
): ArrayBuffer {
  const f = new Float32Array(buf);
  f.fill(0);
  const [low, full] = trailLevels(s.strains[strain] ?? { deposit: 5, decay: JONES_DECAY }, s.stepOrder);
  const omega = 2 / (1 + Math.sqrt(1 - FLOW.radius * FLOW.radius));
  const n = Math.min(sites.list.length, FLOW_SITES);
  const limit = FLOW.head * s.flowStrength;
  f.set([s.flowStrength, FLOW.gamma, FLOW.rate, recoverShare(s)], 0);
  f.set([FLOW.base, FLOW.food, FLOW.ghost, omega], 4);
  f.set([FLOW.weight, FLOW.bodyRate, FLOW.bodyLow, FLOW.fresh], 8);
  f.set([FLOW.floor, low, 1 / (full - low), n], 12);
  f.set([FLOW.death, FLOW.half * FLOW.half, FLOW.birth, FLOW.birthFrom], 16);
  const ref = sites.list[0];
  f.set([ref?.x ?? 0, ref?.y ?? 0, strain, sites.cells.length / SITE_BLOCK], 20);
  f.set([FLOW_HOLD, limit, 1 / (FLOW.headSoft * limit), 0], 24);
  for (let i = 0; i < n; i++) {
    const site = sites.list[i];
    if (site) f.set([site.x, site.y, site.offset, site.count], FLOW_CONSTANT_SLOTS * 4 + i * 4);
  }
  return buf;
}
