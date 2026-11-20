// The CPU copy of growth and shrinkage (shaders/growth.wgsl, gl/glsl/growth.frag and growth.vert; ADR 0025), for
// tests only: sim.gpu.test.ts steps it from the state after the moves of a step and compares both GPU backends with it.
// flow.gpu.test.ts does the same with the flow on, and gives it the flow memory (ADR 0053), territory.gpu.test.ts with
// the territory of the rules of stage 4 (ADR 0068), and paid.gpu.test.ts with the births that the flux pays (ADR 0071).
import type { Boundary, Settings } from '../model/params';
import { DISH_FILL } from './brush';
import { FLOW, pcg } from './flow';
import { strainEnds } from './pack';
import { NO_KEY, PAID_KEY, paidKey } from './paid';
import type { AgentState } from './types';

const ALIVE = 4;
const TAU = Math.fround(6.28318530717959);
// Random streams of growth.wgsl.
const GROW = 4;
const BIRTH = 5;
const PLACE_ORDER = 6;
const SHADE = 10;

/** rngSeed() of common.wgsl: the stream of agent `id` in step `step` for `salt`. */
export function rngSeed(id: number, salt: number, step: number, seed: number): number {
  return pcg((id ^ pcg((step ^ pcg((seed ^ salt) >>> 0)) >>> 0)) >>> 0);
}

/** A stream with rand() of common.wgsl: each draw k / 2^24. */
export function stream(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = pcg(s);
    return (s >>> 8) / 16777216;
  };
}

/** The claim key of an agent in a step: key() of agents.wgsl on WebGPU, claimKey() of common.glsl on WebGL2. */
export function claimKey(kind: 'webgpu' | 'webgl2', id: number, step: number, seed: number): number {
  if (kind === 'webgpu') return pcg((id ^ pcg((step ^ 0x9e3779b9 ^ seed) >>> 0)) >>> 0);
  let k = (Math.imul(id, 0x9e3779b1) + pcg((step ^ seed) >>> 0)) & 0xffffff;
  k ^= k >>> 12;
  k = Math.imul(k, 0x2c1b3c6d) & 0xffffff;
  return k + 1;
}

/** The largest float32 below x > 0. */
function below(x: number) {
  const bits = new Uint32Array(Float32Array.of(x).buffer);
  bits.set([(bits[0] ?? 1) - 1]);
  return new Float32Array(bits.buffer)[0] ?? x;
}

/** The grid with cellAt() of common.wgsl: wrapped on the periodic grid, −1 outside a box or the dish. */
export function grid(w: number, h: number, boundary: Boundary) {
  const f = Math.fround;
  // dishRadius() of common.wgsl: DISH_FILL × 0.5 is a constant there, rounded once to f32 (ADR 0027).
  const radius = f(f(DISH_FILL * 0.5) * Math.min(w, h));
  const [cx, cy] = [f(0.5 * w), f(0.5 * h)];
  const inDish = (x: number, y: number) => {
    const [dx, dy] = [f(f(x + 0.5) - cx), f(f(y + 0.5) - cy)];
    return f(Math.sqrt(f(f(dx * dx) + f(dy * dy)))) <= radius;
  };
  const cellAt = (x: number, y: number) => {
    if (boundary === 'wrap') return (((y % h) + h) % h) * w + (((x % w) + w) % w);
    if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    if (boundary === 'dish' && !inDish(x, y)) return -1;
    return y * w + x;
  };
  /** A cell of the grid's rectangle (gridCell in growth.wgsl): as cellAt(), but a dish counts its whole grid. */
  const gridCell = (x: number, y: number) =>
    boundary === 'wrap' ? cellAt(x, y) : x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x;
  return { cellAt, gridCell, cellOf: (a: { x: number; y: number }) => cellAt(Math.floor(a.x), Math.floor(a.y)) };
}

/** The agents per cell of the alive agents. */
export function occupancy(agents: readonly AgentState[], w: number, h: number, boundary: Boundary) {
  const { cellOf } = grid(w, h, boundary);
  const occ = new Uint32Array(w * h);
  for (const a of agents) {
    const c = cellOf(a);
    if (a.bits & ALIVE && c >= 0) occ[c] = (occ[c] ?? 0) + 1;
  }
  return occ;
}

