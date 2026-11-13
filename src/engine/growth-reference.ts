// The CPU copy of growth and shrinkage (shaders/growth.wgsl, gl/glsl/growth.frag and growth.vert; ADR 0025), for
// tests only: sim.gpu.test.ts steps it from the state after the moves of a step and compares both GPU backends with it.
import type { Boundary, Settings } from '../model/params';
import { DISH_FILL } from './brush';
import { pyramidLevels, strainEnds } from './pack';
import type { AgentState } from './types';

const ALIVE = 4;
const TAU = Math.fround(6.28318530717959);
// Random streams of growth.wgsl.
const GROW = 4;
const BIRTH = 5;
const PLACE_ORDER = 6;

/** PCG hash of common.wgsl and common.glsl. */
export function pcg(v: number): number {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

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
}

/**
 * One step of growth and shrinkage after the moves, as the GPU runs it: the window counts of the occupancy after the
 * moves, shrinkage, the claims of the parents with the backend's claim keys, and the births of the dead agents in the
 * order of their ids and of place(). Returns the agents after the step and the window counts.
 */
export function growthStep(input: GrowthInput): { agents: AgentState[]; windows: Uint32Array } {
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
  const divideInto = (a: AgentState, id: number, c: number) => {
    const n = windows[c * 2] ?? 0;
    if (!grow || (counts[c * 4 + (a.bits & 3)] ?? 0) === 0 || n < s.growthMin || n > s.growthMax) return -1;
    const [x, y] = [c % w, Math.floor(c / w)];
    const at = (dx: number, dy: number) => cellAt(x + dx, y + dy);
    // A diagonal neighbour only if neither cell beside the corner between it and c is a wall (ADR 0025, amendment
    // of 2026-11-13).
    const open = Array.from({ length: 8 }, (_, k) => around(k))
      .filter(([dx, dy]) => habitable(at(dx, dy)) && occ[at(dx, dy)] === 0)
      .filter(([dx, dy]) => dx === 0 || dy === 0 || (!wall(at(dx, 0)) && !wall(at(0, dy))))
      .map(([dx, dy]) => at(dx, dy));
    if (open.length === 0) return -1;
    const pick = Math.min(Math.floor(stream(rngSeed(id, GROW, step, seed))() * open.length), open.length - 1);
    return open[pick] ?? -1;
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
  // The births in the order of place(), per strain, and the dead agents in the order of their ids.
  const births = new Map<number, { strain: number; cell: number }>();
  for (const [id, t] of wants) {
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
  return { agents, windows };
}

/** Nodes of the levels of a pyramid over n elements, the elements first (for tests of the sizes). */
export const pyramidSizes = (n: number) => [n, ...pyramidLevels(n)];
