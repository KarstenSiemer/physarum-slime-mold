import { constrain, RESOLUTIONS, sameLattice, type Boundary, type Lattice, type Settings } from '../model/params';
import { latticeText, type EnvShape } from '../model/presets';
import { FrameBudget, SLACK } from './budget';
import { paintsCell } from './brush';
import { fromShape, fromStroke, MIN_RADIUS, sameEdit, snap, strokeOn, type EnvEdit } from './environment';
import { GpuUnavailableError, OutOfMemoryError } from './gpu';
import { stepChance, type AgentTool } from './pack';
import { agentCount, fitResolution, fits, gridOf, gridSize, memoryBudget } from './sizing';
import { compact, Placement, sweeping } from './sweep';
import type { Backend, Levels, Sim, Stroke, View } from './types';
import { WebGpuBackend } from './webgpu';

/**
 * Sweep work (sweep.ts sweeping()) in the pointer handler, paint(), counted in rows, not time, so a stroke's sweep
 * pauses at the same place on every machine. Each frame then goes on for FRAME_MS. A step between two pauses runs to
 * its end, and some grow with the list: at 100,000 edits an erase of radius 300 took 0.7 to 1.2 ms in paint() and
 * frames of 2.5 to 3.5 ms, in Chromium on an M3 Pro (ADR 0019). A deletion changes no byte on screen, so the rest of
 * a long sweep can wait.
 */
const PAINT_ROWS = 256;
const FRAME_MS = 1;

/**
 * Steps per second of holding an agent tool while paused, at any frame rate: one per frame at 60 Hz, as before
 * (ADR 0023). One step per frame gave a 120 Hz display twice the steps, and with the rule twice the free cells that
 * agents leave in the brush: 22 % more agents after a second.
 */
const PAUSED_TOOL_STEPS = 60;

// Changes that need a new population.
// Switching one agent per cell restarts it too: agents stacked without the rule would stay stacked for
// thousands of steps, and a collapsed network would carry over (ADR 0008).
const RESET_KEYS = ['seed', 'layout', 'boundary', 'collisions'] as const;

/**
 * An agent tool held on the canvas for one frame. `rate`: for inoculate, placements per dead agent of the strain and
 * second (pack.ts inoculateRate()); frame() turns it into a chance per step (stepChance()). `idle`: the tool can
 * change nothing, as inoculate while the app knows no dead agent of its strain (deadLeft() in ui/state.svelte.ts).
 * A paused hold of an idle tool runs no step (ADR 0023).
 */
export type HeldTool = Omit<AgentTool, 'revive'> & { rate: number; idle?: boolean };

/** The tool of one step that stands for `seconds` of holding. */
function stepTool({ kind, x, y, radius, strain, rate }: HeldTool, seconds: number): AgentTool {
  return { kind, x, y, radius, strain, revive: stepChance(rate, seconds) };
}

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

/**
 * The engine lowered the grid to `resolution` cells on the long side to fit the device. `lattice`: the lattice it
 * could not hold, so the grid is shaped like the screen now (ADR 0026).
 */
type Adjust = (message: string, resolution: number, lattice?: Lattice) => void;

