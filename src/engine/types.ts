import type { Settings } from '../model/params';
import type { AgentTool } from './pack';

export const EnvKind = { erase: 0, wall: 1, food: 2, light: 3 } as const;
export type EnvTool = keyof typeof EnvKind;

/** A brush stroke on the environment, in grid cells. */
export interface Stroke {
  kind: EnvTool;
  from: [number, number];
  to: [number, number];
  radius: number;
}

/** Pan and zoom: `center` is the grid position at the canvas center, `scale` is cells per pixel. */
export interface View {
  center: [number, number];
  scale: number;
}

/** One agent; `bits`: strain in bits 0–1, alive in bit 2. */
export interface AgentState {
  x: number;
  y: number;
  heading: number;
  bits: number;
}

/** One simulation (grid size and agent count fixed) on one GPU API. */
export interface Sim {
  readonly width: number;
  readonly height: number;
  readonly agents: number;
  readonly step: number;
  update(settings: Settings): void;
  reset(): void;
  run(steps: number, tool?: AgentTool): void;
  paint(stroke: Stroke): void;
  clearEnvironment(): void;
  destroy(): void;
  /** Resolves when all submitted GPU work is done. */
  finish(): Promise<void>;
  /** Alive agents per strain after the last step (empty if the backend cannot count). */
  alive(): Promise<number[]>;
  readAgents(): Promise<AgentState[]>;
  /** Trail, 4 lanes per cell, rows from y = 0. */
  readTrail(): Promise<Float32Array>;
  /** Agents that moved into each cell in the last step, 4 lanes per cell. */
  readCounts(): Promise<Float32Array>;
  /** Wall, food, light, unused per cell (0–255). */
  readEnv(): Promise<Uint8Array>;
  writeAgent(index: number, a: AgentState): void;
  writeTrail(data: Float32Array): void;
}

/**
 * Auto levels: `gain` maps trail units to radiance before the exposure setting (0 until a measurement found
 * any trail; frames then use 0.4 / equilibrium), `black` is the summed trail level shown as black.
 */
export interface Levels {
  gain: number;
  black: number;
}

/** A GPU API: creates simulations and draws them. */
export interface Backend<S extends Sim = Sim> {
  readonly kind: 'webgpu' | 'webgl2';
  /** Adapter or renderer description, for diagnostics. */
  readonly description: string;
  readonly maxAgents: number;
  /** Largest single buffer or texture in bytes (one 16-byte texel per cell must fit). */
  readonly maxBufferBytes: number;
  /** Largest grid side it can draw: the texture size limit less the gel height field's border. */
  readonly maxGridSide: number;
  /** GPU bytes per grid cell, for the memory estimate (sizing.ts). */
  readonly bytesPerCell: number;
  readonly supportsCollisions: boolean;
  /** Resolves with a message if the device or context is lost. */
  readonly lost: Promise<string>;
  createSim(settings: Settings, width: number, height: number, agents: number): Promise<S>;
  /** Draws a frame; `measure` lets auto levels sample the trail. */
  draw(sim: S, settings: Settings, view: View, measure: boolean): void;
  capture(sim: S, settings: Settings, view: View, width: number, height: number): Promise<ImageData>;
  /** Measures auto levels now instead of smoothing over frames; resolves with the levels frames now use. */
  settle(sim: S): Promise<Levels>;
  /** Drops caches tied to a replaced simulation and restarts auto levels. */
  forget(): void;
  destroy(): void;
}
