import { constrain, RESOLUTIONS, type Settings } from '../model/params';
import type { EnvShape } from '../model/presets';
import { GpuUnavailableError, OutOfMemoryError } from './gpu';
import type { AgentTool } from './pack';
import { fitResolution, gridSize, memoryBudget } from './sizing';
import type { Backend, Sim, Stroke, View } from './types';
import { WebGpuBackend } from './webgpu';

const MAX_STEPS_PER_FRAME = 16;

// Changes that need a new population. Switching one agent per cell restarts it too: agents stacked without the
// rule would stay stacked for thousands of steps, and a collapsed network would carry over (ADR 0008).
const RESET_KEYS = ['seed', 'layout', 'boundary', 'collisions'] as const;

/** Picks WebGPU, or WebGL2 when WebGPU is missing or `?backend=webgl2` (ADR 0003). */
async function createBackend(canvas: HTMLCanvasElement): Promise<Backend> {
  const forced = new URLSearchParams(location.search).get('backend');
  if (forced !== 'webgl2') {
    try {
      return await WebGpuBackend.create(canvas);
    } catch (err) {
      if (!(err instanceof GpuUnavailableError)) throw err;
    }
  }
  const { WebGl2Backend } = await import('./gl/backend');
  return WebGl2Backend.create(canvas);
}

/** Backend-independent simulation control: settings, frame loop, view and tools. */
type Adjust = (message: string, resolution: number) => void;

export class Engine {
  sim!: Sim;
  view: View = { center: [0, 0], scale: 1 };
  paused = false;
  /** Frames drawn since start; the UI derives frames per second from it. */
  frames = 0;
  private accumulator = 0;
  private last = 0;
  private pendingTool: AgentTool | undefined;
  private readonly strokes: Stroke[] = [];
  private raf = 0;
  private rebuilding: Promise<void> | undefined;
  private built = { resolution: 0, density: 0 };

  private constructor(
    readonly backend: Backend,
    readonly canvas: HTMLCanvasElement,
    public settings: Settings,
  ) {}

  /** `onAdjust` hears about grids the device could not hold (also on the first allocation). */
  static async create(canvas: HTMLCanvasElement, settings: Settings, onAdjust?: Adjust): Promise<Engine> {
    const engine = new Engine(await createBackend(canvas), canvas, settings);
    engine.onAdjust = onAdjust;
    engine.settings = engine.supported(settings);
    await engine.rebuild();
    return engine;
  }

  /** Applies new settings: live where possible, reset or reallocation where needed. */
  async apply(next: Settings) {
    const prev = this.settings;
    this.settings = this.supported(next);
    if (this.rebuilding || this.needsRebuild()) return this.rebuild();
    const shares = (s: Settings) => s.strains.map((st) => st.share).join();
    this.sim.update(this.settings);
    // Compare what runs, not what was asked: a backend without the rule keeps it off, which is no switch.
    const now = this.settings;
    if (RESET_KEYS.some((k) => now[k] !== prev[k]) || shares(now) !== shares(prev)) this.reset();
  }

  /** Loads a preset: its settings, a fresh population and its food, light and walls. */
  async load(settings: Settings, env: readonly EnvShape[] = []) {
    this.settings = this.supported(settings);
    if (this.needsRebuild()) await this.rebuild();
    else {
      this.sim.update(this.settings);
      this.reset();
    }
    this.sim.clearEnvironment();
    const { width: w, height: h } = this.sim;
    const m = Math.min(w, h);
    for (const e of env) {
      const to = e.to ?? e.at;
      this.sim.paint({ kind: e.kind, from: [e.at[0] * w, e.at[1] * h], to: [to[0] * w, to[1] * h], radius: e.r * m });
    }
  }

  /** Called with the new grid when the engine had to lower it to fit the device. */
  onAdjust: Adjust | undefined;

  /** Settings this device can hold: collisions need a backend feature, memory caps the grid. */
  fit(s: Settings): Settings {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const memory = (navigator as { deviceMemory?: number }).deviceMemory;
    const { maxAgents, maxBufferBytes, maxGridSide } = this.backend;
    const limits = { maxAgents, maxBufferBytes, maxGridSide, budget: memoryBudget(memory) };
    return constrain({
      ...s,
      resolution: fitResolution(s, aspect, limits),
      collisions: s.collisions && this.backend.supportsCollisions,
    });
  }

  private supported(s: Settings): Settings {
    const f = this.fit(s);
    if (f.resolution !== s.resolution)
      this.onAdjust?.(`Lowered the grid to ${f.resolution} cells to fit this device.`, f.resolution);
    return f;
  }

  private needsRebuild() {
    return this.settings.resolution !== this.built.resolution || this.settings.density !== this.built.density;
  }

  /** True while the simulation is being replaced; it cannot be used meanwhile. */
  get busy() {
    return this.rebuilding !== undefined;
  }

