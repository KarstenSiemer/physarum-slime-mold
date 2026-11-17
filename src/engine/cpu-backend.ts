// A backend for the engine tests in Node, for tests only: it paints with paint-reference.ts, the CPU mirror of the
// paint shaders (sim.gpu.test.ts compares that mirror with both GPU backends), and with the brush of
// slime-reference.ts on the slime field (slime.gpu.test.ts compares it with both). It simulates nothing else.
import type { Settings } from '../model/params';
import type { AgentTool } from './pack';
import { paintReference } from './paint-reference';
import { NO_SITES, type FlowSites } from './sites';
import { BYTES_PER_AGENT, BYTES_PER_CELL } from './sizing';
import { slimeModel, slimeSteps } from './slime';
import { slimePaint } from './slime-reference';
import { changesSlime, isPole, paintsEnv, type Backend, type Sim, type Stroke } from './types';

export class CpuSim implements Sim {
  step = 0;
  revision = 0;
  readonly env: Uint8Array;
  /** As on both GPU backends: false until something other than the eraser is painted after the last clear. */
  hasEnvironment = false;
  hasElectrodes = false;
  /** Calls in order, to check that the environment is painted before the agents are placed. */
  readonly calls: string[] = [];
  /**
   * The slime field as on both GPU backends (ADR 0055): the stamp of every cell, held while the model has slime. No
   * step writes a stamp here: only the brush does (slime-reference.ts slimePaint()), and a test that stands for the
   * colony.
   */
  slime: Uint32Array | undefined;
  /** The amount of slime of every cell (ADR 0057), held with the stamps. */
  amount: Uint32Array | undefined;

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
    // The Jones model has no slime: a switch to it frees the field with its stamps.
    if (!slimeModel(s)) [this.slime, this.amount] = [undefined, undefined];
  }
  reset() {
    this.revision++;
    this.step = 0;
    // A reset clears every stamp, and the amounts with them.
    this.slime?.fill(0);
    this.amount?.fill(0);
    this.calls.push('reset');
  }
  /** The agent tools of the steps that ran, in order (the start layout 'food' places its colonies with one). */
  readonly tools: AgentTool[] = [];
  run(steps: number, tool?: AgentTool) {
    this.step += steps;
    if (tool) this.tools.push(tool);
  }
  paint(strokes: readonly Stroke[]) {
    if (strokes.length > 0) this.revision++;
    for (const s of strokes) {
      this.calls.push('paint');
      if (paintsEnv(s.kind)) {
        if (s.kind !== 'erase') this.hasEnvironment = true;
        if (isPole(s.kind)) this.hasElectrodes = true;
        paintReference(this.env, this.width, this.height, s, this.settings.boundary);
      }
      this.slimeOf(s);
    }
  }
  paintSlime(strokes: readonly Stroke[]) {
    if (!slimeModel(this.settings) || !strokes.some((s) => changesSlime(s.kind))) return;
    this.revision++;
    this.calls.push('slime');
    for (const s of strokes) this.slimeOf(s);
  }
  /**
   * What a stroke does with the slime field, against the environment as it is now. The field is made at the first
   * stroke of the Slime tool: before it no cell holds a stamp, and an erase or a wall has nothing to clear.
   */
  private slimeOf(s: Stroke) {
    if (!slimeModel(this.settings) || !changesSlime(s.kind)) return;
    if (s.kind === 'slime') this.slime ??= new Uint32Array(this.width * this.height);
    if (!this.slime) return;
    this.amount ??= new Uint32Array(this.width * this.height);
    const { width, height, env } = this;
    const grid = { width, height, boundary: this.settings.boundary, env };
    slimePaint(grid, this.settings, this.step, this.slime, s, undefined, {
      amounts: this.amount,
      life: slimeSteps(this.settings),
    });
  }
  clearEnvironment() {
    this.revision++;
    this.calls.push('clear');
    this.env.fill(0);
    this.slime?.fill(0);
    this.amount?.fill(0);
    this.hasEnvironment = false;
    this.hasElectrodes = false;
  }
  /** The food sites of the last call, for the tests of the engine (ADR 0029, decision 17). */
  sites: FlowSites = NO_SITES;
  foodSites(sites: FlowSites) {
    this.sites = sites;
  }
  readFlow() {
    return Promise.resolve(new Float32Array(0));
  }
  readPressure() {
    return Promise.resolve(new Float32Array(0));
  }
  readSlime() {
    return Promise.resolve(this.slime?.slice() ?? new Uint32Array(this.width * this.height));
  }
  readSlimeAmount() {
    return Promise.resolve(this.amount?.slice() ?? new Uint32Array(this.width * this.height));
  }
  writeFlow() {
    // nothing to write
  }
  writePressure() {
    // nothing to write
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
  readView() {
    return Promise.resolve(new Float32Array(0));
  }
  readViewScent() {
    return Promise.resolve(new Float32Array(0));
  }
  readPicture() {
    return Promise.resolve(new Float32Array(0));
  }
  readTubeRoots() {
    return Promise.resolve(new Float32Array(0));
  }
  readStream() {
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
  /** As readShape(): 128 in the first byte where `env` holds a cathode, and in the second where it holds an anode. */
  readPoles() {
    const poles = new Uint8Array(this.env.length);
    for (let i = 0; i < this.env.length; i += 4) {
      const pole = this.env[i + 3] ?? 0;
      poles[i] = pole > 191 ? 128 : 0;
      poles[i + 1] = pole > 0 && pole <= 191 ? 128 : 0;
    }
    return Promise.resolve(poles);
  }
  writeAgent() {
    // agents are not simulated here
  }
  writeTrail() {
    // trails are not simulated here
  }
  writeScent() {
    // scents are not simulated here
  }
  writeEnv(data: Uint8Array) {
    this.revision++;
    this.env.set(data);
    this.hasEnvironment = data.some((v) => v > 0);
    this.hasElectrodes = data.some((v, i) => i % 4 === 3 && v > 0);
  }
}

export class CpuBackend implements Backend<CpuSim> {
  readonly kind = 'webgpu';
  readonly description = 'CPU test backend';
  readonly maxAgents = 2 ** 24;
  readonly maxBufferBytes = 2 ** 30;
  readonly maxGridSide = 8192;
  bytesPerCell = BYTES_PER_CELL; // as the WebGPU backend
  bytesPerAgent = BYTES_PER_AGENT;
  coveredBytesPerCell = 0;
  tubeMapBytesPerCell = 0; // as the WebGPU backend
  readonly supportsCollisions = true;
  readonly lost = new Promise<string>(() => undefined);
  /** Set by the engine; a test calls it as the WebGPU device does (Backend.onOutOfMemory). */
  onOutOfMemory: ((message: string) => void) | undefined;
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
  /** How often draw() ran. */
  draws = 0;
  /** What the next calls of draw() return: false stands for a picture that is still being built. */
  ready = true;
  /** The levels that levels() gives: a test moves them as a measurement does. */
  current = { gain: 0, black: 0, strand: 0 };

  draw() {
    this.draws++;
    return this.ready;
  }
  capture(): Promise<ImageData> {
    return Promise.reject(new Error('not available in Node'));
  }
  settle() {
    return Promise.resolve(this.levels());
  }
  measured() {
    return Promise.resolve(this.levels());
  }
  levels() {
    return this.current;
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
