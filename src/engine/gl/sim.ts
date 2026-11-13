import type { Boundary, Settings } from '../../model/params';
import { at } from '../at';
import { outlineRects, paintSegments, PendingOutlines, scissorRects, unionRects, type Rect } from '../brush';
import { FLOW, FLOW_BYTES, FLOW_ITERATIONS, flowOn, flowSites, flowStrains, packFlow } from '../flow';
import {
  CLEAR_TILE,
  growthOn,
  growthTests,
  packParams,
  PARAMS_BYTES,
  pyramidLevels,
  startRounds,
  trailSaturation,
  type AgentTool,
} from '../pack';
import { diffusePlan, viewTrailOn } from '../sizing';
import { tubesShown } from '../tubes';
import { EnvKind, SHAPE_RANGE, type AgentState, type EnvTool, type Sim, type Stroke } from '../types';
import {
  clear,
  destroyTarget,
  fence,
  readTarget,
  readTargetAsync,
  stencilTarget,
  target,
  textures,
  uniformBlock,
  writeTarget,
  type GL,
  type Target,
} from './gl';
import { FLOW_BINDING, ORDER_TILE, PARAMS_BINDING, type Program, type Programs } from './programs';

type Pair<T> = [T, T];
type Bit = 0 | 1;
const flip = (b: Bit): Bit => (b === 0 ? 1 : 0);
const AGENT_ROW = 2048;
/** Side of the alive tally target (points.vert kind 3): 128² pixels keep every pixel sum exact. */
const TALLY_SIDE = 128;
/** Channels a brush writes: erase and walls all, food only green, light only blue (the maximum of old and new). */
const MASKS: Record<number, [boolean, boolean, boolean, boolean]> = {
  [EnvKind.erase]: [true, true, true, true],
  [EnvKind.wall]: [true, true, true, true],
  [EnvKind.food]: [false, true, false, false],
  [EnvKind.light]: [false, false, true, false],
};
/** Side of the tiles syncShape() copies the outline target in: 1 MiB at a time. */
const REFRESH_TILE = 512;
/** Sort the order of the point passes every this many steps, as sim.ts sorts its agents (ADR 0005, ADR 0028). */
const SORT_INTERVAL = 32;
/** Nodes in a row of a level of the sort's pyramid (order.frag LEVEL_WIDTH). */
const LEVEL_WIDTH = 2048;
/**
 * Levels of the sort's pyramid that its gather can read (order.frag PASS 2). It has a fan-in of 4, as pyramidLevels():
 * 4^11 = 2^22 slots, the most agents of WebGL2 (backend.ts maxAgents) in rows of 2048.
 */
const ORDER_LEVELS = 11;

/**
 * A pyramid of sums with a fan-in of 4 (growth.frag): level k ≥ 1 lies in texture k mod 2, `width` texels a row, from
 * row `rows[k]`. `sizes[k]` is its node count, `sizes[0]` the elements, and `top` the level with one node.
 */
interface Pyramid {
  textures: Pair<Target>;
  width: number;
  sizes: number[];
  rows: number[];
  top: number;
}

/** The targets of growth and shrinkage (growth.frag, growth.vert), while growth is on (ADR 0025). */
interface GlGrowth {
  rows: Target;
  windows: Target;
  claims: Target;
  births: Target;
  cells: Pyramid;
  dead: Pyramid;
}

/** The layout of a pyramid over `n` elements, `width` texels a row (Pyramid). */
function pyramidLayout(n: number, width: number) {
  const sizes = [n, ...pyramidLevels(n)];
  const rows = sizes.map(() => 0);
  const heights = [0, 0];
  sizes.forEach((size, k) => {
    if (k === 0) return;
    const t = k % 2;
    rows[k] = heights[t] ?? 0;
    heights[t] = (heights[t] ?? 0) + Math.ceil(size / width);
  });
  return { sizes, rows, heights, top: sizes.length - 1 };
}

/** Cells of some rectangles. */
const area = (rects: readonly Rect[]) => rects.reduce((sum, [, , w, h]) => sum + w * h, 0);

/** Uniform values of the levels of a pyramid, for an array of 13 (growth.frag PASS 4): a grid side of up to 4096. */
function padded(values: readonly number[]): Int32Array {
  const out = new Int32Array(13);
  out.set(values.slice(0, 13));
  return out;
}

/** About the cells deep in a segment, where its subtraction writes 0 (SHAPE_RANGE cells inside its brush). */
function core({ from: a, to: b, radius }: Stroke) {
  const rho = Math.max(radius - SHAPE_RANGE, 0);
  return 2 * rho * Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.PI * rho * rho;
}

/** A draw of shape.frag: its `op`, the channels it writes (R wall, G food, B light, A shadow), its blend equation. */
type OutlineDraw = [number, [boolean, boolean, boolean, boolean], 'MAX' | 'MIN' | null];
/**
 * How shape.frag applies a run's segments of a kind to the outline target: per segment over its outline box the
 * union (op 0, MAX blending) or the subtraction (op 1, MIN blending); then, once per cell of the union of the
 * segments' boxes, the hold of the subtracted layers (op 4, MIN blending) and the light and the shadow (op 2). The
 * hold, the light and the shadow depend only on `env` after the run, so overlapping boxes need them once.
 */
const OUTLINE_DRAWS: Record<EnvTool, { segment: OutlineDraw[]; hold?: OutlineDraw; run: OutlineDraw[] }> = {
  erase: {
    segment: [[1, [true, true, false, false], 'MIN']],
    hold: [4, [true, true, false, false], 'MIN'],
    run: [[2, [false, false, true, true], null]],
  },
  wall: {
    segment: [
      [0, [true, false, false, false], 'MAX'],
      [1, [false, true, false, false], 'MIN'],
    ],
    hold: [4, [false, true, false, false], 'MIN'],
    run: [[2, [false, false, true, true], null]],
  },
  food: { segment: [[0, [false, true, false, false], 'MAX']], run: [] },
  light: { segment: [], run: [[2, [false, false, true, false], null]] },
};

