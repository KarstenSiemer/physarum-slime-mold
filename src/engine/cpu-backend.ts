// A backend for the engine tests in Node, for tests only: it paints with paint-reference.ts, the CPU mirror of the
// paint shaders (sim.gpu.test.ts compares that mirror with both GPU backends), and simulates nothing else.
import type { Settings } from '../model/params';
import { paintReference } from './paint-reference';
import type { Backend, Sim, Stroke } from './types';

export class CpuSim implements Sim {
  step = 0;
  readonly env: Uint8Array;
  /** Calls in order, to check that the environment is painted before the agents are placed. */
  readonly calls: string[] = [];

  constructor(
    private settings: Settings,
    readonly width: number,
    readonly height: number,
    readonly agents: number,
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
      paintReference(this.env, this.width, this.height, s, this.settings.boundary);
    }
  }
  clearEnvironment() {
    this.calls.push('clear');
    this.env.fill(0);
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
  readCounts() {
    return Promise.resolve(new Float32Array(0));
  }
  readEnv() {
    return Promise.resolve(this.env.slice());
  }
  writeAgent() {
    // agents are not simulated here
  }
  writeTrail() {
    // trails are not simulated here
  }
  writeEnv(data: Uint8Array) {
    this.env.set(data);
  }
}

export class CpuBackend implements Backend<CpuSim> {
  readonly kind = 'webgpu';
  readonly description = 'CPU test backend';
  readonly maxAgents = 2 ** 24;
  readonly maxBufferBytes = 2 ** 30;
  readonly maxGridSide = 8192;
  bytesPerCell = 86;
  readonly supportsCollisions = true;
  readonly lost = new Promise<string>(() => undefined);
  /** Runs before the next allocation only: a test can hold it or make it fail. */
  before: (() => Promise<void>) | undefined;
  /** Every simulation built, in order. */
  readonly built: CpuSim[] = [];

  async createSim(settings: Settings, width: number, height: number, agents: number) {
    const hook = this.before;
    this.before = undefined;
    await hook?.();
    const sim = new CpuSim(settings, width, height, agents);
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
