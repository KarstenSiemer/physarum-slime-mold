import { capacityOf, MEAN_WINDOW, meanWindowOf, RESOLUTIONS, type Lattice, type Settings } from '../model/params';
import { flowOn, flowStrains } from './flow';
import { slimeModel } from './slime';
import { TUBE_TILE } from './tubes';

/**
 * Agents for a `width` × `height` grid: the density times the cells of the arena's square. A dish counts the square
 * of the grid's short side, as Jones counts his population over the square lattice around his dish (%p, a share
 * of the image area: Jones 2010, p. 134; 45,000 agents for %p 50 on 300 × 300, p. 147). A box or a periodic grid
 * counts all its cells.
 */
export function agentCount(s: Pick<Settings, 'density' | 'boundary'>, width: number, height: number): number {
  const cells = s.boundary === 'dish' ? Math.min(width, height) ** 2 : width * height;
  return Math.round(s.density * cells);
}

/**
 * The agents that the simulation holds, alive and dead: agentCount() at the capacity (ADR 0025). The first
 * agentCount() of them start alive.
 */
export function capacityCount(
  s: Pick<Settings, 'density' | 'capacity' | 'boundary' | 'collisions'>,
  width: number,
  height: number,
) {
  return agentCount({ density: capacityOf(s), boundary: s.boundary }, width, height);
}

/** Grid size for a resolution (cells on the long side) and an aspect ratio (width / height). */
export function gridSize(resolution: number, aspect: number): [number, number] {
  return aspect >= 1
    ? [resolution, Math.max(16, Math.round(resolution / aspect))]
    : [Math.max(16, Math.round(resolution * aspect)), resolution];
}

/**
 * The grid of the settings: the lattice, which keeps its cells on every screen, or else a grid of `resolution` cells
 * on the long side shaped like the screen (ADR 0026).
 */
export function gridOf(s: Pick<Settings, 'resolution' | 'lattice'>, aspect: number): Lattice {
  return s.lattice ? [s.lattice[0], s.lattice[1]] : gridSize(s.resolution, aspect);
}

/** Trail level of a uniform population: deposit · agents per cell / decay. Sets the exposure scale. */
export function equilibrium(s: Settings): number {
  const total = s.strains.reduce((a, st) => a + st.share, 0);
  return Math.max(...s.strains.map((st) => (st.deposit * s.density * st.share) / total / st.decay), 1e-6);
}

export interface Diffuse {
  first: boolean;
  last: boolean;
  blur: boolean;
  /**
   * One half of the mean over a window above 3 × 3 (ADR 0046): the sums along the rows, or the sums of those along
   * the columns with the mean. `radius`: the cells of the window on each side of its middle. Without it the dispatch
   * is the 3 × 3 mean.
   */
  box?: { radius: number; columns: boolean };
}

/**
 * Diffusion dispatches for one step (Jones: 1 pass, Fogleman: 2, 0 = deposit and decay only). `window`: the side of
 * the mean window (ADR 0046). With 3 a pass is one dispatch, the 3 × 3 mean of the code before. Above 3 a pass is
 * two dispatches: the sums along the rows of the window, then their sums along its columns and the mean.
 */
export function diffusePlan(passes: number, window: number = MEAN_WINDOW): Diffuse[] {
  if (passes <= 0) return [{ first: true, last: true, blur: false }];
  if (window <= MEAN_WINDOW)
    return Array.from({ length: passes }, (_, i) => ({ first: i === 0, last: i === passes - 1, blur: true }));
  const radius = (window - 1) / 2;
  return Array.from({ length: passes }, (_, i): Diffuse[] => [
    { first: i === 0, last: false, blur: true, box: { radius, columns: false } },
    { first: false, last: i === passes - 1, blur: true, box: { radius, columns: true } },
  ]).flat();
}

/** The diffusion dispatches of a step of these settings: the passes, with the mean window of the model. */
export const diffusePlanOf = (s: Pick<Settings, 'diffusion' | 'model' | 'meanWindow'>) =>
  diffusePlan(s.diffusion, meanWindowOf(s));

/**
 * GPU bytes per grid cell: trail 32, scent 16, counts 16, environment 4, the renderer's outline
 * distances 4 for walls and food and 4 for the electrodes, collision buffers 12, the bloom chain about 2.7, the gel
 * height field about 2, the walls' clearance 0.125 (8 B per tile of 8 × 8 cells, ADR 0020), and the two coarse maps
 * of the view, 4 each: the trail's for a view zoomed out and the scent view's (16 B per texel, a quarter of a texel
 * per cell; render.ts, gl/backend.ts). The user zooms out or turns the scent view on without a new grid, so the fit
 * holds both maps from the start (ADR 0028). So with the outline distances of the electrodes (ADR 0058; sim.ts
 * `poles`, gl/sim.ts `poles`): a simulation makes them at its first pole, and a stroke must not change the grid.
 * WebGL2 without float blending has no collision buffers but 32 B of counting panels with a stencil (gl/sim.ts
 * deposit()); its coarse maps are the same. The electrodes themselves (ADR 0047) lie in the fourth byte of the
 * environment's 4.
 */
