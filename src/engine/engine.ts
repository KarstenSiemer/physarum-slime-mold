import { constrain, RESOLUTIONS, type Boundary, type Settings } from '../model/params';
import type { EnvShape } from '../model/presets';
import { FrameBudget } from './budget';
import { paintsCell } from './brush';
import { anchor, fromShape, fromStroke, MIN_RADIUS, strokeOn, type EnvEdit } from './environment';
import { GpuUnavailableError, OutOfMemoryError } from './gpu';
import type { AgentTool } from './pack';
import { agentCount, fitResolution, gridSize, memoryBudget } from './sizing';
import type { Backend, Levels, Sim, Stroke, View } from './types';
import { WebGpuBackend } from './webgpu';

// Changes that need a new population.
// Switching one agent per cell restarts it too: agents stacked without the rule would stay stacked for
// thousands of steps, and a collapsed network would carry over (ADR 0008).
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
  /** Steps per frame from the speed and from what the GPU keeps up with (budget.ts). */
  readonly budget = new FrameBudget();
  /** How often the simulation started over (reset or rebuild); the UI restarts its measurements then. */
  restarts = 0;
  private pendingTool: AgentTool | undefined;
  /** Every food, light, wall and erase edit since the last clear or preset load: each new simulation paints them. */
  private edits: EnvEdit[] = [];
  /** How many of `edits` the current simulation holds; the next frame paints the rest. */
  private painted = 0;
  /** The grid the view shows (fitView()): strokes from the canvas are in its cells, also during a rebuild. */
  private viewGrid: [number, number] | undefined;
  /** False from freeing a simulation until the next one exists. */
  private live = false;
  private raf = 0;
  private rebuilding: Promise<void> | undefined;
  /** What the current simulation was built for: its grid and agent count follow from these. */
  private built = { resolution: 0, density: 0, dish: false };

  private constructor(
    readonly backend: Backend,
    readonly canvas: HTMLCanvasElement,
    public settings: Settings,
  ) {}

  /**
   * `onAdjust` hears about grids the device could not hold (also on the first allocation). `backend` replaces the
   * automatic choice (tests: WebGL2 in the browser, a CPU backend in Node).
   */
  static async create(
    canvas: HTMLCanvasElement,
    settings: Settings,
    onAdjust?: Adjust,
    backend?: Backend,
  ): Promise<Engine> {
    const engine = new Engine(backend ?? (await createBackend(canvas)), canvas, settings);
    engine.onAdjust = onAdjust;
    engine.settings = engine.supported(settings);
    await engine.rebuild();
    return engine;
  }

  /** Applies new settings: live where possible, reset or reallocation where needed. */
  async apply(next: Settings) {
    const prev = this.settings;
    this.settings = this.supported(next);
    this.anchorEdits(prev.boundary);
    if (this.rebuilding || this.needsRebuild()) return this.rebuild();
    const shares = (s: Settings) => s.strains.map((st) => st.share).join();
    this.sim.update(this.settings);
    // Compare what runs, not what was asked: a backend without the rule keeps it off, which is no switch.
    const now = this.settings;
    if (RESET_KEYS.some((k) => now[k] !== prev[k]) || shares(now) !== shares(prev)) this.reset();
  }

  /**
   * Loads a preset: its settings, its food, light and walls in place of every earlier edit, then a fresh
   * population, placed after the walls so that no agent starts inside one. The shapes are in the canonical frame of
   * the settings' boundary, the preset's own arena.
   */
  async load(settings: Settings, env: readonly EnvShape[] = []) {
    this.settings = this.supported(settings);
    this.edits = env.map((e) => fromShape(e, this.settings.boundary));
    this.painted = 0;
    // A new simulation paints the edits itself, before it places the agents.
    if (this.needsRebuild()) return this.rebuild();
    this.sim.update(this.settings);
    this.sim.clearEnvironment();
    this.flushEnv();
    this.reset();
  }

  /** Called with the new grid when the engine had to lower it to fit the device. */
  onAdjust: Adjust | undefined;

  /** Settings this device can hold: collisions need a backend feature, memory caps the grid. */
  fit(s: Settings): Settings {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const memory = (navigator as { deviceMemory?: number }).deviceMemory;
    const { maxAgents, maxBufferBytes, maxGridSide, bytesPerCell } = this.backend;
    const limits = { maxAgents, maxBufferBytes, maxGridSide, bytesPerCell, budget: memoryBudget(memory) };
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

  /** The grid or the agent count changes: a dish counts its agents over the short side's square (agentCount()). */
  private needsRebuild() {
    const { resolution, density, boundary } = this.settings;
    const b = this.built;
    return resolution !== b.resolution || density !== b.density || (boundary === 'dish') !== b.dish;
  }

  /** True while the simulation is being replaced; it cannot be used meanwhile. */
  get busy() {
    return this.rebuilding !== undefined;
  }

  /**
   * New buffers for the current resolution, density and canvas aspect ratio; repeats if settings moved meanwhile.
   * The old simulation is freed first, so memory never holds two (frame() waits meanwhile). The new one paints
   * every edit (ADR 0019), then places its agents.
   */
  rebuild(): Promise<void> {
    this.rebuilding ??= (async () => {
      let old = this.sim as Sim | undefined;
      do {
        const { resolution, density, boundary } = this.settings;
        const [w, h] = gridSize(resolution, this.canvas.width / Math.max(1, this.canvas.height));
        const agents = Math.max(1, Math.min(this.backend.maxAgents, agentCount(this.settings, w, h)));
        this.live = false;
        old?.destroy();
        old = undefined;
        this.built = { resolution: 0, density: 0, dish: false }; // nothing is built until the new one exists
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
        this.live = true;
        this.painted = 0; // a new simulation starts without food, light and walls
        this.built = { resolution, density, dish: boundary === 'dish' };
        this.fitView();
      } while (this.needsRebuild());
      // Settings may have changed during the allocation (seed, layout, shares): start from them.
      this.sim.update(this.settings);
      this.flushEnv();
      this.sim.reset();
      this.backend.forget();
      this.restarts++;
    })().finally(() => (this.rebuilding = undefined));
    return this.rebuilding;
  }

  reset() {
    if (this.rebuilding) return; // the new simulation starts fresh anyway
    this.sim.reset();
    this.backend.forget();
    this.restarts++;
  }

  /**
   * Edits go through the canonical frame of the arena on screen (strokeOn()). When the arena changes its frame (the
   * dish against a box or a periodic grid), every edit is anchored to the cells of the grid on screen, where it lies
   * as before: so the edits keep their place on screen and stay together, and a new screen shape moves them all by
   * the frame of the new arena.
   */
  private anchorEdits(was: Boundary) {
    if ((was === 'dish') === (this.settings.boundary === 'dish') || !this.viewGrid) return;
    const [w, h] = this.viewGrid;
    this.edits = this.edits.map((e) => anchor(e, w, h, was));
  }

  /** Removes food, light and walls, also from simulations built later. Strokes not painted yet go too. */
  clearEnvironment() {
    this.edits = [];
    this.painted = 0;
    if (this.live) this.sim.clearEnvironment();
  }

  fitView() {
    const { width, height } = this.sim;
    this.viewGrid = [width, height];
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

  /**
   * A brush stroke in cells of the grid on screen (toGrid()); the next frame paints it. It is kept with that grid:
   * during a rebuild the view still shows the old grid, and the new one gets the stroke where it was drawn. Before
   * the first simulation exists no grid is on screen, so the stroke is dropped. So is a stroke that paints no cell,
   * beside a box or outside the dish: it changes nothing on screen, and on another grid or arena it must not either.
   */
  paint(stroke: Stroke) {
    if (![...stroke.from, ...stroke.to, stroke.radius].every(Number.isFinite) || !this.viewGrid) return;
    const s = { ...stroke, radius: Math.max(MIN_RADIUS, stroke.radius) };
    if (!paintsCell(s, ...this.viewGrid, this.settings.boundary)) return;
    this.edits.push(fromStroke(s, this.viewGrid, this.settings.boundary));
  }

  /** Paints the edits the current simulation does not hold yet, mapped to its grid, in one call. */
  private flushEnv() {
    if (this.painted === this.edits.length) return;
    const { width, height } = this.sim;
    const arena = this.settings.boundary;
    const strokes = this.edits.slice(this.painted).flatMap((e) => strokeOn(e, width, height, arena) ?? []);
    this.painted = this.edits.length;
    this.sim.paint(strokes);
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

  /**
   * One frame: new strokes, as many steps as the speed asks for and the GPU keeps up with, then one
   * render. When the GPU falls behind, the steps per frame drop (budget.ts), so a slow GPU lowers the
   * simulation speed instead of the frame rate.
   */
  frame(now: number, forceSteps?: number) {
    if (this.rebuilding) return;
    this.flushEnv();
    const planned = this.budget.next(now, this.paused || forceSteps !== undefined ? 0 : this.settings.speed);
    let steps = forceSteps ?? planned;
    // A held tool while paused still needs one step to act.
    if (this.pendingTool && steps === 0) steps = 1;
    if (steps > 0) {
      this.sim.run(steps, this.pendingTool);
      this.pendingTool = undefined;
    }
    this.backend.draw(this.sim, this.settings, this.view, true);
    this.frames++;
    this.budget.submitted();
    const done = () => {
      this.budget.done(performance.now());
    };
    this.sim.finish().then(done, done);
  }

  /** The current frame as pixels, rendered offscreen at canvas size. */
  async capture(): Promise<ImageData> {
    await this.rebuilding;
    return this.backend.capture(this.sim, this.settings, this.view, this.canvas.width, this.canvas.height);
  }

  /** Measures auto levels now instead of waiting for the smoothed per-frame measurement. */
  async settle(): Promise<Levels> {
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