/**
 * The window counts of growth.wgsl `windowSums`, by brute force: the agents in the square of side `gw` and of side
 * `sw` around every cell of the rectangle, the cell's own agent included (2 per cell).
 */
export function windowCounts(occ: Uint32Array, w: number, h: number, boundary: Boundary, gw: number, sw: number) {
  const { gridCell } = grid(w, h, boundary);
  const out = new Uint32Array(w * h * 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      [gw, sw].forEach((side, lane) => {
        const r = (side - 1) / 2;
        let sum = 0;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const c = gridCell(x + dx, y + dy);
            if (c >= 0) sum += occ[c] ?? 0;
          }
        out[(y * w + x) * 2 + lane] = sum;
      });
  return out;
}

/** place() of growth.wgsl: the position of cell c in the order of the births of a step. */
export function place(c: number, w: number, h: number, step: number, seed: number): number {
  let x = c % w;
  let y = Math.floor(c / w);
  let k = pcg((step ^ pcg((seed ^ PLACE_ORDER) >>> 0)) >>> 0);
  for (let r = 0; r < 2; r++) {
    x = (x + (pcg((y ^ k) >>> 0) % w)) % w;
    k = pcg(k);
    y = (y + (pcg((x ^ k) >>> 0) % h)) % h;
    k = pcg(k);
  }
  return y * w + x;
}

export interface GrowthInput {
  kind: 'webgpu' | 'webgl2';
  settings: Settings;
  w: number;
  h: number;
  /** Wall, food, light and unused byte per cell (Sim.readEnv()). */
  env: Uint8Array;
  /** The step's number: the step that ran the moves. */
  step: number;
  /** The agents after the moves of the step, by id (Sim.readAgents() of a simulation with growth off). */
  agents: readonly AgentState[];
  /** The moves into each cell in the step, 4 lanes per cell (Sim.readCounts()). */
  counts: Float32Array;
  /**
   * With the flow in the tubes: the flow memory of each strain before the step, 4 values per cell (Sim.readFlow()).
   * Without it the flow is off, and no cell is starved.
   */
  memory?: readonly Float32Array[];
  /**
   * For the tests of the rule only: the cells whose flow memory the rule of starved ground reads. The passes read
   * both, the cell of the parent (ADR 0029, decision 9) and the cell of the child (ADR 0053).
   */
  starvedCells?: 'both' | 'parent' | 'child';
  /**
   * With the rules of stage 4 (ADR 0068): the territory before the step, one byte per cell with bit s for strain s
   * (Sim.readTerritory()). A neighbour outside the territory of the parent's strain is not free. Without it every
   * neighbour may be.
   */
  territory?: Uint8Array;
  /** With the rules of stage 4 (ADR 0071): the births that the flux pays. They need `territory` and `memory`. */
  paid?: PaidInput;
}

/** What the births that the flux pays read in a growth step (GrowthInput.paid). */
export interface PaidInput {
  /** The sink rates of each strain before the step, one float per cell (Sim.readSinks()). */
  rates: readonly Float32Array[];
  /** The budget of each strain before the step (lane paid.ts BUDGET_LANE of its state, Sim.readSinkState()). */
  budget: readonly number[];
  /**
   * The keys that a GPU drew in the step, one float by id (Sim.readPaidKeys()): the rank then takes them. Without them
   * the CPU copy ranks its own keys. A key of a GPU differs from that of the CPU by a few units in the last place (ADR
   * 0071), and two keys that close could change places.
   */
  keys?: Float32Array;
}

/** The births that the flux pays in a growth step (growthStep()). */
export interface PaidStep {
  /** The key of every agent by id, as the CPU draws it: NO_KEY for an agent that cannot claim a paid child. */
  keys: Float32Array;
  /** F: the agents of the front of each strain. */
  front: number[];
  /** K: the paid claims of each strain. */
  claims: number[];
  /** The cell that each paid parent claims, by id. */
  parents: Map<number, number>;
}