/** The simulation with WebGL2 fragment passes (ADR 0003); same model and parameters as sim.ts. */
export class GlSim implements Sim {
  step = 0;
  /**
   * Counts the changes of the trail, the scent and the shape outside steps (reset, strokes, clearing, writes, a new
   * hold of the shape); `step` counts the steps (sim.ts `revision`).
   */
  revision = 0;
  readonly agentWidth: number;
  private settings: Settings;
  private readonly ubo: WebGLBuffer;
  private readonly paramData = new ArrayBuffer(PARAMS_BYTES);
  private readonly agentsTex: Pair<Target>;
  readonly trail: Pair<Target>;
  private readonly scent: Pair<Target>;
  private readonly counts: Target;
  /** Without float blending: one panel per strain with a stencil, for exact counts (deposit()). */
  private readonly panels: Target | undefined;
  /**
   * The order of the point passes (order.frag, ADR 0028): per slot a key and the agent that its point draws, in the
   * layout of the agents. The sort writes both in turn; `o` is the one that holds its result, the current order.
   */
  private readonly order: Pair<Target>;
  private o: Bit = 0;
  /** The levels 1 and up of the sort's pyramid of digit counts (order.frag PASS 1), and their nodes. */
  private readonly orderLevels: Target[];
  private readonly orderSizes: number[];
  /** The points of a point pass: every slot of the agents' layout (order.frag sorts them all). */
  private readonly slots: number;
  /** Sort the order of the point passes every this many steps; 0 never (measurements and tests). */
  sortInterval = SORT_INTERVAL;
  /** The step whose sort has run already, ahead of it (sortNow()); −1: none. */
  private sortedFor = -1;
  private readonly env: Target;
  /** Distances to the painted outlines, the light and the walls' drop shadow, for the renderer only (shape.frag). */
  private readonly shape: Target;
  /**
   * False until something other than the eraser is painted after the last clear; the renderer then skips the
   * environment.
   */
  hasEnvironment = false;
  /**
   * The boundary under which every byte of the outline target is held to `env`. After a change of boundary, or after
   * strokes painted under another boundary (then undefined), syncShape() holds it again before its next use.
   */
  private shapeHeld: Boundary | undefined;
  /** Where the outlines of the run that paint() draws next lie (brush.ts). */
  private readonly pending: PendingOutlines;
  /**
   * Whether walls, food and light were painted since the last clear: without them their bytes are all 0 (the
   * shadow too, without walls). A pass cannot read the bytes it changes, so it would compute them all anew.
   */
  private readonly layers = [false, false, false];
  private readonly tally: Target;
  private readonly mrt: Pair<WebGLFramebuffer>;
  private collision?: { occ: Pair<Target>; claims: Target };
  /** The targets of growth and shrinkage, while growth is on (ADR 0025). */
  private growth?: GlGrowth | undefined;
  /**
   * The state of the flow in the tubes, while it is on (flow.frag, ADR 0029; `FlowState` in ../sim.ts): per strain the
   * memory of each cell in two targets and the pressure of the four lanes in three (ADR 0031), and the uniform block
   * of the passes, which holds the block of one strain at a time.
   */
  private flow?: { memory: Pair<Target>[]; pressure: Target[][]; ubo: WebGLBuffer } | undefined;
  /** Which memory target is current, and which pressure target holds the pressure in work. */
  private flowM: Bit = 0;
  private flowP = 0;
  /** The food sites that give and take the flux (foodSites()). */
  private sites: [number, number][] = [];
  private readonly flowData = new ArrayBuffer(FLOW_BYTES);
  /**
   * Without float blending (no collision targets): 1 where a cell holds an agent after the moves, for covered food
   * (diffuse.frag COVERED). Allocated at its first use.
   */
  private presence: Target | undefined;
  /** A food or a light may lie in `env` since the last clear (sim.ts `sources`). */
  private sources = false;
  /**
   * The scent targets hold only zeros, and no step can change that (sim.ts `scentless`, ADR 0028): the agent and
   * diffusion passes then read the scent from a texture of one texel, `noScent`. Their `texelFetch` lies outside that
   * texture for every cell but (0, 0). WebGL 2.0 ("Differences Between WebGL and OpenGL ES 3.0", "Texel Fetches"): a
   * texel fetch out of range must return zero for a complete texture, and (0, 0, 0, 1) only for an incomplete one;
   * `noScent` is complete (one level, nearest filter). Both readers take only `.xy` (agents.frag `sense()`,
   * diffuse.frag `load()`), which is 0 in either case. The passes stay as they are and still write the scent of every
   * cell: zeros.
   */
  scentless = false;
  /** One texel of zeros: the scent while `scentless`. */
  private readonly noScent: Target;
  /** The view's third trail and scent, for the view of a step that moves first with two diffusion passes or more. */
  private viewThird: { trail: Target; scent: Target; fbo: WebGLFramebuffer } | undefined;
  /** The targets that hold the view's map (viewTargets()), and whether a change of the state since made it stale. */
  private viewOut: { trail: Target; scent: Target } | undefined;
  private viewStale = true;
  /**
   * The targets of the picture of the tubes (tubes.frag, ADR 0034), allocated while the settings show it: per cell and
   * strain the factor of the radius of its tube, and the trail that the view draws. `tubesStale`: a change of the state
   * since made the picture stale.
   */
  private tubes: { roots: Target; picture: Target } | undefined;
  private tubesStale = true;
  /**
   * A wall was painted since the last clear: moves and sensors then check every cell they cross (agents.frag
   * clearPath, ADR 0020).
   */
  private walls = false;
  /** Per clearance tile: whether it holds a wall cell, and how far the nearest wall lies at least (walls.frag). */
  private readonly walled: Target;
  private readonly clearance: Target;
  private a: Bit = 0;
  private p: Bit = 0;
  private q: Bit = 0;

  constructor(
    private readonly gl: GL,
    private readonly prog: Programs,
    settings: Settings,
    readonly width: number,
    readonly height: number,
    readonly agents: number,
    private readonly floatBlend: boolean,
    /** Agents alive at the start: fewer than `agents` when the capacity holds more (ADR 0025). */
    readonly start = agents,
  ) {
    this.settings = settings;
    this.shapeHeld = settings.boundary;
    this.pending = new PendingOutlines(width, height);
    this.agentWidth = Math.min(agents, AGENT_ROW);
    const agentHeight = Math.ceil(agents / this.agentWidth);
    this.slots = this.agentWidth * agentHeight;
    this.orderSizes = pyramidLevels(this.slots);
    if (this.orderSizes.length > ORDER_LEVELS) throw new RangeError(`No order for ${String(this.slots)} agent slots.`);
    const made: Target[] = [];
    const t = (w: number, h: number, f: number) => {
      const x = target(gl, w, h, f);
      made.push(x);
      return x;
    };
    this.ubo = uniformBlock(gl, PARAMS_BYTES, PARAMS_BINDING);
    try {
      this.agentsTex = [t(this.agentWidth, agentHeight, gl.RGBA32F), t(this.agentWidth, agentHeight, gl.RGBA32F)];
      this.order = [t(this.agentWidth, agentHeight, gl.RG32F), t(this.agentWidth, agentHeight, gl.RG32F)];
      this.orderLevels = this.orderSizes.map((n) =>
        t(Math.min(n, LEVEL_WIDTH), Math.ceil(n / LEVEL_WIDTH), gl.RGBA32F),
      );
      this.trail = [t(width, height, gl.RGBA32F), t(width, height, gl.RGBA32F)];
      this.scent = [t(width, height, gl.RG32F), t(width, height, gl.RG32F)];
      this.noScent = t(1, 1, gl.RG32F); // a new texture holds zeros
      // Float blending sums the counts directly. Without it, deposit() counts in half floats with a
      // stencil and writes the sums here.
      this.counts = t(width, height, gl.RGBA32F);
      if (!floatBlend) {
        const p = stencilTarget(gl, 2 * width, 2 * height, gl.RG16F);
        made.push(p);
        this.panels = p;
      }
      this.env = t(width, height, gl.RGBA8);
      this.shape = t(width, height, gl.RGBA8);
      const [tx, ty] = [Math.ceil(width / CLEAR_TILE), Math.ceil(height / CLEAR_TILE)];
      this.walled = t(tx, ty, gl.R32F);
      this.clearance = t(tx, ty, gl.R32F);
      this.tally = t(TALLY_SIDE, TALLY_SIDE, floatBlend ? gl.RGBA32F : gl.RGBA16F);
      // Collisions need float blending. Allocated now, so a failure is freed below; the budget counts them.
      if (floatBlend) {
        const r = () => t(width, height, gl.R32F);
        this.collision = { occ: [r(), r()], claims: r() };
      }
    } catch (err) {
      // The engine retries with a smaller grid: a half-built simulation must not keep its memory.
      for (const x of made) destroyTarget(gl, x);
      gl.deleteBuffer(this.ubo);
      throw err;
    }
    this.mrt = [0, 1].map((i) => {
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.trail[i as Bit].texture, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.scent[i as Bit].texture, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      return fbo;
    }) as Pair<WebGLFramebuffer>;
    this.reset();
  }

  get currentTrail(): Target {
    return this.trail[this.p];
  }

  /**
   * The trail and scent that the view draws (ADR 0027): the map after the step's diffusion. Sensing first the textures
   * hold it. Moving first they hold the map as the agents sense it, before its diffusion; the step's diffusion passes
   * without its sources and its cut (diffuse.frag VIEW) then write the map after the diffusion, trail and scent, into
   * the free pair and, from a second pass on, into a third pair (sim.ts viewTextures). Made once for each state; the
   * scent view's coarse map keys on the step and on `revision`, which update() counts.
   */
  viewTargets(): { trail: Target; scent: Target } {
    if (this.settings.stepOrder === 'sense-first') return { trail: this.currentTrail, scent: this.currentScent };
    if (this.viewStale || !this.viewOut) this.encodeView();
    return this.viewOut ?? { trail: this.currentTrail, scent: this.currentScent };
  }

  /** The trail of viewTargets(). */
  viewTrail(): Target {
    return this.viewTargets().trail;
  }

