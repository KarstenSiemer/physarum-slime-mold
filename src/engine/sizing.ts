import { RESOLUTIONS, type Settings } from '../model/params';

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
 * GPU bytes per grid cell: trail 32, scent 16, counts 16, environment 4, collision buffers 12, the
 * bloom chain about 2.7 and the gel height field about 2. WebGL2 without float blending has no
 * collision buffers but 32 B of counting panels with a stencil (gl/sim.ts deposit()).
 */
export const BYTES_PER_CELL = 86;
export const BYTES_PER_CELL_HALF_FLOAT = 106;
/** Per agent: two copies on both backends (WebGL2 ping-pongs its agent texture, WebGPU sorts into its second buffer). */
const BYTES_PER_AGENT = 32;

/** Memory budget: an eighth of the device memory hint (Chrome only), at most 1 GiB; 512 MiB if unknown. */
export function memoryBudget(deviceMemoryGb?: number): number {
  return Math.min(2 ** 30, (deviceMemoryGb ?? 4) * 2 ** 27);
}

export function estimateBytes(width: number, height: number, agents: number, bytesPerCell = BYTES_PER_CELL): number {
  return width * height * bytesPerCell + agents * BYTES_PER_AGENT;
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
}

export function fitResolution(s: Settings, aspect: number, l: Limits): number {
  const options = RESOLUTIONS.filter((r) => r <= s.resolution);
  for (const r of options.reverse()) {
    const [w, h] = gridSize(r, aspect);
    const fits =
      estimateBytes(w, h, Math.min(l.maxAgents, s.density * w * h), l.bytesPerCell) <= l.budget &&
      w * h * 16 <= l.maxBufferBytes && // the largest per-cell buffer: 16 B (counts, trail texel)
      Math.max(w, h) <= l.maxGridSide;
    if (fits) return r;
  }
  return RESOLUTIONS[0];
}