/**
 * One step of growth and shrinkage after the moves, as the GPU runs it: the window counts of the occupancy after the
 * moves, shrinkage, the claims of the parents with the backend's claim keys, with `paid` the claims of the births that
 * the flux pays (paidClaims()), and the births of the dead agents in the order of their ids and of place(). Returns the
 * agents after the step, the window counts, and with `paid` the paid births of a growth step.
 */
export function growthStep(input: GrowthInput): { agents: AgentState[]; windows: Uint32Array; paid?: PaidStep } {
  const { kind, settings: s, w, h, env, step, counts } = input;
  const seed = s.seed >>> 0;
  const { cellAt, cellOf } = grid(w, h, s.boundary);
  const habitable = (c: number) => c >= 0 && (env[c * 4] ?? 0) < 128;
  // A cell outside a closed arena is no wall (wallIn in agents.wgsl).
  const wall = (c: number) => c >= 0 && (env[c * 4] ?? 0) >= 128;
  const occ = occupancy(input.agents, w, h, s.boundary);
  const windows = windowCounts(occ, w, h, s.boundary, s.growthWindow, s.shrinkWindow);
  const agents = input.agents.map((a) => ({ ...a }));
  const on = s.growth && s.collisions;
  const grow = on && s.growthEvery > 0 && step % s.growthEvery === 0;
  const shrink = on && s.shrinkEvery > 0 && step % s.shrinkEvery === 0;
  if (!grow && !shrink) return { agents, windows };
  const around = (k: number) => {
    const j = k + (k >= 4 ? 1 : 0);
    return [(j % 3) - 1, Math.floor(j / 3) - 1] as const;
  };
  // With the flow, a cell is starved for a strain while the flow memory of the strain lies below `half`, in f32 as
  // the shaders compute it (starved() in growth.wgsl). No agent divides on a starved cell (ADR 0029, decision 9), and
  // no child is born onto one: a starved neighbour is not free (ADR 0053).
  const half2 = Math.fround(FLOW.half * FLOW.half);
  const reads = input.starvedCells ?? 'both';
  const starved = (strain: number, c: number) => {
    const d = input.memory?.[strain]?.[c * 4];
    return d !== undefined && Math.fround(d * d) < half2;
  };
  const divideInto = (a: AgentState, id: number, c: number) => {
    const n = windows[c * 2] ?? 0;
    if (!grow || (counts[c * 4 + (a.bits & 3)] ?? 0) === 0 || n < s.growthMin || n > s.growthMax) return -1;
    if (reads !== 'child' && starved(a.bits & 3, c)) return -1;
    const [x, y] = [c % w, Math.floor(c / w)];
    const at = (dx: number, dy: number) => cellAt(x + dx, y + dy);
    // A diagonal neighbour only if the two cells beside the corner between it and c are not both walls (ADR 0025,
    // amendment of 2026-11-13).
    const open = Array.from({ length: 8 }, (_, k) => around(k))
      .filter(([dx, dy]) => habitable(at(dx, dy)) && occ[at(dx, dy)] === 0)
      .filter(([dx, dy]) => reads === 'parent' || !starved(a.bits & 3, at(dx, dy)))
      .filter(([dx, dy]) => !input.territory || (((input.territory[at(dx, dy)] ?? 0) >> (a.bits & 3)) & 1) === 1)
      .filter(([dx, dy]) => dx === 0 || dy === 0 || !(wall(at(dx, 0)) && wall(at(0, dy))))
      .map(([dx, dy]) => at(dx, dy));
    if (open.length === 0) return -1;
    const pick = Math.min(Math.floor(stream(rngSeed(id, GROW, step, seed))() * open.length), open.length - 1);
    const t = open[pick] ?? -1;
    // Light stops growth (lightStops in growth.wgsl; ADR 0050), in f32 as the shaders compute it.
    const chance = Math.fround(Math.fround(s.model === 'jones' ? 0 : s.lightGrowth) * (env[t * 4 + 2] ?? 0));
    if (chance > 0 && Math.fround(stream(rngSeed(id, SHADE, step, seed))() * 255) < chance) return -1;
    return t;
  };
  // Shrinkage, then the claims of the parents that survive.
  const claims = new Map<number, number>();
  const wants = new Map<number, number>();
  agents.forEach((a, id) => {
    const c = cellOf(a);
    if (!(a.bits & ALIVE) || c < 0) return;
    const n = windows[c * 2 + 1] ?? 0;
    if (shrink && (n < s.shrinkMin || n > s.shrinkMax)) {
      a.bits &= 3;
      return;
    }
    const t = divideInto(a, id, c);
    if (t < 0) return;
    const key = claimKey(kind, id, step, seed);
    wants.set(id, t);
    claims.set(t, Math.max(claims.get(t) ?? 0, key));
  });
  if (!grow) return { agents, windows };
  // The births that the flux pays, after Jones' births (ADR 0071): their claims join those of Jones' rule.
  const paid = input.paid ? paidClaims(input, agents, occ, wants, claims) : undefined;
  // The births in the order of place(), per strain, and the dead agents in the order of their ids.
  const births = new Map<number, { strain: number; cell: number }>();
  for (const [id, t] of [...wants, ...(paid?.parents ?? [])]) {
    const a = agents[id];
    if (a && claims.get(t) === claimKey(kind, id, step, seed))
      births.set(place(t, w, h, step, seed), { strain: a.bits & 3, cell: t });
  }
  const order = [...births.entries()].sort(([p], [q]) => p - q).map(([, b]) => b);
  const ends = strainEnds(s.strains, agents.length);
  s.strains.forEach((_, strain) => {
    const cells = order.filter((b) => b.strain === strain).map((b) => b.cell);
    let r = 0;
    for (let id = strain > 0 ? (ends[strain - 1] ?? 0) : 0; id < (ends[strain] ?? 0) && r < cells.length; id++) {
      const a = agents[id];
      if (!a || a.bits & ALIVE) continue;
      const t = cells[r++] ?? 0;
      const draw = stream(rngSeed(id, BIRTH, step, seed));
      const [fx, fy] = [draw(), draw()];
      const [x, y] = [t % w, Math.floor(t / w)];
      a.x = Math.min(Math.fround(x + fx), below(x + 1));
      a.y = Math.min(Math.fround(y + fy), below(y + 1));
      a.heading = Math.fround(draw() * TAU);
      a.bits = strain | ALIVE;
    }
  });
  return { agents, windows, ...(paid ? { paid } : {}) };
}

