import type { Boundary, Settings } from '../model/params';
import type { AgentTool } from './pack';

export const EnvKind = { erase: 0, wall: 1, food: 2, light: 3 } as const;
export type EnvTool = keyof typeof EnvKind;

/**
 * Cells: the renderer's outline distances are clamped to ± this (SHAPE_RANGE in paint.wgsl, render.wgsl,
 * gl/glsl/shape.frag and gl/glsl/render.frag), so a stroke updates them this far beyond its radius.
 */
export const SHAPE_RANGE = 4;

/** A brush stroke on the environment, in grid cells. */
export interface Stroke {
  kind: EnvTool;
  from: [number, number];
  to: [number, number];
  radius: number;
  /** The boundary to paint under: it decides whether the stroke wraps around the edges. Default: the current one. */
  boundary?: Boundary;
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
  /**
   * Counts the changes of the trail, the scent, the food, light and walls and their outlines outside steps (a reset,
   * strokes, a clear, writes, new settings of a step that moves first); `step` counts the steps. With the simulation
   * itself they tell whether a picture or a map made from its state is still current.
   */
  readonly revision: number;
  update(settings: Settings): void;
  reset(): void;
  /** Runs `steps` steps. The agent tool acts on every one of them (ADR 0023). */
  run(steps: number, tool?: AgentTool): void;
  /**
   * Whether one of the next `steps` steps would sort the agents by position first (WebGPU, sim.ts). A backend without
   * the sort has no such method.
   */
  sortDue?(steps: number): boolean;
  /**
   * Sorts now, in a submission of its own, in place of the sort of that step (ADR 0028): the engine then runs one step
   * less in the frame. The sort changes no result (ADR 0005).
   */
  sortNow?(): void;
  /** Paints brush strokes in order: the only way food, light and walls reach a simulation. */
  paint(strokes: readonly Stroke[]): void;
  clearEnvironment(): void;
  destroy(): void;
  /** Resolves when all submitted GPU work is done. */
  finish(): Promise<void>;
  /** Alive agents per strain after the last step or reset (empty if the backend cannot count). */
  alive(): Promise<number[]>;
  readAgents(): Promise<AgentState[]>;
  /** Trail, 4 lanes per cell, rows from y = 0. */
  readTrail(): Promise<Float32Array>;
  /**
   * The trail map that the view draws, 4 lanes per cell: the map after the step's diffusion (ADR 0027). Sensing first
   * it is the trail; moving first the step's diffusion of the trail without its sources.
   */
  readView(): Promise<Float32Array>;
  /** The scent that the view draws, 2 values per cell: the scent of the same state as readView() (ADR 0027). */
  readViewScent(): Promise<Float32Array>;
  /** Food scent and light repellent, 2 values per cell, rows from y = 0. */
  readScent(): Promise<Float32Array>;
  /** Agents that moved into each cell in the last step, 4 lanes per cell. */
  readCounts(): Promise<Float32Array>;
  /**
   * For tests: the agents in the growth and the shrinkage window around each cell (2 per cell), as the last step that
   * tested growth or shrinkage counted them after its moves (ADR 0025). Empty before such a step.
   */
  readWindows(): Promise<Uint32Array>;
  /** Wall, food, light, unused per cell (0–255). */
  readEnv(): Promise<Uint8Array>;
  /**
   * For the renderer: the signed distance to the wall and to the food outline (0–255, 128 and up inside,
   * ±SHAPE_RANGE cells at 0 and 255), the light as in `readEnv()`, and the drop shadow of the walls (0–255).
   */
  readShape(): Promise<Uint8Array>;
  /** False until something other than the eraser is painted after the last clear of the environment. */
  readonly hasEnvironment: boolean;
  writeAgent(index: number, a: AgentState): void;
  writeTrail(data: Float32Array): void;
  /** For tests: replaces the scent, 2 values per cell as readScent() returns them. */
  writeScent(data: Float32Array): void;
  /**
   * Replaces the environment with `data`, 4 bytes per cell as readEnv() returns them. For tests: the engine
   * changes the environment only with paint() and clearEnvironment().
   */
  writeEnv(data: Uint8Array): void;
}

/**
 * Auto levels: `gain` maps trail units to radiance before the exposure setting (0 until a measurement found
 * any trail; frames then use 0.4 / equilibrium), `black` is the summed trail level shown as black. `strand`: the
 * trail of a strand for the scent view's line (scent.ts scentSensors()): the 99th percentile of the summed trail,
 * which the levels draw at full strength, read from the same measurement within its bin and smoothed slowly; 0 until
 * measured.
 */
export interface Levels {
  gain: number;
  black: number;
  strand: number;
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
  /** More GPU bytes per grid cell while covered food is on (sizing.ts COVERED_BYTES_PER_CELL_HALF_FLOAT). */
  readonly coveredBytesPerCell: number;
  readonly supportsCollisions: boolean;
  /** Resolves with a message if the device or context is lost. */
  readonly lost: Promise<string>;
  /**
   * A simulation of `agents` agents, alive and dead. `start`: how many the layout places at the start, the first ones
   * of each strain (default all). Fewer when the capacity holds more agents than the start population (ADR 0025).
   */
  createSim(settings: Settings, width: number, height: number, agents: number, start?: number): Promise<S>;
  /**
   * Draws a frame; `measure` lets auto levels sample the trail. False while a part of the picture is still being
   * built, as the scent view's pipelines at its first frames: the same call then draws another picture later.
   */
  draw(sim: S, settings: Settings, view: View, measure: boolean): boolean;
  /** `levels`: levels for this picture alone (measured()), in place of those of the frames. */
  capture(sim: S, settings: Settings, view: View, width: number, height: number, levels?: Levels): Promise<ImageData>;
  /** Measures auto levels now instead of smoothing over frames; resolves with the levels frames now use. */
  settle(sim: S): Promise<Levels>;
  /**
   * Measures auto levels now for one picture, an export, and resolves with them; the levels frames use stay as they
   * are, so the scent view's line goes on from its smoothed strand. The levels frames use if nothing could be measured.
   */
  measured(sim: S): Promise<Levels>;
  /** The levels frames use now. */
  levels(): Levels;
  /** Drops caches tied to a replaced simulation and restarts auto levels. */
  forget(): void;
  destroy(): void;
}
