import { capacityOf, RESOLUTIONS, type Settings } from '../model/params';

/**
 * Agents for a `width` × `height` grid: the density times the cells of the arena's square. A dish counts the square
 * of the grid's short side, as Jones counts his population over a square lattice that the dish fills (%p, a share
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

/** Trail level of a uniform population: deposit · agents per cell / decay. Sets the exposure scale. */
export function equilibrium(s: Settings): number {
  const total = s.strains.reduce((a, st) => a + st.share, 0);
  return Math.max(...s.strains.map((st) => (st.deposit * s.density * st.share) / total / st.decay), 1e-6);
}

export interface Diffuse {
  first: boolean;
  last: boolean;
  blur: boolean;
}

/** Diffusion dispatches for one step (Jones: 1 pass, Fogleman: 2, 0 = deposit and decay only). */
export function diffusePlan(passes: number): Diffuse[] {
  if (passes <= 0) return [{ first: true, last: true, blur: false }];
  return Array.from({ length: passes }, (_, i) => ({ first: i === 0, last: i === passes - 1, blur: true }));
}

/**
 * GPU bytes per grid cell: trail 32, scent 16, counts 16, environment 4, the renderer's outline
 * distances 4, collision buffers 12, the bloom chain about 2.7, the gel height field about 2 and the
 * walls' clearance 0.125 (8 B per tile of 8 × 8 cells, ADR 0020). WebGL2 without float blending has
 * no collision buffers but 32 B of counting panels with a stencil (gl/sim.ts deposit()).
 */
export const BYTES_PER_CELL = 90;
export const BYTES_PER_CELL_HALF_FLOAT = 110;
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
/** Per agent: two copies on both backends (WebGL2 ping-pongs its agent texture, WebGPU sorts into its second buffer). */
export const BYTES_PER_AGENT = 32;

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

export function fitResolution(s: Settings, aspect: number, l: Limits): number {
  const options = RESOLUTIONS.filter((r) => r <= s.resolution);
  for (const r of options.reverse()) {
    const [w, h] = gridSize(r, aspect);
    const fits =
      estimateBytes(w, h, Math.min(l.maxAgents, capacityCount(s, w, h)), l.bytesPerCell, l.bytesPerAgent) <= l.budget &&
      w * h * 16 <= l.maxBufferBytes && // the largest per-cell buffer: 16 B (counts, trail texel)
      Math.max(w, h) <= l.maxGridSide;
    if (fits) return r;
  }
  return RESOLUTIONS[0];
}
