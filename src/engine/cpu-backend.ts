// A backend for the engine tests in Node, for tests only: it paints with paint-reference.ts, the CPU mirror of the
// paint shaders (sim.gpu.test.ts compares that mirror with both GPU backends), and simulates nothing else.
import type { Settings } from '../model/params';
import { paintReference } from './paint-reference';
import { BYTES_PER_CELL } from './sizing';
import type { Backend, Sim, Stroke } from './types';

export class CpuSim implements Sim {
  step = 0;
  readonly env: Uint8Array;
  /** As on both GPU backends: false until something other than the eraser is painted after the last clear. */
  hasEnvironment = false;
  /** Calls in order, to check that the environment is painted before the agents are placed. */
  readonly calls: string[] = [];

  constructor(
    private settings: Settings,
    readonly width: number,
    readonly height: number,
    readonly agents: number,
    /** Agents alive at the start (Backend.createSim). */
    readonly start = agents,
  ) {
    this.env = new Uint8Array(width * height * 4);
  }
  update(s: Settings) {
    this.settings = s;
  }
  reset() {
    this.calls.push('reset');
  }
  run(steps: number) {
    this.step += steps;
  }
  paint(strokes: readonly Stroke[]) {
    for (const s of strokes) {
      this.calls.push('paint');
      if (s.kind !== 'erase') this.hasEnvironment = true;
      paintReference(this.env, this.width, this.height, s, this.settings.boundary);
    }
  }
  clearEnvironment() {
    this.calls.push('clear');
    this.env.fill(0);
    this.hasEnvironment = false;
  }
  destroy() {
    this.calls.push('destroy');
  }
  finish() {
    return Promise.resolve();
  }
  alive() {
    return Promise.resolve([]);
  }
  readAgents() {
    return Promise.resolve([]);
  }
  readTrail() {
    return Promise.resolve(new Float32Array(0));
  }
  readScent() {
    return Promise.resolve(new Float32Array(0));
  }
  readCounts() {
    return Promise.resolve(new Float32Array(0));
  }
  readWindows() {
    return Promise.resolve(new Uint32Array(0));
  }
  readEnv() {
    return Promise.resolve(this.env.slice());
  }
  /**
   * No outline distances on the CPU: 128 where `env` holds a wall or food (the side of the outline), else 0, and the
   * light of `env`. No drop shadow. The engine tests here check the environment, not the picture.
   */
  readShape() {
    const shape = new Uint8Array(this.env.length);
    for (let i = 0; i < this.env.length; i += 4) {
      shape[i] = (this.env[i] ?? 0) >= 128 ? 128 : 0;
      shape[i + 1] = (this.env[i + 1] ?? 0) >= 128 ? 128 : 0;
      shape[i + 2] = this.env[i + 2] ?? 0;
    }
    return Promise.resolve(shape);
  }
  writeAgent() {
    // agents are not simulated here
  }
  writeTrail() {
    // trails are not simulated here
  }
  writeEnv(data: Uint8Array) {
    this.env.set(data);
    this.hasEnvironment = data.some((v, i) => i % 4 !== 3 && v > 0);
  }
}

export class CpuBackend implements Backend<CpuSim> {
  readonly kind = 'webgpu';
  readonly description = 'CPU test backend';
  readonly maxAgents = 2 ** 24;
  readonly maxBufferBytes = 2 ** 30;
  readonly maxGridSide = 8192;
  bytesPerCell = BYTES_PER_CELL; // as the WebGPU backend
  coveredBytesPerCell = 0;
  readonly supportsCollisions = true;
  readonly lost = new Promise<string>(() => undefined);
  /** Runs before the next allocation only: a test can hold it or make it fail. */
  before: (() => Promise<void>) | undefined;
  /** Every simulation built, in order. */
  readonly built: CpuSim[] = [];

  async createSim(settings: Settings, width: number, height: number, agents: number, start = agents) {
    const hook = this.before;
    this.before = undefined;
    await hook?.();
    const sim = new CpuSim(settings, width, height, agents, start);
    sim.reset(); // like Simulation.create and the GlSim constructor
    this.built.push(sim);
    return sim;
  }
  draw() {
    // nothing to show
  }
  capture(): Promise<ImageData> {
    return Promise.reject(new Error('not available in Node'));
  }
  settle() {
    return Promise.resolve({ gain: 0, black: 0 });
  }
  forget() {
    // no caches
  }
  destroy() {
    // nothing to free
  }
}

/** Holds the backend's next allocation until the returned function is called. */
export function hold(backend: CpuBackend) {
  let release: () => void = () => {
    throw new Error('not held');
  };
  backend.before = () =>
    new Promise<void>((r) => {
      release = r;
    });
  return () => {
    release();
  };
}