  /** The passes of viewTargets(): the step's diffusion plan, the input the map as the agents sense it. */
  private encodeView() {
    const gl = this.gl;
    this.writeParams();
    const free = flip(this.p);
    const d = this.prog.view();
    let input = { trail: this.trail[this.p], scent: this.scent[this.p] };
    for (const [i, v] of diffusePlan(this.settings.diffusion).entries()) {
      // Even passes write the free pair, odd passes the third, so no pass reads the target it writes.
      const third = i % 2 === 1 ? this.ensureViewThird() : undefined;
      const out = third ?? { trail: this.trail[free], scent: this.scent[free] };
      gl.bindFramebuffer(gl.FRAMEBUFFER, third ? third.fbo : this.mrt[free]);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(d.program);
      const env = this.env.texture;
      textures(gl, d.program, {
        trailIn: input.trail.texture,
        scentIn: (this.scentless ? this.noScent : input.scent).texture,
        counts: this.counts.texture,
        env,
        occ: env,
      });
      gl.uniform1i(d.loc('first'), Number(v.first));
      gl.uniform1i(d.loc('last'), Number(v.last));
      gl.uniform1i(d.loc('blur'), Number(v.blur));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      input = { trail: out.trail, scent: out.scent };
    }
    this.viewOut = input;
    this.viewStale = false;
  }

  /** The view's third trail and scent with their framebuffer, made at their first use (sizing.ts VIEW_BYTES_PER_CELL). */
  private ensureViewThird() {
    if (!this.viewThird) {
      const gl = this.gl;
      const trail = target(gl, this.width, this.height, gl.RGBA32F);
      const scent = target(gl, this.width, this.height, gl.RG32F);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, trail.texture, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, scent.texture, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      this.viewThird = { trail, scent, fbo };
    }
    return this.viewThird;
  }

  /** Frees the view's third pair. */
  private dropViewThird() {
    if (!this.viewThird) return;
    destroyTarget(this.gl, this.viewThird.trail);
    destroyTarget(this.gl, this.viewThird.scent);
    this.gl.deleteFramebuffer(this.viewThird.fbo);
    this.viewThird = undefined;
  }

  /** A change of the state: the view's map and the picture of the tubes are made anew at their next use. */
  private changed() {
    this.viewStale = true;
    this.tubesStale = true;
  }

  /**
   * The trail that the picture draws (../sim.ts pictureTexture): the view's trail, or, while the settings show the
   * tubes and the flow holds a state, the trail with every tube as wide and as bright as its flow memory says
   * (tubes.frag, ADR 0034). Made once for each state. Its passes bind their own targets, as those of viewTargets().
   */
  pictureTarget(): Target {
    if (!tubesShown(this.settings) || !this.flow) return this.viewTrail();
    if (this.tubesStale || !this.tubes) return this.encodeTubes(this.flow).picture;
    return this.tubes.picture;
  }

  /** The passes of pictureTarget(): the factor of the radius of every tube, then the picture. */
  private encodeTubes(flow: NonNullable<GlSim['flow']>) {
    this.syncShape();
    // Before the parameters of these passes: moving first the view's passes write theirs (encodeView()).
    const trail = this.viewTrail().texture;
    this.writeParams();
    const tubes = this.ensureTubes();
    const k = this.prog.tubes();
    this.pass(k.roots, tubes.roots, this.flowMemories(flow), { strains: flow.memory.length });
    this.pass(k.picture, tubes.picture, { trail, shape: this.shape.texture, roots: tubes.roots.texture }, {});
    this.tubesStale = false;
    return tubes;
  }

  /** The targets of the picture of the tubes, made at their first use (sizing.ts TUBES_BYTES_PER_CELL counts them). */
  private ensureTubes() {
    if (!this.tubes) {
      const gl = this.gl;
      const roots = target(gl, this.width, this.height, gl.RGBA32F);
      try {
        this.tubes = { roots, picture: target(gl, this.width, this.height, gl.RGBA32F) };
      } catch (error) {
        // The second target did not fit: the first must not stay behind.
        destroyTarget(gl, roots);
        throw error;
      }
    }
    return this.tubes;
  }

  /** Frees the targets of the picture of the tubes. */
  private dropTubes() {
    if (!this.tubes) return;
    destroyTarget(this.gl, this.tubes.roots);
    destroyTarget(this.gl, this.tubes.picture);
    this.tubes = undefined;
    this.tubesStale = true;
  }

  /** For tests: the trail that the picture draws (pictureTarget()), 4 lanes per cell. */
  readPicture(): Promise<Float32Array> {
    return Promise.resolve(readTarget(this.gl, this.pictureTarget()) as Float32Array);
  }

  /** For tests: the factor of the radius of the tube of every cell and strain, 4 values per cell; empty without it. */
  readTubeRoots(): Promise<Float32Array> {
    if (!tubesShown(this.settings) || !this.flow) return Promise.resolve(new Float32Array(0));
    const tubes = this.tubesStale || !this.tubes ? this.encodeTubes(this.flow) : this.tubes;
    return Promise.resolve(readTarget(this.gl, tubes.roots) as Float32Array);
  }

  /** For tests: the trail map that the view draws (viewTargets()), 4 lanes per cell. */
  readView(): Promise<Float32Array> {
    return Promise.resolve(readTarget(this.gl, this.viewTargets().trail) as Float32Array);
  }

  /** For tests: the scent that the view draws (viewTargets()), 2 values per cell. */
  readViewScent(): Promise<Float32Array> {
    // readTarget() reads 4 channels per cell; the scent targets hold 2 (readScent()).
    const rgba = readTarget(this.gl, this.viewTargets().scent);
    return Promise.resolve(
      Float32Array.from({ length: (rgba.length / 4) * 2 }, (_, i) => rgba[(i >> 1) * 4 + (i & 1)] ?? 0),
    );
  }

  /** The scent of the same state as currentTrail: both alternate together. */
  get currentScent(): Target {
    return this.scent[this.p];
  }

  get countsTexture(): WebGLTexture {
    return this.counts.texture;
  }

  get shapeTexture(): WebGLTexture {
    return this.shape.texture;
  }

  /** Agents per cell after the last step, kept in collision mode only; none without float blending. */
  get occupancyTexture(): WebGLTexture | undefined {
    return this.collision?.occ[this.q].texture;
  }

  update(settings: Settings) {
    const switchedOn = settings.collisions && !this.settings.collisions;
    // Moving first new settings make a new view of the same state, and the scent view's coarse map counts it as a change
    // of the scent (ADR 0027); the step after them changes the step count anyway.
    if (settings.stepOrder === 'move-first' || this.settings.stepOrder === 'move-first') this.revision++;
    this.settings = settings;
    this.changed();
    // The memory fit counts the view's third target only while a step moves first with two passes or more.
    if (!viewTrailOn(settings) && this.viewThird) {
      this.dropViewThird();
      this.viewOut = undefined;
    }
    if (switchedOn) this.rebuildOccupancy();
    // The memory fit counts `presence` only while covered food is on (sizing.ts), and growth's targets only while it
    // is on.
    if (!settings.coveredFood && this.presence) {
      destroyTarget(this.gl, this.presence);
      this.presence = undefined;
    }
    if (!growthOn(settings) && this.growth) {
      for (const t of this.growthTargets()) destroyTarget(this.gl, t);
      this.growth = undefined;
    }
    // The memory fit counts the targets of the flow only while it is on.
    if (!flowOn(settings) && this.flow) this.dropFlow();
    // The picture of the tubes holds its targets only while the settings show it (tubes.ts). The memory fit counts them
    // with the flow, shown or not (sizing.ts tubesBytesPerCell()).
    if (!tubesShown(settings)) this.dropTubes();
  }

  foodSites(centres: readonly (readonly [number, number])[]) {
    this.sites = flowSites(centres, this.width, this.height);
  }

  /**
   * The targets and the uniform block of the flow, made at their first use (sizing.ts FLOW_BYTES_PER_CELL), with the
   * targets of every strain of the settings (ADR 0031). Settings with another number of strains get a new state.
   */
  private ensureFlow() {
    const strains = flowStrains(this.settings);
    if (this.flow && this.flow.memory.length !== strains) this.dropFlow();
    if (!this.flow) {
      const gl = this.gl;
      const made: Target[] = [];
      const make = () => {
        const t = target(gl, this.width, this.height, gl.RGBA32F);
        made.push(t);
        return t;
      };
      const each = <T>(of: () => T) => Array.from({ length: strains }, of);
      try {
        const memory = each((): Pair<Target> => [make(), make()]);
        const pressure = each(() => [make(), make(), make()]);
        this.flow = { memory, pressure, ubo: uniformBlock(gl, FLOW_BYTES, FLOW_BINDING) };
      } catch (err) {
        for (const t of made) destroyTarget(gl, t);
        throw err;
      }
      this.clearFlow();
    }
    return this.flow;
  }