export const BYTES_PER_CELL = 102;
export const BYTES_PER_CELL_HALF_FLOAT = 122;
/**
 * More bytes per cell while covered food is on (ADR 0022): WebGL2 without float blending marks the cells with an agent
 * in a target of 1 B (gl/sim.ts `presence`). Elsewhere covered food counts into the collision buffers, which
 * BYTES_PER_CELL holds already.
 */
export const COVERED_BYTES_PER_CELL_HALF_FLOAT = 1;
/**
 * More bytes while growth is on (ADR 0025): per cell the row sums and window counts (8 B each), the claims (4 B), the
 * births (8 B) and the pyramid over them (16 B per node, a third of a node per cell); per agent its dead flag and the
 * pyramid over them (4 B per node). Both backends hold the same.
 */
export const GROWTH_BYTES_PER_CELL = 34;
export const GROWTH_BYTES_PER_AGENT = 6;
/**
 * More bytes per cell for the view of a step that moves first with two diffusion dispatches or more (ADR 0027): a
 * third trail of 16 B and scent of 8 B (sim.ts viewTextures, gl/sim.ts viewTargets()). With one dispatch the view uses
 * the free pair, and sensing first it uses none. A mean window above 3 × 3 runs two dispatches per pass (ADR 0046,
 * diffusePlan()), so its view needs the third pair with one pass too. The simulation itself needs no texture more for
 * that window: the sums along the rows go into the free pair, and the mean goes back into the pair that held the map.
 */
export const VIEW_BYTES_PER_CELL = 24;

/**
 * More bytes per cell and strain while the flow in the tubes is on (ADR 0029): the memory of each cell in two textures
 * and the pressure of the four lanes in three, 16 B per cell each (sim.ts FlowState, gl/sim.ts `flow`). Both backends
 * hold the same.
 */
export const FLOW_BYTES_PER_CELL = 80;

/**
 * More bytes per cell while the flow is on, once for all strains: the cells of the food sites (ADR 0029, decision 17;
 * sim.ts `siteCells`, gl/sim.ts siteCells()), an index of 4 B for each, and no cell in two sites (sites.ts).
 */
export const SITE_BYTES_PER_CELL = 4;

/**
 * The bytes per cell of the flow of these settings: every strain has a flow of its own (ADR 0031), and all share the
 * cells of the food sites; 0 while the flow is off.
 */
export const flowBytesPerCell = (s: Pick<Settings, 'flow' | 'model' | 'strains'>) =>
  flowOn(s) ? FLOW_BYTES_PER_CELL * flowStrains(s) + SITE_BYTES_PER_CELL : 0;

/**
 * More bytes per cell for the picture of the tubes (tubes.ts, ADR 0034): per cell and strain the factor of the radius
 * of its tube, the picture, and per cell the stream of the plasm, 16 B per cell each (sim.ts TubeState, gl/sim.ts
 * `tubes`). Both backends hold the same.
 */
export const TUBES_BYTES_PER_CELL = 48;

/**
 * More bytes per cell for the picture of the tubes on WebGL2 (Backend.tubeMapBytesPerCell): the map of the tiles of the
 * picture, 4 B per tile of TUBE_TILE × TUBE_TILE cells, and its rows, 4 B per TUBE_TILE cells of a row (gl/sim.ts
 * `tubes`; ADR 0034, amendment of 2026-11-15). WebGPU holds what it needs of them in the memory of a workgroup.
 */
export const TUBE_MAP_BYTES_PER_CELL_GL = 4 / TUBE_TILE + 4 / TUBE_TILE ** 2;

/**
 * The bytes per cell of the picture of the tubes: counted while the flow is on, with the picture or without it. The
 * switch of the picture changes only the view, so it must not change the grid that fits the memory. `map`: the bytes
 * per cell of the map of the tiles of the backend (Backend.tubeMapBytesPerCell).
 */
export const tubesBytesPerCell = (s: Pick<Settings, 'flow' | 'model'>, map = 0) =>
  flowOn(s) ? TUBES_BYTES_PER_CELL + map : 0;

