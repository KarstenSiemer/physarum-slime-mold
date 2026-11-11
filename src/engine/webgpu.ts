import type { Settings } from '../model/params';
import { at } from './at';
import { Bloom } from './bloom';
import { AutoExposure } from './exposure';
import { initGpu, OutOfMemoryError, type Gpu } from './gpu';
import { Renderer, type Frame } from './render';
import { Simulation } from './sim';
import { BYTES_PER_CELL, equilibrium } from './sizing';
import type { Backend, Levels, View } from './types';

// The agent id has 24 bits (ADR 0005, shaders/common.wgsl).
const MAX_AGENTS = 2 ** 24;

/** The primary backend: compute shaders, integer atomics, GPU histogram (ADR 0002). */
export class WebGpuBackend implements Backend<Simulation> {
  readonly kind = 'webgpu';
  readonly supportsCollisions = true;
  readonly bytesPerCell = BYTES_PER_CELL;
  readonly coveredBytesPerCell = 0; // covered food counts into the collision buffers

  readonly description: string;
  readonly lost: Promise<string>;
  private readonly renderer: Renderer;
  private readonly bloom: Bloom;
  private readonly auto: AutoExposure;

  private constructor(
    readonly gpu: Gpu,
    context: GPUCanvasContext,
  ) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device: gpu.device, format, alphaMode: 'opaque' });
    this.renderer = new Renderer(gpu.device, context, format);
    this.bloom = new Bloom(gpu.device);
    this.auto = new AutoExposure(gpu.device);
    const i = gpu.info;
    this.description = `WebGPU · ${[i.vendor, i.architecture, i.description].filter(Boolean).join(' ')}`;
    this.lost = gpu.device.lost.then((info) =>
      info.reason === 'destroyed' ? new Promise<string>(() => undefined) : info.message,
    );
  }

  /** Throws GpuUnavailableError before touching the canvas, so WebGL2 can still use it. */
  static async create(canvas: HTMLCanvasElement): Promise<WebGpuBackend> {
    const gpu = await initGpu();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not create a WebGPU canvas context.');
    return new WebGpuBackend(gpu, context);
  }

  get maxBufferBytes() {
    const l = this.gpu.device.limits;
    return Math.min(l.maxStorageBufferBindingSize, l.maxBufferSize);
  }

  /** The gel height field has a one-cell border, two texels more than the grid (render.ts). */
  get maxGridSide() {
    return this.gpu.device.limits.maxTextureDimension2D - 2;
  }

  get maxAgents() {
    return Math.min(MAX_AGENTS, Math.floor(this.maxBufferBytes / 16)); // 16 B per agent
  }

  /** Allocation failures surface as OutOfMemoryError instead of a lost device. */
  async createSim(settings: Settings, width: number, height: number, agents: number, start = agents) {
    const device = this.gpu.device;
    device.pushErrorScope('out-of-memory');
    device.pushErrorScope('validation');
    let sim: Simulation | undefined;
    try {
      sim = await Simulation.create(device, settings, width, height, agents, undefined, undefined, start);
    } finally {
      // Always pop both scopes, or they would swallow later errors.
      const invalid = await device.popErrorScope();
      const oom = await device.popErrorScope();
      if (oom ?? invalid) {
        sim?.destroy();
        // eslint-disable-next-line no-unsafe-finally -- the allocation error replaces the result
        throw new OutOfMemoryError((oom ?? invalid)?.message ?? 'allocation failed');
      }
    }
    return sim;
  }

  draw(sim: Simulation, settings: Settings, view: View, measure: boolean) {
    this.renderer.draw(this.frame(sim, settings, view, measure));
  }

  capture(sim: Simulation, settings: Settings, view: View, width: number, height: number) {
    return this.renderer.capture(this.frame(sim, settings, view, false), width, height);
  }

  async settle(sim: Simulation): Promise<Levels> {
    await this.auto.measure(sim.current.trail);
    return { gain: this.auto.gain, black: this.auto.black };
  }

  forget() {
    this.renderer.forget();
    this.auto.reset();
  }

  destroy() {
    this.renderer.destroy();
    this.bloom.destroy();
    this.auto.destroy();
    this.gpu.device.destroy();
  }

  /** Exposure and bloom for the current state; `measure` runs the auto-levels histogram. */
  private frame(sim: Simulation, s: Settings, view: View, measure: boolean): Frame {
    const trail = sim.current.trail;
    const agents = s.style === 'agents';
    const fallback = 0.4 / equilibrium(s);
    const base = agents ? 0.4 / s.density : measure ? this.auto.update(trail, fallback) : this.auto.gain || fallback;
    const exposure = base * 2 ** s.exposure;
    const black = agents ? 0 : this.auto.black;
    const wrap = s.boundary === 'wrap';
    const bloom =
      s.bloom > 0 && s.style === 'glow' ? this.bloom.run(trail, exposure, black, wrap) : this.bloom.view(trail);
    return { sim, settings: s, view, exposure, black, bloom, sampler: at(this.bloom.samplers, wrap ? 1 : 0) };
  }
}