  /** The start of the flow of every strain: every cell with the memory of fresh ground, no tube, no pressure. */
  private clearFlow() {
    const gl = this.gl;
    if (!this.flow) return;
    for (const t of this.flow.memory.flat()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, t.width, t.height);
      gl.clearColor(FLOW.fresh, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    for (const t of this.flow.pressure.flat()) clear(gl, t);
    this.flowM = 0;
    this.flowP = 0;
  }

  private dropFlow() {
    if (!this.flow) return;
    for (const t of [...this.flow.memory.flat(), ...this.flow.pressure.flat()]) destroyTarget(this.gl, t);
    this.gl.deleteBuffer(this.flow.ubo);
    this.flow = undefined;
  }

  /** The uniform block of the flow with the block of a strain (flow.ts packFlow()): the passes that follow read it. */
  private flowBlock(flow: NonNullable<GlSim['flow']>, strain: number) {
    const gl = this.gl;
    gl.bindBufferBase(gl.UNIFORM_BUFFER, FLOW_BINDING, flow.ubo);
    const block = packFlow(this.settings, this.sites, this.flowData, strain);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Uint8Array(block));
  }

  /**
   * The memory of the flow of every strain for the agent passes and growth (flowMemoryOf in tools.glsl): the samplers
   * `flowMemory`, `flowMemory1`, `flowMemory2` and `flowMemory3`. A strain that the settings do not hold gets the
   * memory of the first strain: every sampler needs a texture, and no agent reads this one.
   */
  private flowMemories(flow: NonNullable<GlSim['flow']>): Record<string, WebGLTexture> {
    const of = (strain: number) => (flow.memory[strain] ?? at(flow.memory, 0))[this.flowM].texture;
    return { flowMemory: of(0), flowMemory1: of(1), flowMemory2: of(2), flowMemory3: of(3) };
  }

  /** Empty for a strain that the settings do not hold, and until the next step for a strain that is new (../sim.ts). */
  readFlow(strain = 0): Promise<Float32Array> {
    const memory = strain < flowStrains(this.settings) ? this.flow?.memory[strain] : undefined;
    if (!memory) return Promise.resolve(new Float32Array(0));
    return Promise.resolve(readTarget(this.gl, memory[this.flowM]) as Float32Array);
  }

  readPressure(strain = 0): Promise<Float32Array> {
    const pressure = strain < flowStrains(this.settings) ? this.flow?.pressure[strain] : undefined;
    if (!pressure) return Promise.resolve(new Float32Array(0));
    return Promise.resolve(readTarget(this.gl, at(pressure, this.flowP)) as Float32Array);
  }

  writeFlow(data: Float32Array, strain = 0) {
    if (!flowOn(this.settings) || strain >= flowStrains(this.settings)) return;
    writeTarget(this.gl, at(this.ensureFlow().memory, strain)[this.flowM], 0, 0, this.width, this.height, data);
    // The picture of the tubes shows the memory (ADR 0034): a picture or a map made from the old one is old.
    this.changed();
    this.revision++;
  }

  reset() {
    this.revision++;
    const gl = this.gl;
    this.changed();
    // The scent targets are cleared below, and without a food or a light no step adds scent.
    this.scentless = !this.sources;
    this.step = 0;
    this.sortedFor = -1;
    this.a = 0;
    this.p = 0;
    this.writeParams();
    for (const t of [...this.trail, ...this.scent, this.counts]) clear(gl, t);
    this.clearFlow();
    // Every sampler gets a texture that is not the target: an active sampler on the target is a feedback loop.
    const env = this.env.texture;
    const init = { env, agentsIn: env, occ: env, claims: env };
    this.pass(this.initProgram(), this.agentsTex[0], init, { agentWidth: this.agentWidth, mode: 0 });
    // The point passes of the start draw in the order of the agents' indices: the keys of the sort hold it.
    this.orderKeys(this.order[0]);
    this.o = 0;
    if (this.settings.collisions) {
      this.placeOnFreeCells();
      this.rebuildOccupancy();
    }
  }

  /**
   * One agent per cell from the first step (ADR 0008), as in sim.ts: claim rounds after init (startRounds()). A round
   * counts the cells taken so far, lets every waiting agent claim its cell (points.vert kind 5, MAX blending) and
   * settles the claims (init.frag).
   */
  private placeOnFreeCells() {
    const gl = this.gl;
    const col = this.ensureCollision();
    const occ = col.occ[flip(this.q)];
    const rounds = startRounds(this.settings, this.walls);
    for (let round = 0; round < rounds; round++) {
      this.writeParams(undefined, round);
      clear(gl, occ);
      this.points(2, occ, gl.FUNC_ADD);
      clear(gl, col.claims);
      this.points(5, col.claims, gl.MAX, this.agentsTex[this.a], [0, 0, 0, 0], { occ: occ.texture });
      const textures = {
        env: this.env.texture,
        agentsIn: this.agentsTex[this.a].texture,
        occ: occ.texture,
        claims: col.claims.texture,
      };
      const mode = round === rounds - 1 ? 2 : 1;
      this.pass(this.initProgram(), this.agentsTex[flip(this.a)], textures, { agentWidth: this.agentWidth, mode });
      this.a = flip(this.a);
    }
  }

  /**
   * The start: with a capacity above the start population the one that starts only the first agents of each strain
   * (CAPACITY in init.frag), else the one of the code before (ADR 0025).
   */
  private initProgram(): Program {
    return this.start < this.agents ? this.prog.capacity() : this.prog.init;
  }

  /** Runs `steps` simulation steps. The agent tool acts on every one of them (ADR 0023). */
  run(steps: number, tool?: AgentTool) {
    if (steps > 0) this.changed();
    for (let k = 0; k < steps; k++) {
      this.writeParams(tool);
      if (this.sortInterval > 0 && this.step % this.sortInterval === 0 && this.sortedFor !== this.step) {
        this.sortOrder();
      }
      this.encodeStep();
      this.step++;
    }
  }

  /** The next step that sorts: the next multiple of the interval from the current step on (sim.ts sortStep). */
  private get sortStep() {
    return Math.ceil(this.step / this.sortInterval) * this.sortInterval;
  }

  sortDue(steps: number): boolean {
    if (this.sortInterval <= 0) return false;
    const next = this.sortStep;
    return next < this.step + steps && next !== this.sortedFor;
  }

  /**
   * The sort of the next step that sorts, now; that step then runs without it (sim.ts sortNow()). The order may be a
   * few steps older than that step: it only orders the points, and no result depends on their order (ADR 0028).
   */
  sortNow() {
    if (this.sortInterval <= 0) return;
    this.writeParams();
    this.sortOrder();
    this.sortedFor = this.sortStep;
  }

  /** For tests: the current order of the point passes, a key and an agent index per slot (order.frag). */
  readOrder(): Float32Array {
    const rgba = readTarget(this.gl, this.order[this.o]);
    return Float32Array.from({ length: this.slots * 2 }, (_, i) => rgba[(i >> 1) * 4 + (i & 1)] ?? 0);
  }

  /** The keys of the sort into `dst`, from the current agents (order.frag PASS 0): its slots in index order. */
  private orderKeys(dst: Target) {
    const keys = this.prog.order.keys;
    const tilesX = Math.ceil(this.width / ORDER_TILE);
    const none = tilesX * Math.ceil(this.height / ORDER_TILE);
    this.pass(keys, dst, { agentsIn: this.agentsTex[this.a].texture }, { agentWidth: this.agentWidth, tilesX, none });
  }