  /**
   * New buffers for the current resolution, density and canvas aspect ratio; repeats if settings moved meanwhile.
   * The old simulation is freed first, so memory never holds two (frame() waits meanwhile).
   */
  rebuild(): Promise<void> {
    this.rebuilding ??= (async () => {
      let old = this.sim as Sim | undefined;
      do {
        const { resolution, density } = this.settings;
        const [w, h] = gridSize(resolution, this.canvas.width / Math.max(1, this.canvas.height));
        const agents = Math.max(1, Math.min(this.backend.maxAgents, Math.round(density * w * h)));
        old?.destroy();
        old = undefined;
        this.built = { resolution: 0, density: 0 }; // nothing is built until the new one exists
        try {
          this.sim = await this.backend.createSim(this.settings, w, h, agents);
        } catch (err) {
          // The estimate was too optimistic for this GPU: step the grid down and try again.
          const lower = [...RESOLUTIONS].reverse().find((r) => r < resolution);
          if (!(err instanceof OutOfMemoryError) || lower === undefined) {
            this.stop(); // nothing is left to draw
            throw err;
          }
          this.settings = { ...this.settings, resolution: lower };
          this.onAdjust?.(`Lowered the grid to ${lower} cells: the GPU ran out of memory.`, lower);
          continue;
        }
        old = this.sim;
        this.built = { resolution, density };
        this.fitView();
      } while (this.needsRebuild());
      // Settings may have changed during the allocation (seed, layout, shares): start from them.
      this.sim.update(this.settings);
      this.sim.reset();
      this.backend.forget();
    })().finally(() => (this.rebuilding = undefined));
    return this.rebuilding;
  }

  reset() {
    if (this.rebuilding) return; // the new simulation starts fresh anyway
    this.sim.reset();
    this.backend.forget();
  }

  /** Removes food, light and walls (a new simulation has none anyway). */
  clearEnvironment() {
    if (!this.rebuilding) this.sim.clearEnvironment();
  }

  fitView() {
    const { width, height } = this.sim;
    this.view = {
      center: [width / 2, height / 2],
      scale: Math.max(width / this.canvas.width, height / this.canvas.height),
    };
  }

  /** Grid position (cells) under a canvas pixel. */
  toGrid(px: number, py: number): [number, number] {
    const { center, scale } = this.view;
    return [(px - this.canvas.width / 2) * scale + center[0], (py - this.canvas.height / 2) * scale + center[1]];
  }

  zoomAt(px: number, py: number, factor: number) {
    const before = this.toGrid(px, py);
    this.view.scale = Math.min(8, Math.max(0.02, this.view.scale / factor));
    const after = this.toGrid(px, py);
    this.view.center = [this.view.center[0] + before[0] - after[0], this.view.center[1] + before[1] - after[1]];
  }

  panBy(dxPx: number, dyPx: number) {
    this.view.center = [this.view.center[0] - dxPx * this.view.scale, this.view.center[1] - dyPx * this.view.scale];
  }

  paint(stroke: Stroke) {
    if ([...stroke.from, ...stroke.to, stroke.radius].every(Number.isFinite)) this.strokes.push(stroke);
  }

  agentTool(tool: AgentTool) {
    this.pendingTool = tool;
  }

  /** Called when a frame throws; the loop stops instead of failing silently. */
  onError: ((err: unknown) => void) | undefined;

  start() {
    const loop = (now: number) => {
      try {
        this.frame(now);
      } catch (err) {
        this.onError?.(err);
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  /** One frame: queued strokes, as many steps as the speed asks for, then one render. */
  frame(now: number, forceSteps?: number) {
    if (this.rebuilding) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    for (const s of this.strokes.splice(0)) this.sim.paint(s);
    let steps = forceSteps ?? 0;
    if (forceSteps === undefined && !this.paused) {
      this.accumulator = Math.min(this.accumulator + dt * this.settings.speed, MAX_STEPS_PER_FRAME);
      steps = Math.floor(this.accumulator);
      this.accumulator -= steps;
    }
    // A held tool while paused still needs one step to act.
    if (this.pendingTool && steps === 0) steps = 1;
    if (steps > 0) {
      this.sim.run(steps, this.pendingTool);
      this.pendingTool = undefined;
    }
    this.backend.draw(this.sim, this.settings, this.view, true);
    this.frames++;
  }

  /** The current frame as pixels, rendered offscreen at canvas size. */
  async capture(): Promise<ImageData> {
    await this.rebuilding;
    return this.backend.capture(this.sim, this.settings, this.view, this.canvas.width, this.canvas.height);
  }

  /** Measures auto levels now instead of waiting for the smoothed per-frame measurement. */
  async settle(): Promise<void> {
    await this.rebuilding;
    return this.backend.settle(this.sim);
  }

  /** PNG of the current frame, with settled levels. */
  async snapshot(): Promise<Blob> {
    if (this.settings.style !== 'agents') await this.settle();
    const img = await this.capture();
    const canvas = new OffscreenCanvas(img.width, img.height);
    canvas.getContext('2d')?.putImageData(img, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
  }

  destroy() {
    this.stop();
    this.sim.destroy();
    this.backend.destroy();
  }
}