/** Backend-independent simulation control: settings, frame loop, view and tools. */
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
  private pendingTool: HeldTool | undefined;
  /** Seconds of holding that no step has applied yet: a frame that runs no step passes its time on. */
  private heldFor = 0;
  /** Steps of a tool held while paused not run yet (PAUSED_TOOL_STEPS), as the budget counts steps. */
  private pausedSteps = 0;
  /**
   * Every food, light, wall and erase edit since the last clear or preset load, less those the sweep deleted
   * (sweep.ts): each new simulation paints them.
   */
  private edits: EnvEdit[] = [];
  /** How many of `edits` the current simulation holds; the next frame paints the rest. */
  private painted = 0;
  /** Every edit on the grid on screen, for the sweep: mapped once per grid and kept in step with `edits`. */
  private placement: Placement | undefined;
  /** The sweep that runs on `placement`, over several frames when it is long, and the clearing strokes after it. */
  private running: Generator<number, Set<number>, void> | undefined;
  private queue: EnvEdit[] = [];
  /** The grid the view shows (fitView()): strokes from the canvas are in its cells, also during a rebuild. */
  private viewGrid: [number, number] | undefined;
  /** False from freeing a simulation until the next one exists. */
  private live = false;
  private raf = 0;
  private rebuilding: Promise<void> | undefined;
  /** What the current simulation was built for: its grid and agent count follow from these. */
  private built: { resolution: number; lattice: Lattice | null; density: number; dish: boolean } = {
    resolution: 0,
    lattice: null,
    density: 0,
    dish: false,
  };

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
    if (this.rebuilding || this.needsRebuild()) return this.rebuild();
    const shares = (s: Settings) => s.strains.map((st) => st.share).join();
    this.sim.update(this.settings);
    // Compare what runs, not what was asked: a backend without the rule keeps it off, which is no switch.
    const now = this.settings;
    if (RESET_KEYS.some((k) => now[k] !== prev[k]) || shares(now) !== shares(prev)) this.reset();
  }

  /**
   * Loads a preset: its settings, its food, light and walls in place of every earlier edit, then a fresh
   * population, placed after the walls so that no agent starts inside one. The shapes belong to `arena`, the
   * preset's own: they are in its canonical frame and painted in it. The simulation runs under the settings'
   * boundary, which can be another one (chosen while the engine started). `strokes` come after the shapes, each with
   * its own grid and arena: a shared link's edit list (model/link.ts).
   */
  async load(
    settings: Settings,
    env: readonly EnvShape[] = [],
    arena: Boundary = settings.boundary,
    strokes: readonly EnvEdit[] = [],
  ) {
    this.settings = this.supported(settings);
    this.edits = [...env.map((e) => fromShape(e, arena)), ...strokes.map((e) => ({ ...e }))];
    this.painted = 0;
    this.placement = undefined;
    [this.running, this.queue] = [undefined, []];
    this.onEdits?.();
    // A new simulation paints the edits itself, before it places the agents.
    if (this.needsRebuild()) return this.rebuild();
    this.sim.update(this.settings);
    this.sim.clearEnvironment();
    this.flushEnv();
    this.reset();
  }

  /** Called with the new grid when the engine had to lower it to fit the device. */
  onAdjust: Adjust | undefined;

  /** Called after every change of the edit list: a recorded stroke and the sweep after it, a Clear, a load. */
  onEdits: (() => void) | undefined;

  /** The edit list as it is now, for a shared link (model/link.ts). The engine changes it; read it at once. */
  envList(): readonly EnvEdit[] {
    return this.edits;
  }

  /**
   * Whether the edit list is exactly `env`, a scene's shapes in the canonical frame of `arena`, as load() makes it:
   * then the food, light and walls are the scene's own, also after a stroke and an erase that the sweep took back.
   */
  matches(env: readonly EnvShape[], arena: Boundary): boolean {
    return (
      this.edits.length === env.length &&
      env.every((shape, i) => {
        const e = this.edits[i];
        return e !== undefined && sameEdit(e, fromShape(shape, arena));
      })
    );
  }

  /**
   * Settings this device can hold: collisions need a backend feature, memory caps the grid. A lattice keeps its cells
   * (ADR 0026): it runs as it is, or the grid becomes one shaped like the screen that fits.
   */
  fit(s: Settings): Settings {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const memory = (navigator as { deviceMemory?: number }).deviceMemory;
    const { maxAgents, maxBufferBytes, maxGridSide, coveredBytesPerCell } = this.backend;
    // Covered food needs more memory only on some backends, and only while it is on.
    const bytesPerCell = this.backend.bytesPerCell + (s.coveredFood ? coveredBytesPerCell : 0);
    const limits = { maxAgents, maxBufferBytes, maxGridSide, bytesPerCell, budget: memoryBudget(memory) };
    const collisions = s.collisions && this.backend.supportsCollisions;
    if (s.lattice && fits(s, s.lattice[0], s.lattice[1], limits)) return constrain({ ...s, collisions });
    return constrain({ ...s, lattice: null, resolution: fitResolution(s, aspect, limits), collisions });
  }

  private supported(s: Settings): Settings {
    const f = this.fit(s);
    if (s.lattice && !f.lattice)
      this.onAdjust?.(
        `This device cannot hold a lattice of ${latticeText(s.lattice)}. The scene runs on a grid of ${f.resolution} cells on the long side.`,
        f.resolution,
        s.lattice,
      );
    else if (f.resolution !== s.resolution)
      this.onAdjust?.(`Lowered the grid to ${f.resolution} cells to fit this device.`, f.resolution);
    return f;
  }

  /**
   * The grid or the agent count changes: a dish counts its agents over the short side's square (agentCount()). On a
   * lattice the resolution does not set the grid.
   */
  private needsRebuild() {
    const { resolution, lattice, density, boundary } = this.settings;
    const b = this.built;
    const grid = lattice ? !sameLattice(lattice, b.lattice) : b.lattice !== null || resolution !== b.resolution;
    return grid || density !== b.density || (boundary === 'dish') !== b.dish;
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
        const { resolution, lattice, density, boundary } = this.settings;
        const [w, h] = gridOf(this.settings, this.canvas.width / Math.max(1, this.canvas.height));
        const agents = Math.max(1, Math.min(this.backend.maxAgents, agentCount(this.settings, w, h)));
        this.live = false;
        old?.destroy();
        old = undefined;
        // Nothing is built until the new one exists.
        this.built = { resolution: 0, lattice: null, density: 0, dish: false };
        try {
          this.sim = await this.backend.createSim(this.settings, w, h, agents);
        } catch (err) {
          // The estimate was too optimistic for this GPU: step the grid down and try again. A lattice keeps its cells
          // or goes: the next grid is the largest one shaped like the screen with fewer cells (ADR 0026). For a grid
          // shaped like the screen that is the next resolution below.
          const aspect = this.canvas.width / Math.max(1, this.canvas.height);
          const lower = [...RESOLUTIONS].reverse().find((r) => {
            const [gw, gh] = gridSize(r, aspect);
            return gw * gh < w * h;
          });
          if (!(err instanceof OutOfMemoryError) || lower === undefined) {
            this.stop(); // nothing is left to draw
            throw err;
          }
          this.settings = { ...this.settings, lattice: null, resolution: lower };
          if (lattice)
            this.onAdjust?.(
              `The GPU ran out of memory for a lattice of ${latticeText(lattice)}. The scene runs on a grid of ${lower} cells on the long side.`,
              lower,
              lattice,
            );
          else this.onAdjust?.(`Lowered the grid to ${lower} cells: the GPU ran out of memory.`, lower);
          continue;
        }
        old = this.sim;
        this.live = true;
        this.painted = 0; // a new simulation starts without food, light and walls
        this.built = { resolution, lattice, density, dish: boundary === 'dish' };
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

  /** Removes food, light and walls, also from simulations built later. Strokes not painted yet go too. */
  clearEnvironment() {
    this.edits = [];
    this.painted = 0;
    this.placement = undefined;
    [this.running, this.queue] = [undefined, []];
    if (this.live) this.sim.clearEnvironment();
    this.onEdits?.();
  }

  fitView() {
    const { width, height } = this.sim;
    // The sweeps that wait judge the grid on screen until now: they finish before it changes.
    if ((this.viewGrid?.[0] !== width || this.viewGrid[1] !== height) && this.sweepFor()) this.onEdits?.();
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
   * the first simulation exists no grid is on screen, so the stroke is dropped. So is a stroke that does not clearly
   * paint a cell (paintsCell()), such as one beside a box, outside the dish or light that rounds to 0 there: it
   * changes nothing on screen, and on another grid or arena it must not either. Positions and radius go to the
   * nearest whole STEP first, and the stroke is painted and recorded so: a shared link then holds it exactly.
   */
  paint(stroke: Stroke) {
    if (![...stroke.from, ...stroke.to, stroke.radius].every(Number.isFinite) || !this.viewGrid) return;
    const s: Stroke = {
      ...stroke,
      from: [snap(stroke.from[0]), snap(stroke.from[1])],
      to: [snap(stroke.to[0]), snap(stroke.to[1])],
      radius: Math.max(MIN_RADIUS, snap(stroke.radius)),
    };
    if (!paintsCell(s, ...this.viewGrid, this.settings.boundary)) return;
    const edit = fromStroke(s, this.viewGrid, this.settings.boundary);
    this.edits.push(edit);
    this.placement?.push(edit);
    if (edit.kind === 'erase' || edit.kind === 'wall') this.queue.push(edit);
    this.sweepFor(PAINT_ROWS);
    this.onEdits?.();
  }

  /** False while a sweep waits for frames (sweepFor()). */
  get swept() {
    return !this.running && this.queue.length === 0;
  }

  /**
   * After a stroke that clears, the sweep deletes the edits that later strokes cleared completely on the grid on
   * screen and the erases that clear nothing there any more (sweep.ts). That changes no byte there, and an erased
   * food stays gone on every other grid. Runs the sweeps that wait for about `rows` rows of work or until
   * performance.now() reaches `until`, and deletes what they find; true if that was an edit. A long sweep goes on in
   * the next frame.
   */
  private sweepFor(rows = Infinity, until = Infinity): boolean {
    let [work, deleted] = [0, false];
    while (work < rows && (until === Infinity || performance.now() < until)) {
      if (!this.running) {
        const edit = this.queue.shift();
        if (!edit || !this.viewGrid) return deleted;
        const x = this.edits.lastIndexOf(edit);
        if (x < 0) continue; // an earlier sweep deleted it
        const [w, h] = this.viewGrid;
        let placement = this.placement;
        if (placement?.w !== w || placement.h !== h || placement.length !== this.edits.length)
          this.placement = placement = new Placement(w, h, this.edits);
        this.running = sweeping(placement, x);
      }
      const step = this.running.next();
      if (!step.done) work += step.value;
      else {
        this.running = undefined;
        deleted = this.delete(step.value) || deleted;
      }
    }
    return deleted;
  }

  /** Deletes the edits a sweep found: true if there was one. */
  private delete(gone: ReadonlySet<number>): boolean {
    if (gone.size === 0) return false;
    // The simulation holds the first `painted` edits. One of them that goes keeps its cells there until the strokes
    // that cleared them are painted, also when those go too: so the simulation gets every stroke recorded so far.
    if (this.live && [...gone].some((i) => i < this.painted)) this.flushEnv();
    this.painted -= [...gone].filter((i) => i < this.painted).length;
    compact(this.edits, gone);
    this.placement?.remove(gone);
    return true;
  }

  /**
   * Paints the edits the current simulation does not hold yet, mapped to its grid, in one call. Each goes through the
   * canonical frame of the arena it was painted in (strokeOn()), whatever arena the simulation runs in.
   */
  private flushEnv() {
    if (this.painted === this.edits.length) return;
    const { width, height } = this.sim;
    const strokes = this.edits.slice(this.painted).map((e) => strokeOn(e, width, height));
    // A new simulation maps every edit onto the grid on screen: the sweep keeps them instead of mapping them again. On
    // the same grid it keeps its placement, and with it what earlier sweeps found.
    const kept = this.placement;
    const same = kept?.w === width && kept.h === height && kept.length === this.edits.length;
    if (this.painted === 0 && this.viewGrid?.[0] === width && this.viewGrid[1] === height && !same) {
      this.placement = new Placement(width, height);
      for (const s of strokes) this.placement.add(s);
    }
    this.painted = this.edits.length;
    this.sim.paint(strokes.filter((s) => s !== undefined));
  }

  /**
   * The agent tool held during the next frame. Call it every frame while the tool is held (App.svelte). A tool whose
   * brush reaches no cell of the arena, such as one held on the free space beside a closed lattice (ADR 0026), can
   * change nothing: it is idle, so a paused hold runs no step. On a periodic grid every brush reaches the grid.
   */
  agentTool(tool: HeldTool) {
    const { x, y, radius } = tool;
    const brush = { kind: 'erase' as const, from: [x, y] as [number, number], to: [x, y] as [number, number], radius };
    const reaches = this.live && paintsCell(brush, this.sim.width, this.sim.height, this.settings.boundary);
    this.pendingTool = reaches ? tool : { ...tool, idle: true };
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
   * One frame: a slice of a long sweep, new strokes, as many steps as the speed asks for and the GPU keeps up with,
   * then one render. When the GPU falls behind, the steps per frame drop (budget.ts), so a slow GPU lowers the
   * simulation speed instead of the frame rate.
   *
   * A held agent tool acts on every step of the frame. The frame stands for its interval (budget.ts, at most 100 ms),
   * and each step for its share of that time. So without the rule an inoculation places the same amount per second of
   * holding at any frame rate and speed (ADR 0023). With the rule, only the free cells of the brush take agents, and
   * a cell becomes free when its agent walks off: the amount then also goes up with the steps per second. The speed
   * sets these, at any frame rate. A frame without a step passes its time on to the next step. While paused, a held
   * tool runs PAUSED_TOOL_STEPS steps per second, so that it acts. An idle one (HeldTool) runs none and keeps no
   * time: its steps would only move the paused scene.
   */
  frame(now: number, forceSteps?: number) {
    if (this.rebuilding) return;
    if (this.sweepFor(Infinity, performance.now() + FRAME_MS)) this.onEdits?.();
    this.flushEnv();
    const planned = this.budget.next(now, this.paused || forceSteps !== undefined ? 0 : this.settings.speed);
    const pausedHold = this.paused && forceSteps === undefined;
    const held = this.pendingTool && !(pausedHold && this.pendingTool.idle) ? this.pendingTool : undefined;
    this.pendingTool = undefined;
    this.heldFor = held ? this.heldFor + this.budget.interval / 1000 : 0;
    let steps = forceSteps ?? planned;
    if (held && pausedHold) {
      this.pausedSteps += (this.budget.interval / 1000) * PAUSED_TOOL_STEPS;
      steps = Math.floor(this.pausedSteps + SLACK);
      this.pausedSteps -= steps;
    } else this.pausedSteps = 0;
    if (steps > 0) {
      this.sim.run(steps, held && stepTool(held, this.heldFor / steps));
      this.heldFor = 0;
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

  /** The auto levels frames use now; the scent view's legend reads its mark from them (Levels.strand). */
  levels(): Levels {
    return this.backend.levels();
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