  /**
   * Sorts the order of the point passes by the tile of each agent's cell (order.frag, ADR 0028): the keys, then one
   * radix pass per 2 bits of the largest key, each with its pyramid of digit counts. The result is the current order.
   */
  private sortOrder() {
    const { level, gather } = this.prog.order;
    const keys = Math.ceil(this.width / ORDER_TILE) * Math.ceil(this.height / ORDER_TILE); // the largest key: none
    let bits = 1;
    while (2 ** bits <= keys) bits++;
    let from: Bit = 0;
    this.orderKeys(this.order[from]);
    const levels = this.orderLevels;
    const top = levels.length;
    for (let shift = 0; shift < bits; shift += 2) {
      levels.forEach((dst, k) => {
        const below = k === 0 ? this.order[from] : levels[k - 1];
        if (!below) throw new Error('No level below');
        this.pass(
          level,
          dst,
          { below: below.texture },
          {
            first: k === 0 ? 1 : 0,
            belowWidth: below.width,
            belowSize: k === 0 ? this.slots : (this.orderSizes[k - 1] ?? 1),
            shift,
          },
        );
      });
      // Every sampler of the gather gets a texture: the levels above the top read the top level, unused.
      const tex: Record<string, WebGLTexture> = { orderIn: this.order[from].texture };
      for (let k = 1; k <= ORDER_LEVELS; k++)
        tex[`level${String(k)}`] = (levels[k - 1] ?? levels[top - 1] ?? this.counts).texture;
      const to = flip(from);
      this.pass(gather, this.order[to], tex, { agentWidth: this.agentWidth, slots: this.slots, shift, top });
      from = to;
    }
    this.o = from;
  }

