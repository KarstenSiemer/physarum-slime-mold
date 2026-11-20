// The CPU copy of the territory (territory.ts, ADR 0068), for tests only: territory.gpu.test.ts steps it from the
// state that a GPU backend leaves and compares both backends with it. It holds the passes of shaders/territory.wgsl
// and gl/glsl/territory.frag (the owners, the push, a disc of the start territory) and the rules that read the
// territory in agents.wgsl and tools.glsl (a move, a respawn); growth-reference.ts holds the rule of a birth.
import type { Boundary } from '../model/params';
import { FLOW } from './flow';
import { claimKey, grid, rngSeed, stream } from './growth-reference';
import { PUSH, PUSH_CHANCES } from './territory';
import type { AgentState } from './types';

const ALIVE = 4;
const TAU = Math.fround(6.28318530717959);
// Random streams of agents.wgsl.
const BLOCK = 3;
const RESPAWN = 8;

/** A grid and its environment: wall, food, light and electrode byte per cell (Sim.readEnv()). */
export interface TerritoryGrid {
  w: number;
  h: number;
  boundary: Boundary;
  env: Uint8Array;
}

/** Whether cell c (an index, or −1) is open: in the arena and no wall. */
const open = (g: TerritoryGrid, c: number) => c >= 0 && (g.env[c * 4] ?? 0) < 128;

/** The owners (territory.wgsl `fillOwners`): per cell bit s for an alive agent of strain s in it. */
export function owners(agents: readonly AgentState[], g: TerritoryGrid): Uint8Array {
  const { cellOf } = grid(g.w, g.h, g.boundary);
  const out = new Uint8Array(g.w * g.h);
  for (const a of agents) {
    const c = cellOf(a);
    if (a.bits & ALIVE && c >= 0) out[c] = (out[c] ?? 0) | (1 << (a.bits & 3));
  }
  return out;
}

/**
 * The push of step `step` (territory.wgsl `push`): the territory after the step, from the territory before it and the
 * owners after the moves and the births. A cell joins the territory of every strain that owns it. An open cell outside
 * the territory of strain s joins it if the draw of its stream for s lies below the chance of the n agents of s among
 * its 8 neighbours (PUSH_CHANCES). A cell outside a closed arena keeps its byte.
 */
export function push(
  territory: Uint8Array,
  owned: Uint8Array,
  g: TerritoryGrid,
  step: number,
  seed: number,
): Uint8Array {
  const { cellAt } = grid(g.w, g.h, g.boundary);
  const out = territory.slice();
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const c = cellAt(x, y);
      if (c < 0) continue;
      let bits = (territory[c] ?? 0) | (owned[c] ?? 0);
      if (open(g, c)) {
        const n = [0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const m = dx === 0 && dy === 0 ? -1 : cellAt(x + dx, y + dy);
            const b = m < 0 ? 0 : (owned[m] ?? 0);
            for (let s = 0; s < 4; s++) n[s] = (n[s] ?? 0) + ((b >> s) & 1);
          }
        let joined = 0;
        for (let s = 0; s < 4; s++) {
          const k = n[s] ?? 0;
          if (bits & (1 << s) || k === 0) continue;
          const u = stream(rngSeed(c, PUSH + 0x10000 * s, step, seed >>> 0))();
          if (u < (PUSH_CHANCES[k - 1] ?? 0)) joined |= 1 << s;
        }
        bits |= joined;
      }
      out[c] = bits;
    }
  return out;
}

/**
 * A disc of the start territory (territory.wgsl `addDisc`): every open cell whose centre lies within `radius` of
 * (x, y), on the periodic grid of the nearest copy, joins the territory of `strain`. `unsure`: the cells whose centre
 * lies within 0.001 cells of the rim, which float32 can put on either side.
 */
export function addDisc(
  territory: Uint8Array,
  g: TerritoryGrid,
  strain: number,
  [x, y]: readonly [number, number],
  radius: number,
): { territory: Uint8Array; unsure: Set<number> } {
  const { cellAt } = grid(g.w, g.h, g.boundary);
  const out = territory.slice();
  const unsure = new Set<number>();
  const across = (d: number, size: number) => (g.boundary === 'wrap' ? d - size * Math.round(d / size) : d);
  for (let cy = 0; cy < g.h; cy++)
    for (let cx = 0; cx < g.w; cx++) {
      const c = cellAt(cx, cy);
      if (!open(g, c)) continue;
      const d = Math.hypot(across(cx + 0.5 - x, g.w), across(cy + 0.5 - y, g.h));
      if (Math.abs(d - radius) < 1e-3) unsure.add(c);
      else if (d <= radius) out[c] = (out[c] ?? 0) | (1 << strain);
    }
  return { territory: out, unsure };
}