/**
 * More bytes per cell for the slime field and its picture (ADR 0055, decision 9; ADR 0057; ADR 0060). Both backends
 * hold the same.
 * - The stamp of each cell, 4 B (sim.ts `slime`, a buffer; gl/sim.ts `slime`, a target of unsigned integers).
 * - The amount of slime of each cell, 4 B (sim.ts `amount`, a buffer; gl/sim.ts `amount`, two targets of 2 B, because
 *   its pass reads the amounts of before a step).
 * - The maps of the film of the renderer: 2 B per cell, and 2 B per texel of the coarse map for a view zoomed out, a
 *   quarter of a texel per cell (render.ts, gl/backend.ts). The user turns Show slime on or zooms out without a new
 *   grid, so the fit holds both maps from the start, as it holds the coarse maps of the trail and of the scent.
 * - The front stamp of each cell, 4 B (sim.ts `front`, a buffer; gl/sim.ts `front`, a target of unsigned integers),
 *   and the map of the growth front of the renderer: 16 B per texel of 8 × 8 cells (ADR 0060).
 * That is 14.75 B, counted as 15.
 */
export const SLIME_BYTES_PER_CELL = 15;

/**
 * The bytes per cell of the slime field: counted in the extended model, with a Slime life time above 0 or with 0. The
 * setting changes no grid that fits the memory. The Jones model has no slime: 0.
 */
export const slimeBytesPerCell = (s: Pick<Settings, 'model'>) => (slimeModel(s) ? SLIME_BYTES_PER_CELL : 0);

/** Whether the view needs its third trail texture (VIEW_BYTES_PER_CELL). */
export const viewTrailOn = (s: Pick<Settings, 'stepOrder' | 'diffusion' | 'model' | 'meanWindow'>) =>
  s.stepOrder === 'move-first' && diffusePlanOf(s).length >= 2;

/** Per agent: two copies on both backends (WebGL2 ping-pongs its agent texture, WebGPU sorts into its second buffer). */
export const BYTES_PER_AGENT = 32;
/**
 * Per agent on WebGL2: BYTES_PER_AGENT and the order of its point passes (gl/sim.ts sortOrder(), ADR 0028), two copies
 * of 8 B per agent slot and the pyramid of the sort, 16 B per node of 4 slots and less above: about 5.33 B per slot,
 * counted as 6.
 */
export const BYTES_PER_AGENT_GL = BYTES_PER_AGENT + 22;

/** Memory budget: an eighth of the device memory hint (Chrome only), at most 1 GiB; 512 MiB if unknown. */
export function memoryBudget(deviceMemoryGb?: number): number {
  return Math.min(2 ** 30, (deviceMemoryGb ?? 4) * 2 ** 27);
}

export function estimateBytes(
  width: number,
  height: number,
  agents: number,
  bytesPerCell = BYTES_PER_CELL,
  bytesPerAgent = BYTES_PER_AGENT,
): number {
  return width * height * bytesPerCell + agents * bytesPerAgent;
}

/**
 * Largest allowed grid resolution for these settings within `budget` bytes. Untrusted links can
 * ask for 4096 cells at 8 agents per cell (about 1 GB), which would crash a weaker device.
 */
export interface Limits {
  maxAgents: number;
  /** Largest single buffer or texture in bytes. */
  maxBufferBytes: number;
  /** Largest grid side. */
  maxGridSide: number;
  /** Total memory budget in bytes. */
  budget: number;
  /** GPU bytes per grid cell on this backend (default BYTES_PER_CELL). */
  bytesPerCell?: number;
  /** GPU bytes per agent (default BYTES_PER_AGENT; more while growth is on). */
  bytesPerAgent?: number;
}

/** Whether a `w` × `h` grid with the agents that these settings hold (capacityCount()) fits the limits. */
export function fits(s: Settings, w: number, h: number, l: Limits): boolean {
  return (
    estimateBytes(w, h, Math.min(l.maxAgents, capacityCount(s, w, h)), l.bytesPerCell, l.bytesPerAgent) <= l.budget &&
    // The largest buffer per cell: 16 B (counts). A texture has no limit in bytes, only in its sides: the trail texel
    // of 16 B, and on WebGPU a texture of the flow with a layer of 16 B per cell for each strain (ADR 0031).
    w * h * 16 <= l.maxBufferBytes &&
    Math.max(w, h) <= l.maxGridSide
  );
}

export function fitResolution(s: Settings, aspect: number, l: Limits): number {
  const options = RESOLUTIONS.filter((r) => r <= s.resolution);
  for (const r of options.reverse()) {
    const [w, h] = gridSize(r, aspect);
    if (fits(s, w, h, l)) return r;
  }
  return RESOLUTIONS[0];
}