/**
 * The claims of the births that the flux pays in a growth step (ADR 0071; `test`, `rank` and `win` in growth.wgsl),
 * after Jones' claims: `agents` after shrinkage, `occ` the agents per cell after the moves, `wants` the cells that
 * Jones' parents claim, and `claims` the highest claim key of each cell, to which the paid claims are added.
 *
 * An agent of the front of strain s is alive and no parent of Jones' rule in this step; its cell has a sink rate of s
 * that is not 0 and is not starved for s; and it lies at the rim: a neighbour is open, empty after the moves and holds
 * no tube body of s. It draws the key −ln(1 − u) / |r| (paid.ts paidKey()) if a free cell of the territory of s lies
 * beside it, as Jones' rule finds one, and if its claim key is not 0 (a claim with the key 0 could not be told from no
 * claim); every other agent has the key NO_KEY. The ⌊B⌋ agents of the strain with the least keys claim, the same key
 * and a smaller id first: each the cell of its child with its claim key, a free cell without a tube body of s if one
 * lies beside it (the child goes out), else any free cell, picked with the draw of Jones' rule. Light may stop the
 * birth as it stops one of Jones' rule; then the agent makes no claim. A budget below 1 pays nothing.
 */
function paidClaims(
  input: GrowthInput,
  agents: readonly AgentState[],
  occ: Uint32Array,
  wants: ReadonlyMap<number, number>,
  claims: Map<number, number>,
): PaidStep {
  const { kind, settings: s, w, h, env, step, paid, memory, territory } = input;
  if (!paid || !memory || !territory) throw new Error('The births that the flux pays need rates, memory and territory');
  const seed = s.seed >>> 0;
  const { cellAt, cellOf } = grid(w, h, s.boundary);
  const strains = s.strains.length;
  const keys = new Float32Array(agents.length).fill(NO_KEY);
  const front = Array.from({ length: strains }, () => 0);
  const counted = Array.from({ length: strains }, () => 0);
  const parents = new Map<number, number>();
  // A cell outside a closed arena is no wall (wallIn in agents.wgsl).
  const wall = (c: number) => c >= 0 && (env[c * 4] ?? 0) >= 128;
  const half2 = Math.fround(FLOW.half * FLOW.half);
  const low = Math.fround(FLOW.bodyLow);
  const starved = (strain: number, c: number) => {
    const d = memory[strain]?.[c * 4] ?? 0;
    return Math.fround(d * d) < half2;
  };
  const bodyless = (strain: number, c: number) => (memory[strain]?.[c * 4 + 1] ?? 0) < low;
  const neighbours = (c: number) => {
    const [x, y] = [c % w, Math.floor(c / w)];
    return Array.from({ length: 8 }, (_, k) => {
      const j = k + (k >= 4 ? 1 : 0);
      const [dx, dy] = [(j % 3) - 1, Math.floor(j / 3) - 1];
      return { dx, dy, m: cellAt(x + dx, y + dy), beside: [cellAt(x + dx, y), cellAt(x, y + dy)] as const };
    });
  };
  const atRim = (strain: number, c: number) =>
    neighbours(c).some(({ m }) => m >= 0 && !wall(m) && occ[m] === 0 && bodyless(strain, m));
  // The free cells beside c for a child of strain s, in the order of the neighbours, as Jones' rule finds them.
  const free = (strain: number, c: number) =>
    neighbours(c)
      .filter(({ m }) => m >= 0 && !wall(m) && occ[m] === 0 && !starved(strain, m))
      .filter(({ m }) => (((territory[m] ?? 0) >> strain) & 1) === 1)
      .filter(({ dx, dy, beside }) => dx === 0 || dy === 0 || !(wall(beside[0]) && wall(beside[1])))
      .map(({ m }) => m);
  // The cell of the child of a paid parent, or −1 when light stops the birth.
  const childCell = (id: number, strain: number, c: number) => {
    const all = free(strain, c);
    const out = all.filter((m) => bodyless(strain, m));
    const pool = out.length > 0 ? out : all;
    if (pool.length === 0) return -1;
    const pick = Math.min(Math.floor(stream(rngSeed(id, GROW, step, seed))() * pool.length), pool.length - 1);
    const t = pool[pick] ?? -1;
    const chance = Math.fround(Math.fround(s.model === 'jones' ? 0 : s.lightGrowth) * (env[t * 4 + 2] ?? 0));
    if (chance > 0 && Math.fround(stream(rngSeed(id, SHADE, step, seed))() * 255) < chance) return -1;
    return t;
  };
  agents.forEach((a, id) => {
    const c = cellOf(a);
    if (!(a.bits & ALIVE) || c < 0 || wants.has(id)) return;
    const strain = a.bits & 3;
    const rate = Math.abs(paid.rates[strain]?.[c] ?? 0);
    if (rate === 0 || starved(strain, c) || !atRim(strain, c)) return;
    front[strain] = (front[strain] ?? 0) + 1;
    if (free(strain, c).length === 0 || claimKey(kind, id, step, seed) === 0) return;
    keys[id] = paidKey(stream(rngSeed(id, PAID_KEY, step, seed))(), rate);
  });
  const ranked = paid.keys ?? keys;
  const ends = strainEnds(s.strains, agents.length);
  for (let strain = 0; strain < strains; strain++) {
    const budget = Math.floor(Math.fround(paid.budget[strain] ?? 0));
    if (budget < 1) continue;
    const ids: number[] = [];
    for (let id = strain > 0 ? (ends[strain - 1] ?? 0) : 0; id < (ends[strain] ?? 0); id++)
      if ((ranked[id] ?? NO_KEY) < NO_KEY) ids.push(id);
    ids.sort((p, q) => (ranked[p] ?? 0) - (ranked[q] ?? 0) || p - q);
    for (const id of ids.slice(0, budget)) {
      const a = agents[id];
      if (!a) continue;
      const t = childCell(id, strain, cellOf(a));
      if (t < 0) continue;
      parents.set(id, t);
      claims.set(t, Math.max(claims.get(t) ?? 0, claimKey(kind, id, step, seed)));
      counted[strain] = (counted[strain] ?? 0) + 1;
    }
  }
  return { keys, front, claims: counted, parents };
}