/**
 * The moves of a step under the territory (canClaim in agents.wgsl), from the agents before the step and after it in
 * a twin whose territory holds every cell for every strain: an alive agent whose move in the twin ended in another cell
 * that lies outside the territory of its strain is blocked. It stays where it was, and takes the heading of the stream
 * of a blocked move. Every other agent does what it does in the twin. Exact while no two agents claim the same cell.
 */
export function territoryMoves(
  before: readonly AgentState[],
  free: readonly AgentState[],
  territory: Uint8Array,
  g: TerritoryGrid,
  step: number,
  seed: number,
): { agents: AgentState[]; blocked: number; moved: number } {
  const { cellOf } = grid(g.w, g.h, g.boundary);
  let [blocked, moved] = [0, 0];
  const agents = free.map((b, id) => {
    const a = before[id];
    if (!a || !(a.bits & ALIVE) || !(b.bits & ALIVE)) return { ...b };
    const [from, to] = [cellOf(a), cellOf(b)];
    if (to === from) return { ...b };
    if (((territory[to] ?? 0) >> (a.bits & 3)) & 1) {
      moved++;
      return { ...b };
    }
    blocked++;
    const heading = Math.fround(stream(rngSeed(id, BLOCK, step, seed >>> 0))() * TAU);
    return { ...a, heading };
  });
  return { agents, blocked, moved };
}

export interface RespawnInput {
  kind: 'webgpu' | 'webgl2';
  g: TerritoryGrid;
  /** The agents before the step, by id; alive agents make no move here, so the test holds none. */
  agents: readonly AgentState[];
  /** The memory of the flow of each strain before the step, 4 values per cell (Sim.readFlow()). */
  memory: readonly Float32Array[];
  /** The territory before the step, or none: then every cell lies in it. */
  territory?: Uint8Array;
  step: number;
  seed: number;
}

/**
 * The respawn of a step with one agent per cell and without a tool (respawn() in agents.wgsl and tools.glsl, then the
 * claims of `claim` and `settle`): a dead agent draws a point of the grid. Its cell must be open, empty at the start of
 * the step, in the territory of its strain, and hold a tube of its strain; it then comes to life with the chance
 * birth · (D − from) / (1 − from), in float32 as the passes compute it. Of the agents that claim one cell, the one with
 * the highest key of the backend takes it. Returns the agents after the step, and how many draws the territory refused.
 */
export function respawnStep(input: RespawnInput): { agents: AgentState[]; refused: number } {
  const { kind, g, step, memory } = input;
  const seed = input.seed >>> 0;
  const f = Math.fround;
  const { cellAt } = grid(g.w, g.h, g.boundary);
  const occ = new Uint8Array(g.w * g.h);
  for (const a of input.agents) {
    const c = grid(g.w, g.h, g.boundary).cellOf(a);
    if (a.bits & ALIVE && c >= 0) occ[c] = 1;
  }
  const [birth, from, low] = [f(FLOW.birth), f(FLOW.birthFrom), f(FLOW.bodyLow)];
  let refused = 0;
  const spots = new Map<number, { x: number; y: number; heading: number; cell: number }>();
  input.agents.forEach((a, id) => {
    if (a.bits & ALIVE) return;
    const s = a.bits & 3;
    const draw = stream(rngSeed(id, RESPAWN, step, seed));
    const [px, py] = [f(draw() * g.w), f(draw() * g.h)];
    const c = cellAt(Math.floor(px), Math.floor(py));
    if (!open(g, c) || occ[c]) return;
    if (input.territory && !(((input.territory[c] ?? 0) >> s) & 1)) {
      refused++;
      return;
    }
    const m = memory[s];
    const [d, body] = [m?.[c * 4] ?? 0, m?.[c * 4 + 1] ?? 0];
    if (body < low || draw() >= f(f(birth * f(d - from)) / f(1 - from))) return;
    spots.set(id, { x: px, y: py, heading: f(draw() * TAU), cell: c });
  });
  const claims = new Map<number, number>();
  for (const [id, spot] of spots)
    claims.set(spot.cell, Math.max(claims.get(spot.cell) ?? 0, claimKey(kind, id, step, seed)));
  const agents = input.agents.map((a, id) => {
    const spot = spots.get(id);
    if (!spot || claims.get(spot.cell) !== claimKey(kind, id, step, seed)) return { ...a };
    return { x: spot.x, y: spot.y, heading: spot.heading, bits: (a.bits & 3) | ALIVE };
  });
  return { agents, refused };
}