  /**
   * Paints brush strokes in order, as segments that the pass paints exactly (brush.ts paintSegments). Every draw is
   * scissored to the cells its segment can reach (scissorRects), and the parameters, color mask and blending change
   * only where the boundary or the kind of brush changes. The outlines (shape.frag) follow in runs: the paint draws
   * of a run of segments, then their outline draws, so the render target changes twice per run and not twice per
   * segment. A run ends where the boundary changes or a segment of another kind meets it (brush.ts
   * PendingOutlines). Within a run the outlines give the bytes of one segment after another (ADR 0009), so one call
   * paints what one call per stroke paints.
   */
  paint(strokes: readonly Stroke[]) {
    if (strokes.length === 0) return;
    this.changed();
    this.revision++;
    // After a change of boundary the outline target is held to `env` under the new one first. Strokes under another
    // boundary leave that to the next readback or frame (below), so one call paints what one call per stroke paints.
    if (this.shapeHeld !== undefined) this.syncShape();
    const gl = this.gl;
    const p = this.prog.paint;
    const run: { segment: Stroke; kind: EnvTool; rects: Rect[] }[] = [];
    let boundary: Boundary | undefined;
    let kind = -1; // the kind the paint state is set for; -1: the env target is not bound
    let foreign = false;
    const drawRun = () => {
      if (run.length === 0) return;
      this.drawOutlines(run);
      run.length = 0;
      this.pending.clear();
      kind = -1;
    };
    for (const stroke of strokes) {
      const b = stroke.boundary ?? this.settings.boundary;
      const wrap = b === 'wrap';
      const k = EnvKind[stroke.kind];
      if (b !== this.settings.boundary) foreign = true;
      if (k === EnvKind.wall) this.walls = true;
      if (k === EnvKind.food || k === EnvKind.light) [this.sources, this.scentless] = [true, false];
      if (k !== EnvKind.erase) {
        this.hasEnvironment = true;
        this.layers[k - 1] = true;
      }
      for (const segment of paintSegments(stroke, this.width, this.height, wrap)) {
        const rects = scissorRects(segment, this.width, this.height, wrap);
        if (rects.length === 0) continue; // outside a closed arena: no cell to paint or outline
        const reach = outlineRects(segment, this.width, this.height, wrap);
        if (b !== boundary || this.pending.meets(reach, k, wrap)) {
          drawRun(); // with the parameters of its own boundary
          if (b !== boundary) {
            this.writeParams(undefined, 0, b);
            boundary = b;
          }
        }
        if (kind === -1) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.env.fbo);
          gl.viewport(0, 0, this.width, this.height);
          gl.useProgram(p.program);
          gl.enable(gl.SCISSOR_TEST);
        }
        if (k !== kind) {
          gl.colorMask(...(MASKS[k] ?? [true, true, true, true]));
          if (k === EnvKind.light) this.blend(gl.MAX);
          else gl.disable(gl.BLEND);
          gl.uniform1i(p.loc('kind'), k);
          kind = k;
        }
        gl.uniform1f(p.loc('radius'), segment.radius);
        gl.uniform2f(p.loc('from'), ...segment.from);
        gl.uniform2f(p.loc('to'), ...segment.to);
        for (const r of rects) {
          gl.scissor(...r);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        run.push({ segment, kind: stroke.kind, rects: reach });
        this.pending.add(reach, k, wrap);
      }
    }
    drawRun();
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.BLEND);
    if (foreign) this.shapeHeld = undefined;
    // Without walls no pass reads the clearance: an erase then needs none, and compiles no program for walls.
    if (this.walls && strokes.some((s) => s.kind === 'wall' || s.kind === 'erase')) this.updateClearance();
  }

  /**
   * The clearance of every tile from the walls in `env` (walls.frag), which the agent pass reads to skip walks that
   * cannot meet a wall; needed again after every change of the walls (Simulation.updateClearance in sim.ts). The
   * first pass marks the tiles with a wall cell; its unused sampler `walled` gets another texture than the target.
   */
  private updateClearance() {
    const env = this.env.texture;
    const { walls } = this.prog.walled();
    this.pass(walls, this.walled, { env, walled: this.clearance.texture }, { mode: 0 });
    this.pass(walls, this.clearance, { env, walled: this.walled.texture }, { mode: 1 });
  }

  clearEnvironment() {
    this.changed();
    this.revision++;
    clear(this.gl, this.env);
    clear(this.gl, this.shape);
    this.walls = false;
    this.hasEnvironment = false;
    // The scent that the targets hold stays until the next reset.
    this.sources = false;
    this.shapeHeld = this.settings.boundary;
    this.layers.fill(false);
  }

  /**
   * Holds the outline target to `env` under the current boundary (shape.frag op 3, see Simulation.syncShape()), once
   * after the boundary changed or after strokes under another boundary. Op 3 reads the bytes before from a copy,
   * made one tile at a time so the copy stays small.
   */
  syncShape() {
    if (this.shapeHeld === this.settings.boundary) return;
    this.revision++;
    this.shapeHeld = this.settings.boundary;
    if (!this.hasEnvironment) return; // nothing painted: the target holds only zeros, under every boundary
    const gl = this.gl;
    this.writeParams();
    const [tw, th] = [Math.min(this.width, REFRESH_TILE), Math.min(this.height, REFRESH_TILE)];
    const copy = target(gl, tw, th, gl.RGBA8);
    gl.enable(gl.SCISSOR_TEST);
    for (let y = 0; y < this.height; y += th)
      for (let x = 0; x < this.width; x += tw) {
        const [w, h] = [Math.min(tw, this.width - x), Math.min(th, this.height - y)];
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.shape.fbo);
        gl.bindTexture(gl.TEXTURE_2D, copy.texture);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, x, y, w, h);
        gl.scissor(x, y, w, h);
        this.pass(this.prog.shape, this.shape, { env: this.env.texture, old: copy.texture }, { op: 3 }, (p) => {
          gl.uniform2i(p.loc('tile'), x, y);
        });
      }
    gl.disable(gl.SCISSOR_TEST);
    destroyTarget(gl, copy);
  }

  /** Resolves when the GPU has finished all work issued so far (a fence, polled without blocking). */
  async finish(): Promise<void> {
    await fence(this.gl);
  }

  /**
   * Alive agents per strain. The GPU sums them into a 128² target, which is read back asynchronously
   * and summed on the CPU, so the main thread never waits for the GPU. Exact up to 2^24 agents with
   * 32- or 16-bit float blending (points.vert kind 3).
   */
  async alive(): Promise<number[]> {
    const gl = this.gl;
    const strains = this.settings.strains.length;
    this.writeParams();
    clear(gl, this.tally);
    this.points(3, this.tally, gl.FUNC_ADD);
    const px = await readTargetAsync(gl, this.tally);
    const sums = [0, 0, 0, 0];
    for (let i = 0; i < px.length; i += 4) for (let s = 0; s < 4; s++) sums[s] = (sums[s] ?? 0) + (px[i + s] ?? 0);
    return sums.slice(0, strains).map(Math.round);
  }

  readAgents(): Promise<AgentState[]> {
    const data = readTarget(this.gl, this.agentsTex[this.a]);
    return Promise.resolve(
      Array.from({ length: this.agents }, (_, i) => ({
        x: data[i * 4] ?? 0,
        y: data[i * 4 + 1] ?? 0,
        heading: data[i * 4 + 2] ?? 0,
        bits: Math.round(data[i * 4 + 3] ?? 0) & 7, // strain and alive; GL-only markers dropped
      })),
    );
  }

  readTrail(): Promise<Float32Array> {
    return Promise.resolve(readTarget(this.gl, this.currentTrail) as Float32Array);
  }

  readScent(): Promise<Float32Array> {
    // readTarget() reads 4 channels per cell; the scent target holds 2.
    const rgba = readTarget(this.gl, this.scent[this.p]);
    return Promise.resolve(
      Float32Array.from({ length: (rgba.length / 4) * 2 }, (_, i) => rgba[(i >> 1) * 4 + (i & 1)] ?? 0),
    );
  }

  readCounts(): Promise<Float32Array> {
    return Promise.resolve(readTarget(this.gl, this.counts) as Float32Array);
  }

  readWindows(): Promise<Uint32Array> {
    if (!this.growth) return Promise.resolve(new Uint32Array(0));
    const rgba = readTarget(this.gl, this.growth.windows);
    const cells = this.width * this.height;
    return Promise.resolve(Uint32Array.from({ length: cells * 2 }, (_, i) => rgba[(i >> 1) * 4 + (i & 1)] ?? 0));
  }

  readEnv(): Promise<Uint8Array> {
    return Promise.resolve(readTarget(this.gl, this.env) as Uint8Array);
  }

  readShape(): Promise<Uint8Array> {
    this.syncShape();
    return Promise.resolve(readTarget(this.gl, this.shape) as Uint8Array);
  }

  /** Agent `index` is its texel: WebGL2 never reorders agents, so the slot is the id (ADR 0005). */
  writeAgent(index: number, a: AgentState) {
    if (!Number.isInteger(index) || index < 0 || index >= this.agents) throw new RangeError(`No agent ${index}.`);
    const x = index % this.agentWidth;
    const y = Math.floor(index / this.agentWidth);
    writeTarget(this.gl, this.agentsTex[this.a], x, y, 1, 1, new Float32Array([a.x, a.y, a.heading, a.bits & 7]));
  }

  writeScent(data: Float32Array) {
    this.changed();
    this.revision++;
    this.scentless = false;
    writeTarget(this.gl, this.currentScent, 0, 0, this.width, this.height, data);
  }

  writeTrail(data: Float32Array) {
    this.changed();
    this.revision++;
    writeTarget(this.gl, this.currentTrail, 0, 0, this.width, this.height, data);
  }

  /**
   * For tests. The outline target cannot know the distances of an environment written as bytes: it is cleared, and
   * its next use holds it to `env` (syncShape()), so the sign of every outline byte, the light and the shadow follow
   * `env`.
   */
  writeEnv(data: Uint8Array) {
    this.changed();
    this.revision++;
    writeTarget(this.gl, this.env, 0, 0, this.width, this.height, data);
    clear(this.gl, this.shape);
    const any = (channel: number) => data.some((v, i) => i % 4 === channel && v > 0);
    this.walls = any(0);
    [0, 1, 2].forEach((c) => (this.layers[c] = any(c)));
    this.hasEnvironment = this.layers.some(Boolean);
    this.sources = any(1) || any(2);
    if (this.sources) this.scentless = false;
    this.shapeHeld = undefined;
    if (this.walls) {
      this.writeParams(); // binds this simulation's parameters for the passes
      this.updateClearance();
    }
  }

  destroy() {
    const gl = this.gl;
    const all = [...this.agentsTex, ...this.trail, ...this.scent, this.counts, this.env, this.shape, this.tally];
    all.push(this.noScent, ...this.order, ...this.orderLevels);
    all.push(this.walled, this.clearance);
    if (this.panels) all.push(this.panels);
    if (this.presence) all.push(this.presence);
    if (this.collision) all.push(...this.collision.occ, this.collision.claims);
    all.push(...this.growthTargets());
    for (const t of all) destroyTarget(gl, t);
    for (const f of this.mrt) gl.deleteFramebuffer(f);
    this.dropViewThird();
    this.dropFlow();
    this.dropTubes();
    gl.deleteBuffer(this.ubo);
  }

  /**
   * Draws the outlines of a run of segments that paint() has applied to `env` (shape.frag), kind by kind
   * (OUTLINE_DRAWS): in a run, segments of different kinds have boxes that do not meet (PendingOutlines), so their
   * draws touch other cells. Scissors cut every draw to the grid in a closed arena and split it where it crosses the
   * edge of the periodic grid. The Params block holds the run's boundary.
   */
  private drawOutlines(run: readonly { segment: Stroke; kind: EnvTool; rects: readonly Rect[] }[]) {
    const gl = this.gl;
    const sp = this.prog.shape;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shape.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(sp.program);
    // `old` (op 3) is never read here, but its unit must not hold the target: a frame binds it there.
    textures(gl, sp.program, { env: this.env.texture, old: this.env.texture });
    gl.enable(gl.SCISSOR_TEST);
    const [walls, food, light] = this.layers;
    const draw = ([op, all, equation]: OutlineDraw, rects: readonly Rect[], hold = false, core = false) => {
      // Only the layers that hold anything: a subtraction of food or walls, the light and the shadow.
      const mask: [boolean, boolean, boolean, boolean] =
        op === 1 || op === 4
          ? [all[0] && !!walls, all[1] && !!food, false, false]
          : [all[0], all[1], all[2] && !!light, all[3] && !!walls];
      if (!mask.some(Boolean)) return;
      gl.colorMask(...mask);
      if (equation) this.blend(gl[equation]);
      else gl.disable(gl.BLEND);
      gl.uniform1i(sp.loc('op'), op);
      gl.uniform1i(sp.loc('hold'), Number(hold));
      gl.uniform1i(sp.loc('core'), Number(core));
      gl.uniform2i(sp.loc('layers'), Number(mask[0]), Number(mask[1]));
      for (const r of rects) {
        gl.scissor(...r);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
    const byKind: Partial<Record<EnvTool, (typeof run)[number][]>> = {};
    for (const item of run) (byKind[item.kind] ??= []).push(item);
    for (const [kind, items] of Object.entries(byKind) as [EnvTool, (typeof run)[number][]][]) {
      const { segment, hold, run: after } = OUTLINE_DRAWS[kind];
      // The rectangles of one segment do not overlap (outlineRects): they are their own union.
      const union = () => (items.length === 1 ? (items[0]?.rects ?? []) : unionRects(items.flatMap((i) => i.rects)));
      const cells = hold || after.length > 0 ? union() : [];
      // The hold once per cell of the union, or with each segment's subtraction, without the cells it set to 0,
      // whichever searches fewer cells: a drag's boxes overlap, a single large eraser is mostly such cells. Then an
      // eraser's light and shadow per segment too, where its deep cells cost nothing.
      const each = !!hold && items.reduce((sum, i) => sum + area(i.rects) - core(i.segment), 0) < area(cells);
      const late = each && kind === 'erase';
      for (const { segment: s, rects } of items) {
        gl.uniform2f(sp.loc('from'), ...s.from);
        gl.uniform2f(sp.loc('to'), ...s.to);
        gl.uniform1f(sp.loc('radius'), s.radius);
        for (const d of segment) draw(d, rects, each && d[0] === 1);
        if (late) for (const d of after) draw(d, rects, false, true);
      }
      if (hold && !each) draw(hold, cells);
      if (!late) for (const d of after) draw(d, cells);
    }
  }

  /** `boundary` replaces the current one for a brush stroke (Stroke.boundary); the next step writes it back. */
  private writeParams(tool?: AgentTool, round = 0, boundary = this.settings.boundary) {
    const gl = this.gl;
    const s = boundary === this.settings.boundary ? this.settings : { ...this.settings, boundary };
    const rt = {
      width: this.width,
      height: this.height,
      agents: this.agents,
      step: this.step,
      tool,
      walls: this.walls,
      round,
      start: this.start,
    };
    gl.bindBufferBase(gl.UNIFORM_BUFFER, PARAMS_BINDING, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Uint8Array(packParams(s, rt, this.paramData)));
  }

  /**
   * The agent pass for the walls and the trail saturation of the current settings. Only the extended model's sensors
   * check for walls on the way (SENSE_WALLS, ADR 0020 and 0022).
   */
  private agentProgram(): Program {
    const senseWalls = this.walls && this.settings.model === 'extended';
    // With the flow in the tubes, the pass in which agents starve and come to life by the flow memory (ADR 0029).
    if (flowOn(this.settings)) return this.prog.flowing(senseWalls, trailSaturation(this.settings) > 0);
    if (trailSaturation(this.settings) > 0) {
      const p = this.prog.saturated();
      return senseWalls ? p.walled : p.agents;
    }
    return senseWalls ? this.prog.walled().agents : this.prog.agents;
  }

  /**
   * The agents per cell after this step's moves, for covered food (diffuse.frag COVERED): collision mode counts them
   * anyway. Without it they are counted here, into the collision target that is not current (additive, which needs
   * float blending), or else into `presence` (1 per cell with an agent, in 8 bits).
   */
  private occupancyAfterMoves(): WebGLTexture {
    const gl = this.gl;
    if (this.settings.collisions) return this.ensureCollision().occ[this.q].texture;
    if (this.floatBlend && this.collision) {
      const next = this.collision.occ[flip(this.q)];
      clear(gl, next);
      this.points(2, next, gl.FUNC_ADD);
      this.q = flip(this.q);
      return next.texture;
    }
    this.presence ??= target(gl, this.width, this.height, gl.R8);
    clear(gl, this.presence);
    this.points(2, this.presence, gl.FUNC_ADD);
    return this.presence.texture;
  }

  private encodeStep() {
    const gl = this.gl;
    const dummy = this.counts.texture; // for the unused samplers of the agent passes, which never draw into it
    const agentProgram = this.agentProgram();
    // The flow in the tubes (ADR 0029): the agent passes read the memory of the step before, each agent that of its
    // strain (ADR 0031). They read only the constants of the uniform block, which every strain has: the block of the
    // first strain. Growth, later in the step, reads the same block.
    const flow = flowOn(this.settings) ? this.ensureFlow() : undefined;
    if (flow) this.flowBlock(flow, 0);
    const flowMemory: Record<string, WebGLTexture> = flow ? this.flowMemories(flow) : {};
    const agentPass = (mode: number, src: Target, dst: Target, occ: WebGLTexture, claims: WebGLTexture) => {
      this.pass(
        agentProgram,
        dst,
        {
          agentsIn: src.texture,
          trail: this.trail[this.p].texture,
          scent: (this.scentless ? this.noScent : this.scent[this.p]).texture,
          env: this.env.texture,
          occ,
          claims,
          clearance: this.clearance.texture,
          ...flowMemory,
        },
        { agentWidth: this.agentWidth, mode },
      );
    };
    const col = this.settings.collisions ? this.ensureCollision() : undefined;
    if (!col) {
      agentPass(0, this.agentsTex[this.a], this.agentsTex[flip(this.a)], dummy, dummy);
      this.a = flip(this.a);
    } else {
      const [A, B] = [this.agentsTex[this.a], this.agentsTex[flip(this.a)]];
      const occ = col.occ[this.q];
      agentPass(1, A, B, occ.texture, dummy);
      clear(gl, col.claims);
      // A tool's spot needs the occupancy (tools.glsl placement), and a spot of the flow its memory.
      const claimPoints = flow ? this.prog.flow().points : this.prog.points;
      this.points(1, col.claims, gl.MAX, B, [0, 0, 0, 0], { occ: occ.texture, ...flowMemory }, claimPoints);
      agentPass(2, B, A, occ.texture, col.claims.texture);
      const next = col.occ[flip(this.q)];
      clear(gl, next);
      this.points(2, next, gl.FUNC_ADD);
      this.q = flip(this.q);
    }
    this.deposit();
    // Growth and shrinkage after the deposits, so an agent that shrinkage deletes keeps the trail of its move, as on
    // WebGPU (ADR 0025). Only with the rule, on the steps that test them.
    const tests = growthTests(this.settings, this.step);
    if (col && (tests.grow || tests.shrink)) this.encodeGrowth(tests.grow);
    const covered = this.settings.coveredFood;
    // The unused sampler `occ` gets a texture that is no target of the diffusion pass.
    const occ = covered ? this.occupancyAfterMoves() : this.env.texture;
    const senseFirst = this.settings.stepOrder === 'sense-first';
    for (const v of diffusePlan(this.settings.diffusion)) {
      const out = flip(this.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mrt[out]);
      gl.viewport(0, 0, this.width, this.height);
      // The pass that adds the step's sources (diffuse.frag): the last moving first, the first sensing first (ADR 0027);
      // with covered food while it is on.
      const d = covered && (senseFirst ? v.first : v.last) ? this.prog.covered() : this.prog.diffuse;
      gl.useProgram(d.program);
      textures(gl, d.program, {
        trailIn: this.trail[this.p].texture,
        scentIn: (this.scentless ? this.noScent : this.scent[this.p]).texture,
        counts: this.counts.texture,
        env: this.env.texture,
        occ,
      });
      gl.uniform1i(d.loc('first'), Number(v.first));
      gl.uniform1i(d.loc('last'), Number(v.last));
      gl.uniform1i(d.loc('blur'), Number(v.blur));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.p = out;
    }
    if (flow) this.encodeFlow(flow);
  }

  /**
   * The flow in the tubes after the diffusion of a step (flow.frag; encodeFlow in ../sim.ts, ADR 0029): the update of
   * the memory from the pressure and the trail of this step, then the pressure iterations on the new conductivity.
   * Once per strain, each with its own targets and its own block (ADR 0031).
   */
  private encodeFlow(flow: NonNullable<GlSim['flow']>) {
    const programs = this.prog.flow();
    const env = this.env.texture;
    const [m, next] = [this.flowM, flip(this.flowM)];
    let p = this.flowP;
    flow.memory.forEach((memories, strain) => {
      const pressure = at(flow.pressure, strain);
      this.flowBlock(flow, strain);
      p = this.flowP;
      this.pass(
        programs.update,
        memories[next],
        {
          env,
          memory: memories[m].texture,
          pressureIn: at(pressure, p).texture,
          trail: this.trail[this.p].texture,
        },
        {},
      );
      const memory = memories[next].texture;
      for (let i = 0; i < FLOW_ITERATIONS; i++) {
        const [before, out] = [(p + 2) % 3, (p + 1) % 3];
        this.pass(
          programs.pressure,
          at(pressure, out),
          { env, memory, pressureIn: at(pressure, p).texture, pressureBefore: at(pressure, before).texture },
          // The first two iterations take the pressure of the reference cell off (RECENTRE in flow.wgsl).
          { recentre: i < 2 ? i + 1 : 0 },
        );
        p = out;
      }
    });
    this.flowM = next;
    this.flowP = p;
  }

  /**
   * Growth and shrinkage after the moves of a test step (growth.frag, growth.vert; growth.wgsl in sim.ts, ADR 0025).
   * The current occupancy is the one after the moves: it gives the window counts and the empty cells. The agents
   * pass through the tests, and on a growth step through the claims, the pyramids and the births. Then the occupancy
   * is counted anew for the next step.
   */
  private encodeGrowth(grow: boolean) {
    const gl = this.gl;
    const g = this.ensureGrowth();
    const p = this.prog.growth();
    const col = this.ensureCollision();
    const occ = col.occ[this.q].texture;
    const agentWidth = this.agentWidth;
    this.pass(p.rows, g.rows, { sums: occ }, {});
    this.pass(p.windows, g.windows, { sums: g.rows.texture }, {});
    const tested = this.agentsTex[flip(this.a)];
    const env = this.env.texture;
    const windows = g.windows.texture;
    // With the flow in the tubes, the test in which an agent on a starved cell does not divide (FLOW in growth.frag,
    // ADR 0029): it reads the flow memory that the agent pass of the step read.
    const flow = flowOn(this.settings) ? this.flow : undefined;
    const flowMemory: Record<string, WebGLTexture> = flow ? this.flowMemories(flow) : {};
    this.pass(
      flow ? this.prog.growthFlowing() : p.test,
      tested,
      { agentsIn: this.agentsTex[this.a].texture, windows, occ, env, ...flowMemory },
      { agentWidth },
    );
    this.a = flip(this.a);
    if (grow) {
      const agents = this.agentsTex[this.a];
      const points = (kind: number, dst: Target, equation: number | null, claims: WebGLTexture) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(0, 0, dst.width, dst.height);
        gl.useProgram(p.points.program);
        textures(gl, p.points.program, { agents: agents.texture, claims });
        gl.uniform1i(p.points.loc('agentWidth'), agentWidth);
        gl.uniform1i(p.points.loc('kind'), kind);
        if (equation === null) gl.disable(gl.BLEND);
        else this.blend(equation);
        gl.drawArrays(gl.POINTS, 0, this.agents);
        gl.disable(gl.BLEND);
      };
      clear(gl, g.claims);
      points(0, g.claims, gl.MAX, env);
      clear(gl, g.births);
      points(1, g.births, null, g.claims.texture);
      this.buildPyramid(p.build, g.cells, g.births, 0);
      this.buildPyramid(p.build, g.dead, agents, 1);
      const [c, d] = [g.cells, g.dead];
      this.pass(
        p.birth,
        this.agentsTex[flip(this.a)],
        {
          agentsIn: agents.texture,
          births: g.births.texture,
          cells0: c.textures[0].texture,
          cells1: c.textures[1].texture,
          dead0: d.textures[0].texture,
          dead1: d.textures[1].texture,
        },
        { agentWidth, cellTop: c.top, deadTop: d.top },
        (prog) => {
          gl.uniform1iv(prog.loc('cellRow'), padded(c.rows));
          gl.uniform1iv(prog.loc('cellSize'), padded(c.sizes));
          gl.uniform1iv(prog.loc('deadRow'), padded(d.rows));
          gl.uniform1iv(prog.loc('deadSize'), padded(d.sizes));
        },
      );
      this.a = flip(this.a);
    }
    const next = col.occ[flip(this.q)];
    clear(gl, next);
    this.points(2, next, gl.FUNC_ADD);
    this.q = flip(this.q);
  }

  /** Builds every level of a pyramid (growth.frag PASS 3) over `base`: the births (kind 0) or the agents (kind 1). */
  private buildPyramid(program: Program, py: Pyramid, base: Target, kind: number) {
    const gl = this.gl;
    for (let k = 1; k <= py.top; k++) {
      const dst = py.textures[k % 2 === 1 ? 1 : 0];
      const below = k === 1 ? base : py.textures[(k - 1) % 2 === 1 ? 1 : 0];
      const rows = Math.ceil((py.sizes[k] ?? 1) / py.width);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, py.rows[k] ?? 0, py.width, rows);
      gl.useProgram(program.program);
      textures(gl, program.program, { below: below.texture });
      const ints: Record<string, number> = {
        kind,
        first: k === 1 ? 1 : 0,
        row: py.rows[k] ?? 0,
        width: py.width,
        size: py.sizes[k] ?? 0,
        belowRow: k === 1 ? 0 : (py.rows[k - 1] ?? 0),
        belowWidth: k === 1 ? base.width : py.width,
        belowSize: py.sizes[k - 1] ?? 0,
      };
      for (const [name, v] of Object.entries(ints)) gl.uniform1i(program.loc(name), v);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  /** The targets of growth and shrinkage, at their first use while growth is on (ADR 0025). */
  private ensureGrowth(): GlGrowth {
    if (!this.growth) {
      const gl = this.gl;
      const pyramid = (n: number, width: number, format: number): Pyramid => {
        const { sizes, rows, heights, top } = pyramidLayout(n, width);
        const textures: Pair<Target> = [
          target(gl, width, Math.max(1, heights[0] ?? 0), format),
          target(gl, width, Math.max(1, heights[1] ?? 0), format),
        ];
        return { textures, width, sizes, rows, top };
      };
      const [w, h] = [this.width, this.height];
      this.growth = {
        rows: target(gl, w, h, gl.RG32F),
        windows: target(gl, w, h, gl.RG32F),
        claims: target(gl, w, h, gl.R32F),
        births: target(gl, w, h, gl.RG32F),
        cells: pyramid(w * h, w, gl.RGBA32F),
        dead: pyramid(this.agents, this.agentWidth, gl.R32F),
      };
    }
    return this.growth;
  }

  private growthTargets(): Target[] {
    const g = this.growth;
    return g ? [g.rows, g.windows, g.claims, g.births, ...g.cells.textures, ...g.dead.textures] : [];
  }

  /**
   * Agents that moved into each cell this step, per strain, into `counts`. With float blending, one
   * additive point per agent. Half floats count exactly only to 2048, and condensed networks gather
   * thousands of agents in a cell, so without float blending each (cell, strain) gets its own pixel in
   * a 2 × 2 panel layout, with an 8-bit stencil. One point pass: every agent increments the stencil
   * (mod 256), and the agent that finds it at 255 adds a carry (red). Then eight full-screen passes,
   * one per stencil bit, add 2^b to green where bit b is set, which copies the remainder into green.
   * The merge pass writes 256 · carry + remainder: exact up to 2048 · 256 = 524 288 agents per cell
   * and strain.
   */
  private deposit() {
    const gl = this.gl;
    const t = this.panels;
    if (!t) {
      clear(gl, this.counts);
      this.points(0, this.counts, gl.FUNC_ADD);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.width, t.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.stencilMask(0xff);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.EQUAL, 255, 0xff);
    gl.stencilOp(gl.INCR_WRAP, gl.INCR_WRAP, gl.INCR_WRAP);
    this.points(4, t, gl.FUNC_ADD, this.agentsTex[this.a], [1, 0, 0, 0]);
    const fill = this.prog.fill;
    gl.useProgram(fill.program);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    this.blend(gl.FUNC_ADD);
    for (let b = 0; b < 8; b++) {
      gl.stencilFunc(gl.EQUAL, 0xff, 1 << b);
      gl.uniform4f(fill.loc('value'), 0, 2 ** b, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    this.pass(this.prog.counts, this.counts, { panels: t.texture }, {});
  }

  /** One point per agent into a per-cell target (see points.vert), combined by `equation` blending. */
  private points(
    kind: number,
    dst: Target,
    equation: number,
    agents = this.agentsTex[this.a],
    unit: [number, number, number, number] = [0, 0, 0, 0],
    more: Record<string, WebGLTexture> = {},
    p = this.prog.points,
  ) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    gl.useProgram(p.program);
    // Kinds 1 and 5 read env and occ. Both are bound always: an active sampler on the target is a feedback loop.
    const order = this.order[this.o].texture;
    textures(gl, p.program, { agents: agents.texture, order, env: this.env.texture, occ: this.env.texture, ...more });
    gl.uniform1i(p.loc('agentWidth'), this.agentWidth);
    gl.uniform1i(p.loc('kind'), kind);
    gl.uniform1i(p.loc('tallySide'), TALLY_SIDE);
    gl.uniform4f(p.loc('unit'), ...unit);
    this.blend(equation);
    // Every slot: the slots past the last agent hold the indices past it, which the points drop.
    gl.drawArrays(gl.POINTS, 0, this.slots);
    gl.disable(gl.BLEND);
  }

  private blend(equation: number) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendEquation(equation);
    gl.blendFunc(gl.ONE, gl.ONE);
  }

  /** Full-screen fragment pass into `dst` with textures and integer uniforms. */
  private pass(
    p: Program,
    dst: Target,
    tex: Record<string, WebGLTexture>,
    ints: Record<string, number>,
    extra?: (p: Program) => void,
  ) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    gl.useProgram(p.program);
    textures(gl, p.program, tex);
    for (const [name, v] of Object.entries(ints)) gl.uniform1i(p.loc(name), v);
    extra?.(p);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private ensureCollision() {
    if (!this.collision) {
      const gl = this.gl;
      const t = () => target(gl, this.width, this.height, gl.R32F);
      this.collision = { occ: [t(), t()], claims: t() };
    }
    return this.collision;
  }

  private rebuildOccupancy() {
    const col = this.ensureCollision();
    this.writeParams();
    const next = col.occ[flip(this.q)];
    clear(this.gl, next);
    this.points(2, next, this.gl.FUNC_ADD);
    this.q = flip(this.q);
  }
}
