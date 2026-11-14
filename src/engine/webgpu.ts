import type { Settings } from '../model/params';
import { at } from './at';
import { Bloom } from './bloom';
import { AutoExposure, type Trails } from './exposure';
import { initGpu, OutOfMemoryError, type Gpu } from './gpu';
import { Renderer, type Frame } from './render';
import { Simulation } from './sim';
import { BYTES_PER_AGENT, BYTES_PER_CELL, equilibrium } from './sizing';
import type { Backend, Levels, View } from './types';

// The agent id has 24 bits (ADR 0005, shaders/common.wgsl).
const MAX_AGENTS = 2 ** 24;

/** The primary backend: compute shaders, integer atomics, GPU histogram (ADR 0002). */
export class WebGpuBackend implements Backend<Simulation> {
  readonly kind = 'webgpu';
  readonly supportsCollisions = true;
  readonly bytesPerCell = BYTES_PER_CELL;
  readonly bytesPerAgent = BYTES_PER_AGENT;
  readonly coveredBytesPerCell = 0; // covered food counts into the collision buffers

  readonly description: string;
  readonly lost: Promise<string>;
  onOutOfMemory: ((message: string) => void) | undefined;
  private renderer: Renderer;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly bloom: Bloom;
  private readonly auto: AutoExposure;
  /** destroy() was called: the end of the device that follows is no loss. */
  private ending = false;

  private constructor(
    readonly gpu: Gpu,
    context: GPUCanvasContext,
  ) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device: gpu.device, format, alphaMode: 'opaque' });
    [this.context, this.format] = [context, format];
    this.renderer = new Renderer(gpu.device, context, format);
    this.bloom = new Bloom(gpu.device);
    this.auto = new AutoExposure(gpu.device);
    const i = gpu.info;
    this.description = `WebGPU · ${[i.vendor, i.architecture, i.description].filter(Boolean).join(' ')}`;
    // A buffer or texture that a pass makes at its first use is outside the scopes of createSim(): its error goes here.
    gpu.device.addEventListener('uncapturederror', (e) => {
      if (e.error instanceof GPUOutOfMemoryError) this.onOutOfMemory?.(e.error.message);
    });
    // destroy() below ends the device on purpose; any other end of it is a loss, also a destroy() from elsewhere.
    this.lost = gpu.device.lost.then((info) =>
      this.ending ? new Promise<string>(() => undefined) : info.message || `device ${info.reason}`,
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
    return this.renderer.draw(this.frame(sim, settings, view, measure));
  }

  async capture(sim: Simulation, settings: Settings, view: View, width: number, height: number, levels?: Levels) {
    // An export shows the view as asked: its pipelines are built first. A rebuild can destroy the simulation in
    // that time. Then nothing is left to draw, and the engine asks again for the new one (Engine.ofRun()).
    await this.renderer.ready(settings);
    if (sim.destroyed) return new ImageData(width, height);
    return this.renderer.capture(this.frame(sim, settings, view, false, levels), width, height);
  }

  /**
   * For a measurement of the levels: the trail that a frame of `sim` draws and the trail of its model, as they are
   * when the measurement asks. Nothing once the simulation is destroyed: a rebuild can do that while a measurement
   * waits for the one before it.
   */
  private trailsOf(sim: Simulation) {
    return (): Trails | undefined => (sim.destroyed ? undefined : [sim.pictureTexture, sim.viewTexture]);
  }

  async settle(sim: Simulation): Promise<Levels> {
    await this.auto.measure(this.trailsOf(sim));
    return this.levels();
  }

  levels(): Levels {
    return { gain: this.auto.gain, black: this.auto.black, strand: this.auto.strand };
  }

  async measured(sim: Simulation): Promise<Levels> {
    return (await this.auto.read(this.trailsOf(sim))) ?? this.levels();
  }

  /**
   * For tests: draws every frame with another version of the render shader from now on, as the code before the scent
   * view did, or as shipped again when `code` is undefined. The new renderer counts its frames from 0, so its dither
   * matches another one's frame by frame.
   */
  renderFrom(code?: string) {
    this.renderer.destroy();
    this.renderer = new Renderer(this.gpu.device, this.context, this.format, code);
  }

  forget() {
    this.renderer.forget();
    this.auto.reset();
  }

  destroy() {
    this.ending = true;
    this.renderer.destroy();
    this.bloom.destroy();
    this.auto.destroy();
    this.gpu.device.destroy();
  }

  /**
   * Exposure and bloom for the current state; `measure` runs the auto-levels histogram. `given`: levels measured for
   * this frame alone (an export), in place of those of the frames.
   */
  private frame(sim: Simulation, s: Settings, view: View, measure: boolean, given?: Levels): Frame {
    // The map after the step's diffusion in either order of a step (ADR 0027), or the picture of the tubes made from it
    // (ADR 0034): the levels and the bloom are those of the trail that the frame draws.
    const trail = sim.pictureTexture;
    const agents = s.style === 'agents';
    const fallback = 0.4 / equilibrium(s);
    // The agents style draws without levels, but the scent view's mark needs the strand in every style (ADR 0009). The
    // strand is a level of the trail of the model, with or without the picture of the tubes.
    if (measure && (!agents || s.showScent)) this.auto.update(trail, fallback, sim.viewTexture);
    const l = given ?? this.levels();
    const base = agents ? 0.4 / s.density : l.gain || fallback;
    const exposure = base * 2 ** s.exposure;
    const black = agents ? 0 : l.black;
    const wrap = s.boundary === 'wrap';
    const bloom =
      s.bloom > 0 && s.style === 'glow' ? this.bloom.run(trail, exposure, black, wrap) : this.bloom.view(trail);
    const sampler = at(this.bloom.samplers, wrap ? 1 : 0);
    return { sim, settings: s, view, exposure, black, strand: l.strand, bloom, sampler };
  }
}
