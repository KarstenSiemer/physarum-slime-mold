import { BOUNDARIES, type Boundary, type Settings } from '../../model/params';
import { at } from '../at';
import { outlineRects, paintSegments, PendingOutlines, scissorRects, unionRects, type Rect } from '../brush';
import { FLOW, FLOW_BYTES, FLOW_ITERATIONS, FLOW_SITES, flowEight, flowOn, flowStrains, packFlow } from '../flow';
import { NO_CELL, NO_SITES, SITE_BLOCK, type FlowSites } from '../sites';
import { slimeModel, slimeSteps } from '../slime';
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
import { PAID_COUNT_LANES, PAID_COUNTS } from '../paid';
import { SINK_STATE_LANES, SINK_SUM_WORDS } from '../sinks';
import { diffusePlanOf, sinkLevels, viewTrailOn } from '../sizing';
import { packTerritory, territoryOn } from '../territory';
import { grainsShown, TUBE_TILE, tubesShown } from '../tubes';
import {
  changesSlime,
  EnvKind,
  isPole,
  paintsEnv,
  polesOutlined,
  releases,
  SHAPE_RANGE,
  type AgentState,
  type EnvTool,
  type Sim,
  type Stroke,
} from '../types';
import {
  allOrNothing,
  clear,
  clearUint,
  destroyTarget,
  fence,
  readTarget,
  readTargetAsync,
  readUint4Target,
  readUintTarget,
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
/**
 * Channels a brush writes: erase and walls all, food only green, light only blue (the maximum of old and new), an
 * electrode only alpha (ADR 0047).
 */
const MASKS: Record<number, [boolean, boolean, boolean, boolean]> = {
  [EnvKind.erase]: [true, true, true, true],
  [EnvKind.wall]: [true, true, true, true],
  [EnvKind.food]: [false, true, false, false],
  [EnvKind.light]: [false, false, true, false],
  [EnvKind.anode]: [false, false, false, true],
  [EnvKind.cathode]: [false, false, false, true],
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

/**
 * The sinks of each strain (ADR 0069; sinks.frag; `sinks` in ../sim.ts), while the rules of stage 4 run: per strain the
 * sink rates in two targets (R32F) that PASS 0 writes in turn, and the levels of the pyramid of its sums (RGBA32UI,
 * sizing.ts sinkLevels()), whose top of one texel holds them; the state of every strain in two targets (RGBA32F, 2
 * texels per strain) that PASS 3 writes in turn. The births that the flux pays (ADR 0071; ADR 0067, decision 7): the
 * key of every agent (R32F, a texel per agent slot), which the test of growth writes as a second target, and the
 * counts of a step (RGBA32F, PAID_COUNT_LANES × 1 texels, a lane per strain; paid.ts PAID_COUNTS), which paid.vert adds
 * (ADR 0100).
 */
interface GlSinks {
  /** The strains of the settings that the targets were made for. */
  strains: number;
  rates: Pair<Target>[];
  levels: Target[][];
  state: Pair<Target>;
  keys: Target;
  counts: Target;
  /**
   * What the sensors read of the flow of each strain (ADR 0075), lane s for strain s, which PASS 5 of flow.frag writes
   * at the start of a step: the mean pressure of the four lanes, and what the sink of each cell takes over the
   * conductivity of the cell.
   */
  pressures: Target;
  takes: Target;
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

/**
 * The targets of the sinks for `strains` strains on a grid of `width` × `height` cells (GlSinks), made by `make`. Each
 * strain has two targets of rates, the levels of its pyramid, and the state two targets of 2 texels per strain. The
 * keys have a texel per agent slot, in rows of `agentWidth`. The mean pressures and take / G have a lane per strain
 * (ADR 0075).
 */
function makeSinks(
  make: (width: number, height: number, format: number) => Target,
  width: number,
  height: number,
  strains: number,
  agentWidth: number,
  agentHeight: number,
): GlSinks {
  const gl = WebGL2RenderingContext;
  const each = <T>(of: () => T) => Array.from({ length: strains }, of);
  return {
    strains,
    rates: each((): Pair<Target> => [make(width, height, gl.R32F), make(width, height, gl.R32F)]),
    levels: each(() => sinkLevels(width, height).map(([w, h]) => make(w, h, gl.RGBA32UI))),
    state: [make(2, strains, gl.RGBA32F), make(2, strains, gl.RGBA32F)],
    keys: make(agentWidth, agentHeight, gl.R32F),
    counts: make(PAID_COUNT_LANES, 1, gl.RGBA32F),
    pressures: make(width, height, gl.RGBA32F),
    takes: make(width, height, gl.RGBA32F),
  };
}

/** Cells of some rectangles. */
const area = (rects: readonly Rect[]) => rects.reduce((sum, [, , w, h]) => sum + w * h, 0);

/**
 * The marks of the agent bits that paid.vert counts (ADR 0071, ADR 0100), as common.glsl and growth.glsl define them,
 * each with the count of paid.ts PAID_COUNTS that it adds to.
 */
const MARKS = {
  front: [1024, PAID_COUNTS.front],
  paid: [2048, PAID_COUNTS.claims],
  waits: [4096, PAID_COUNTS.waiting],
  died: [8192, PAID_COUNTS.died],
  reborn: [16384, PAID_COUNTS.reborn],
  jones: [32768, PAID_COUNTS.parents],
  crowded: [65536, PAID_COUNTS.crowded],
  born: [131072, PAID_COUNTS.born],
} as const;

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

/** The channels of the first layer of an outline target, of the second, and of both. */
type Channels = [boolean, boolean, boolean, boolean];
const FIRST: Channels = [true, false, false, false];
const SECOND: Channels = [false, true, false, false];
const BOTH: Channels = [true, true, false, false];
/**
 * A draw of shape.frag: its `op`, the channels it writes (R wall, G food, B light, A shadow), its blend equation, and
 * for a subtraction how it is rounded off (`cut` in shape.frag): as the union of a pole (1) or of a wall (2).
 */
type OutlineDraw = [op: number, channels: Channels, blend: 'MAX' | 'MIN' | null, cut?: 0 | 1 | 2];
/** The draws of the segments of a kind: per segment, the hold of the subtracted layers, and once per cell of a run. */
type OutlineDraws = Record<EnvTool, { segment: OutlineDraw[]; hold?: OutlineDraw; run: OutlineDraw[] }>;
/**
 * How shape.frag applies a run's segments of a kind to the outline target: per segment over its outline box the
 * union (op 0, MAX blending) or the subtraction (op 1, MIN blending); then, once per cell of the union of the
 * segments' boxes, the hold of the subtracted layers (op 4, MIN blending) and the light and the shadow (op 2). The
 * hold, the light and the shadow depend only on `env` after the run, so overlapping boxes need them once.
 */
const OUTLINE_DRAWS: OutlineDraws = {
  erase: { segment: [[1, BOTH, 'MIN']], hold: [4, BOTH, 'MIN'], run: [[2, [false, false, true, true], null]] },
  wall: {
    segment: [
      [0, FIRST, 'MAX'],
      [1, SECOND, 'MIN'],
    ],
    hold: [4, SECOND, 'MIN'],
    run: [[2, [false, false, true, true], null]],
  },
  food: { segment: [[0, SECOND, 'MAX']], run: [] },
  light: { segment: [], run: [[2, [false, false, true, false], null]] },
  // An electrode changes no byte of the outline target: its outline lies in `poles` (POLE_DRAWS).
  anode: { segment: [], run: [] },
  cathode: { segment: [], run: [] },
  // A stroke of the Slime tool joins no run: it changes only the slime field (brushSlime()).
  slime: { segment: [], run: [] },
  // A start spot paints nothing (ADR 0066): paint() takes no such stroke (paintsEnv()).
  start: { segment: [], run: [] },
};
/**
 * The same for the target of the outlines of the electrodes (POLES in shape.frag): R the cathodes, G the anodes. A
 * cell holds one pole, the one painted last. So a cathode is a union in R and a subtraction in G, as a wall is for
 * walls and food, and an anode is the mirror. An erase and a wall clear both poles of their cells. Food, light and
 * slime leave the poles. A pole and a wall fill the cells that they take: their subtraction is rounded off as their
 * union is, so the pole below ends where the stroke begins (ADR 0058). An erase takes the plain distance.
 */
const POLE_DRAWS: OutlineDraws = {
  erase: { segment: [[1, BOTH, 'MIN']], hold: [4, BOTH, 'MIN'], run: [] },
  wall: { segment: [[1, BOTH, 'MIN', 2]], hold: [4, BOTH, 'MIN'], run: [] },
  food: { segment: [], run: [] },
  light: { segment: [], run: [] },
  anode: {
    segment: [
      [0, SECOND, 'MAX'],
      [1, FIRST, 'MIN', 1],
    ],
    hold: [4, FIRST, 'MIN'],
    run: [],
  },
  cathode: {
    segment: [
      [0, FIRST, 'MAX'],
      [1, SECOND, 'MIN', 1],
    ],
    hold: [4, SECOND, 'MIN'],
    run: [],
  },
  slime: { segment: [], run: [] },
  start: { segment: [], run: [] },
};
/** A segment of a run of paint(): its kind, its outline rectangles, and whether `poles` takes its outline too. */
interface RunItem {
  segment: Stroke;
  kind: EnvTool;
  rects: readonly Rect[];
  poles: boolean;
}

/** The simulation with WebGL2 fragment passes (ADR 0003); same model and parameters as sim.ts. */
export class GlSim implements Sim {
  step = 0;
  /** True from destroy() on: the textures and the targets are gone, and nothing may ask for them. */
  destroyed = false;
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
  /** An electrode was painted, or bytes written held one, since the last clear (ADR 0047). */
  hasElectrodes = false;
  /**
   * The outline distances of the electrodes, for the renderer only (shape.frag with POLES; `poles` in ../sim.ts;
   * ADR 0058): R the distance to the outline of the cathodes, G the one to the outline of the anodes, as `shape` holds
   * those of walls and food. Held while `hasElectrodes` says that a pole may lie in `env`: made at the first pole, and
   * freed by a clear. The fit of the grid counts it from the start (sizing.ts BYTES_PER_CELL).
   */
  private poles: Target | undefined;
  /**
   * Whether a cathode and an anode were painted since the last clear: without them their bytes are all 0, and a
   * subtraction from them draws nothing (`layers`).
   */
  private readonly poleLayers = [false, false];
  /**
   * The boundary under which every byte of the outline target and of `poles` is held to `env`. After a change of
   * boundary, or after strokes painted under another boundary (then undefined), syncShape() holds them again before
   * their next use.
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
   * memory of each cell in two targets and the pressure of the four lanes in three (ADR 0031), the uniform block of
   * the passes, which holds the block of one strain at a time, and the ports of the sites (decision 17): two targets
   * of FLOW_SITES × strains texels that the passes of the ports write in turn, `port` the one of the last step, and the
   * target of the lanes of PASS 3. The cells of the sites and the hits of their blocks are targets of their own, made
   * again when the list outgrows them (siteCells()).
   */
  private flow?:
    | {
        memory: Pair<Target>[];
        pressure: Target[][];
        ubo: WebGLBuffer;
        ports: Pair<Target>;
        port: Bit;
        lanes: Target;
        cells: Target | undefined;
        hits: Target | undefined;
        cellsCurrent: boolean;
      }
    | undefined;
  /** Which memory target is current, and which pressure target holds the pressure in work. */
  private flowM: Bit = 0;
  private flowP = 0;
  /** The food sites that give and take the flux, with their cells (foodSites()). */
  private sites: FlowSites = NO_SITES;
  private readonly flowData = new ArrayBuffer(FLOW_BYTES);
  /**
   * The slime field (slime.frag, ADR 0055; `slime` in ../sim.ts): the stamp of every cell in a target of unsigned
   * integers, 4 B per cell. Held while the model of the settings has slime (slimeModel()); the fit of the grid counts
   * it then (sizing.ts slimeBytesPerCell()).
   */
  private slime: Target | undefined;
  /**
   * The amount of slime of every cell (ADR 0057; PASS 1 of slime.frag), in two targets of unsigned integers (R16UI),
   * 2 B per cell each: the pass of a step reads one and writes the other, and `am` names the one that holds the
   * amounts. Made and freed with the stamps (ensureSlime(), dropSlime()), and counted with them.
   */
  private amount: [Target, Target] | undefined;
  /**
   * The front field (ADR 0060; PASS 2 of slime.frag; `front` in ../sim.ts): the step, plus 1, at which the growth
   * front reached each cell, in a target of unsigned integers, 4 B per cell. Made and freed with the stamps.
   */
  private front: Target | undefined;
  private am: Bit = 0;
  /**
   * The territory of each strain and the owners (ADR 0068; territory.frag; `territory` in ../sim.ts), while the rules
   * of stage 4 run: two targets of unsigned integers (R8UI), one byte per cell, that the push writes in turn, `tt` the
   * one that holds the territory now, and the owners in a third.
   */
  private territory: { copies: Pair<Target>; owners: Target } | undefined;
  private tt: Bit = 0;
  /** The sinks of each strain (GlSinks); `sr` names the current copy of the rates, `st` that of the state. */
  private sinks: GlSinks | undefined;
  /** The framebuffers of the test of growth with the keys of the paid births, by the texture of the agents (withKeys()). */
  private readonly keyFbos = new Map<WebGLTexture, WebGLFramebuffer>();
  /** The framebuffer of PASS 5 of flow.frag, with the targets `pressures` and `takes` of the sinks (driftTarget()). */
  private driftFbo: WebGLFramebuffer | undefined;
  private sr: Bit = 0;
  private st: Bit = 0;
  /**
   * A cell of the slime field may hold a stamp: the pass of the stamps ran, or the Slime tool painted, since the field
   * was last empty (`stamped` in ../sim.ts). Only then does an erase or a wall clear stamps (brushSlime()).
   */
  private stamped = false;
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
   * strain the factor of the radius of its tube, and the trail that the view draws; per tile of the picture (tubes.ts
   * TUBE_TILE) what its window holds, and that per tile column and row of cells on the way. `tubesStale`: a change of
   * the state since made the picture stale.
   */
  private tubes: { roots: Target; picture: Target; rows: Target; tiles: Target } | undefined;
  private tubesStale = true;
  /**
   * The target of the stream of the plasm (tubes.frag PASS 2), allocated while the view draws the grains (tubes.ts
   * grainsShown(), ADR 0095), with the picture of the tubes or without it. `streamStale`: a change of the state since
   * made it stale.
   */
  private stream: Target | undefined;
  private streamStale = true;
  /**
   * A wall was painted since the last clear: moves and sensors then check every cell they cross (agents.frag
   * clearPath, ADR 0020).
   */
  private walls = false;
  /**
   * An alive agent may stand on a wall cell: a wall was painted, or bytes or an agent were written, since the agents
   * were last placed on open cells (reset()) or the environment was cleared. Only then does the agent pass read the
   * wall byte of each agent's cell (tools.glsl underWall, ADR 0038, decision 8).
   */
  private wallOverAgents = false;
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
      // The slime field, while the model has it: allocated now too, and the budget counts it. A new texture holds
      // zeros: no cell has a stamp.
      if (slimeModel(settings)) {
        this.slime = t(width, height, gl.R32UI);
        this.amount = [t(width, height, gl.R16UI), t(width, height, gl.R16UI)];
        this.front = t(width, height, gl.R32UI);
      }
      // So with the territory and the sinks while the rules of stage 4 run: no cell lies in a territory, and none was
      // a sink.
      if (territoryOn(settings)) {
        this.territory = {
          copies: [t(width, height, gl.R8UI), t(width, height, gl.R8UI)],
          owners: t(width, height, gl.R8UI),
        };
        this.sinks = makeSinks(t, width, height, flowStrains(settings), this.agentWidth, agentHeight);
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
    let input = { trail: this.trail[this.p], scent: this.scent[this.p] };
    for (const [i, v] of diffusePlanOf(this.settings).entries()) {
      // A mean window above 3 × 3 has a program of its own (ADR 0046).
      const d = v.box ? this.prog.box(false, true) : this.prog.view();
      // Even draws write the free pair, odd draws the third, so no draw reads the target it writes.
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
      if (v.box) {
        gl.uniform1i(d.loc('radius'), v.box.radius);
        gl.uniform1i(d.loc('columns'), Number(v.box.columns));
      }
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
      const [trail, scent] = allOrNothing(gl, (keep) => [
        keep(target(gl, this.width, this.height, gl.RGBA32F)),
        keep(target(gl, this.width, this.height, gl.RG32F)),
      ]);
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

  /** A change of the state: the view's map, the picture of the tubes and the stream are made anew at their next use. */
  private changed() {
    this.viewStale = true;
    this.tubesStale = true;
    this.streamStale = true;
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

  /**
   * The factors of the radius of the tubes of the picture, for the veins of the view (../sim.ts veinTexture, ADR 0099):
   * set after pictureTarget() while it is the picture of the tubes, else undefined. Display only.
   */
  veinTarget(): Target | undefined {
    if (!tubesShown(this.settings) || !this.flow || this.tubesStale) return undefined;
    return this.tubes?.roots;
  }

  /**
   * The stream of the plasm of the state that the view draws, for the grains (../sim.ts streamTexture): made once for
   * each state while the view draws the grains (tubes.ts grainsShown(), ADR 0095); undefined while it draws none.
   */
  streamTarget(): Target | undefined {
    if (!grainsShown(this.settings) || !this.flow) return undefined;
    if (this.streamStale || !this.stream) return this.encodeStream(this.flow);
    return this.stream;
  }

  /**
   * The passes of pictureTarget(): the factor of the radius of every tube, the map of the tiles of the picture, and the
   * picture.
   */
  private encodeTubes(flow: NonNullable<GlSim['flow']>) {
    this.syncShape();
    // Before the parameters of these passes: moving first the view's passes write theirs (encodeView()).
    const trail = this.viewTrail().texture;
    this.writeParams();
    const tubes = this.ensureTubes();
    const k = this.prog.tubes();
    const shape = this.shape.texture;
    const roots = tubes.roots.texture;
    this.pass(k.roots, tubes.roots, { ...this.flowMemories(flow), shape }, { strains: flow.memory.length });
    this.pass(k.rows, tubes.rows, { shape, roots }, {});
    this.pass(k.tiles, tubes.tiles, { rows: tubes.rows.texture }, {});
    this.pass(k.picture, tubes.picture, { trail, shape, roots, tiles: tubes.tiles.texture }, {});
    this.tubesStale = false;
    return tubes;
  }

  /** The pass of streamTarget(). It reads the flow, and not the picture of the tubes. */
  private encodeStream(flow: NonNullable<GlSim['flow']>) {
    this.syncShape();
    this.writeParams();
    // Made at its first use (sizing.ts TUBES_BYTES_PER_CELL counts it with the picture). A target that does not fit
    // frees its own texture (gl.ts target()).
    const stream = (this.stream ??= target(this.gl, this.width, this.height, this.gl.RGBA32F));
    const flows = { ...this.flowMemories(flow), ...this.flowPressures(flow) };
    const strains = { strains: flow.memory.length };
    // Over 8 neighbours the stream follows the 8 edges of the flow, and it reads the walls (ADR 0086).
    if (flowEight(this.settings))
      this.pass(this.prog.tubeStreamEight(), stream, { ...flows, shape: this.shape.texture }, strains);
    else this.pass(this.prog.tubeStream(), stream, flows, strains);
    this.streamStale = false;
    return stream;
  }

  /** The targets of the picture of the tubes, made at their first use (sizing.ts TUBES_BYTES_PER_CELL counts them). */
  private ensureTubes() {
    if (!this.tubes) {
      const gl = this.gl;
      const made: Target[] = [];
      try {
        for (let i = 0; i < 2; i++) made.push(target(gl, this.width, this.height, gl.RGBA32F));
        // The map of the tiles and its rows hold 0 or 1 per value.
        const [w, h] = [Math.ceil(this.width / TUBE_TILE), Math.ceil(this.height / TUBE_TILE)];
        made.push(target(gl, w, this.height, gl.RGBA8));
        made.push(target(gl, w, h, gl.RGBA8));
      } catch (error) {
        // A target did not fit: those before it must not stay behind.
        for (const t of made) destroyTarget(gl, t);
        throw error;
      }
      this.tubes = { roots: at(made, 0), picture: at(made, 1), rows: at(made, 2), tiles: at(made, 3) };
    }
    return this.tubes;
  }

  /** Frees the targets of the picture of the tubes. */
  private dropTubes() {
    if (!this.tubes) return;
    destroyTarget(this.gl, this.tubes.roots);
    destroyTarget(this.gl, this.tubes.picture);
    destroyTarget(this.gl, this.tubes.rows);
    destroyTarget(this.gl, this.tubes.tiles);
    this.tubes = undefined;
    this.tubesStale = true;
  }

  /** Frees the target of the stream. */
  private dropStream() {
    if (!this.stream) return;
    destroyTarget(this.gl, this.stream);
    this.stream = undefined;
    this.streamStale = true;
  }

  /** For tests: the trail that the picture draws (pictureTarget()), 4 lanes per cell. */
  readPicture(): Promise<Float32Array> {
    return Promise.resolve(readTarget(this.gl, this.pictureTarget()) as Float32Array);
  }

  /** For tests: the stream of the plasm, 4 values per cell (x, y, 0, 0); empty while the view draws no grains. */
  readStream(): Promise<Float32Array> {
    const stream = this.streamTarget();
    return Promise.resolve(stream ? (readTarget(this.gl, stream) as Float32Array) : new Float32Array(0));
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

  /**
   * For the renderer: the outline distances of the electrodes (`poles`), or undefined while no pole may lie in `env`
   * (`hasElectrodes`). Call syncShape() before reading it.
   */
  get poleTexture(): WebGLTexture | undefined {
    return this.poles?.texture;
  }

  /** The outline distances of the electrodes, made at the first pole. A new texture holds zeros: no pole is near. */
  private ensurePoles(): Target {
    this.poles ??= target(this.gl, this.width, this.height, this.gl.RGBA8);
    return this.poles;
  }

  /** Frees the outline distances of the electrodes: `env` holds no pole. */
  private dropPoles() {
    if (this.poles) destroyTarget(this.gl, this.poles);
    this.poles = undefined;
    this.poleLayers.fill(false);
  }

  /** Agents per cell after the last step, kept in collision mode only; none without float blending. */
  get occupancyTexture(): WebGLTexture | undefined {
    return this.collision?.occ[this.q].texture;
  }

  /**
   * The agents per cell after the last step while the rule of one agent per cell runs: the agents are then the plasm,
   * and the auto levels keep the black level below their trail (exposure.ts levels(), ADR 0062). Nothing without the
   * rule: agents share cells then, and nobody keeps the texture up to date.
   */
  get agentCells(): WebGLTexture | undefined {
    return this.settings.collisions ? this.occupancyTexture : undefined;
  }

  /**
   * The agents that moved into each cell in the last step, one strain per channel (`counts`), while agents share
   * cells: the auto levels keep the white level above their trail (exposure.ts levels(), ADR 0090). Nothing with the
   * rule of one agent per cell: agentCells is the plasm then.
   */
  get movedCells(): WebGLTexture | undefined {
    return this.settings.collisions ? undefined : this.counts.texture;
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
    // The memory fit counts the slime field only in the model that has it: the Jones model has no slime.
    if (!slimeModel(settings)) this.dropSlime();
    // It counts the territory only while the rules of stage 4 run (sizing.ts territoryBytesPerCell()).
    if (!territoryOn(settings)) this.dropTerritory();
    // The picture of the tubes holds its targets only while the settings show it, and the stream only while the view
    // draws the grains (tubes.ts). The memory fit counts them with the flow, shown or not (sizing.ts
    // tubesBytesPerCell()).
    if (!tubesShown(settings)) this.dropTubes();
    if (!grainsShown(settings)) this.dropStream();
  }

  foodSites(sites: FlowSites) {
    this.sites = sites;
    if (this.flow) this.flow.cellsCurrent = false;
  }

  /**
   * The cells of the sites on the GPU (`cells` in flow.frag): one float per cell index, −1 for no cell, W of them per
   * row, in a target that holds them; and the target of the hits of their blocks (`hits`), `hitRows` rows per strain.
   * Cell indices and block counts stay below 2^24, so floats hold them exactly.
   */
  private siteCells(flow: NonNullable<GlSim['flow']>) {
    const gl = this.gl;
    const { cells } = this.sites;
    const w = this.width;
    const [rows, blocks] = [Math.max(1, Math.ceil(cells.length / w)), cells.length / SITE_BLOCK];
    const hitRows = Math.max(1, Math.ceil(blocks / w));
    const strains = flow.memory.length;
    if (!flow.cells || !flow.hits || !flow.cellsCurrent) {
      if (!flow.cells || !flow.hits || flow.cells.height < rows || flow.hits.height < hitRows * strains) {
        for (const t of [flow.cells, flow.hits]) if (t) destroyTarget(gl, t);
        [flow.cells, flow.hits] = [undefined, undefined];
        flow.cells = target(gl, w, rows, gl.R32F);
        flow.hits = target(gl, w, hitRows * strains, gl.R32F);
      }
      const data = new Float32Array(w * rows).fill(-1);
      cells.forEach((c, i) => {
        if (c !== NO_CELL) data[i] = c;
      });
      writeTarget(gl, flow.cells, 0, 0, w, rows, data);
      flow.cellsCurrent = true;
    }
    // The hits of a strain start at a multiple of hitRows: the rows of the target as made, divided by the strains.
    return { cells: flow.cells, hits: flow.hits, hitRows: flow.hits.height / strains };
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
        const port = () => {
          const t = target(gl, FLOW_SITES, strains, gl.RGBA32F);
          made.push(t);
          return t;
        };
        const ports: Pair<Target> = [port(), port()];
        const lanes = target(gl, FLOW_SITES, 64 * strains, gl.RGBA32F);
        made.push(lanes);
        this.flow = {
          memory,
          pressure,
          ubo: uniformBlock(gl, FLOW_BYTES, FLOW_BINDING),
          ports,
          port: 0,
          lanes,
          cells: undefined,
          hits: undefined,
          cellsCurrent: false,
        };
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
    // No site has a port yet, nor had one in a step before.
    for (const t of this.flow.ports) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, t.width, t.height);
      gl.clearColor(-1, -1, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.flowM = 0;
    this.flowP = 0;
  }

  /**
   * The slime field, made at its first use (sizing.ts SLIME_BYTES_PER_CELL counts it): the stamps, and the amounts
   * with them. No cell has a stamp, and no cell has slime.
   */
  private ensureSlime(): { stamps: Target; amounts: [Target, Target]; fronts: Target } {
    const { gl, width, height } = this;
    this.slime ??= target(gl, width, height, gl.R32UI);
    this.amount ??= [target(gl, width, height, gl.R16UI), target(gl, width, height, gl.R16UI)];
    this.front ??= target(gl, width, height, gl.R32UI);
    return { stamps: this.slime, amounts: this.amount, fronts: this.front };
  }

  /**
   * For the renderer: the texture of the slime field, which the picture reads for the film of the slime (render.frag
   * `stamps`), or undefined while the simulation holds none (`slimeField` in ../sim.ts).
   */
  get slimeTexture(): WebGLTexture | undefined {
    return this.slime?.texture;
  }

  /**
   * For the renderer: the texture of the amounts of slime (ADR 0057), which the picture reads beside the stamps, or
   * undefined while the simulation holds no slime field (`slimeAmount` in ../sim.ts).
   */
  get slimeAmountTexture(): WebGLTexture | undefined {
    return this.amount?.[this.am].texture;
  }

  /**
   * For the renderer: the texture of the front field (ADR 0060), which the picture reads for the sheet of the growth
   * front, or undefined while the simulation holds no slime field (`slimeFront` in ../sim.ts).
   */
  get slimeFrontTexture(): WebGLTexture | undefined {
    return this.front?.texture;
  }

  /** Frees the slime field. */
  private dropSlime() {
    if (!this.slime) return;
    destroyTarget(this.gl, this.slime);
    this.slime = undefined;
    for (const t of this.amount ?? []) destroyTarget(this.gl, t);
    this.amount = undefined;
    if (this.front) destroyTarget(this.gl, this.front);
    this.front = undefined;
    this.stamped = false;
  }

  /**
   * For tests and measurements: the stamp of every cell as the field holds it (../slime.ts), one value per cell; only
   * zeros in the Jones model, which has no slime (../sim.ts readSlime()).
   */
  readSlime(): Promise<Uint32Array> {
    if (!this.slime) return Promise.resolve(new Uint32Array(this.width * this.height));
    return Promise.resolve(readUintTarget(this.gl, this.slime));
  }

  /** For tests and measurements: the front stamp of every cell (ADR 0060; ../sim.ts readSlimeFront()). */
  readSlimeFront(): Promise<Uint32Array> {
    if (!this.front) return Promise.resolve(new Uint32Array(this.width * this.height));
    return Promise.resolve(readUintTarget(this.gl, this.front));
  }

  /** For tests and measurements: the amount of slime of every cell (ADR 0057; ../sim.ts readSlimeAmount()). */
  readSlimeAmount(): Promise<Uint32Array> {
    if (!this.amount) return Promise.resolve(new Uint32Array(this.width * this.height));
    return Promise.resolve(readUintTarget(this.gl, this.amount[this.am]));
  }

  private dropFlow() {
    if (!this.flow) return;
    const { memory, pressure, ports, lanes, cells, hits } = this.flow;
    for (const t of [...memory.flat(), ...pressure.flat(), ...ports, lanes, cells, hits])
      if (t) destroyTarget(this.gl, t);
    this.gl.deleteBuffer(this.flow.ubo);
    this.flow = undefined;
  }

  /** The uniform block of the flow with the block of a strain (flow.ts packFlow()): the passes that follow read it. */
  private flowBlock(flow: NonNullable<GlSim['flow']>, strain: number) {
    const gl = this.gl;
    gl.bindBufferBase(gl.UNIFORM_BUFFER, FLOW_BINDING, flow.ubo);
    // The constants of stage 4 after the sites (territory.ts packTerritory(); ADR 0067, decision 9).
    const block = packTerritory(packFlow(this.settings, this.sites, this.flowData, strain), this.settings);
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

  /**
   * The pressure of the flow of every strain for the stream (tubes.frag) and for the sensors of the rules of stage 4
   * (agents.frag, ADR 0070): the samplers as flowMemories() names them.
   */
  private flowPressures(flow: NonNullable<GlSim['flow']>): Record<string, WebGLTexture> {
    const of = (strain: number) => at(flow.pressure[strain] ?? at(flow.pressure, 0), this.flowP).texture;
    return { flowPressure: of(0), flowPressure1: of(1), flowPressure2: of(2), flowPressure3: of(3) };
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

  writePressure(data: Float32Array, strain = 0) {
    if (!flowOn(this.settings) || strain >= flowStrains(this.settings)) return;
    const pressure = at(at(this.ensureFlow().pressure, strain), this.flowP);
    writeTarget(this.gl, pressure, 0, 0, this.width, this.height, data);
    // The grains show the stream of the plasm (ADR 0034, ADR 0095).
    this.changed();
    this.revision++;
  }

  reset() {
    this.revision++;
    const gl = this.gl;
    this.changed();
    // init.frag starts every alive agent on an open cell, after the walls (ADR 0038, decision 8).
    this.wallOverAgents = false;
    // The scent targets are cleared below, and without a food or a light no step adds scent.
    this.scentless = !this.sources;
    this.step = 0;
    this.sortedFor = -1;
    this.a = 0;
    this.p = 0;
    this.writeParams();
    for (const t of [...this.trail, ...this.scent, this.counts]) clear(gl, t);
    this.clearFlow();
    // A reset clears every stamp (ADR 0055, decision 3), and the amounts with them.
    if (this.slime) clearUint(gl, this.slime);
    for (const t of this.amount ?? []) clearUint(gl, t);
    if (this.front) clearUint(gl, this.front);
    this.stamped = false;
    // A reset clears the territory (ADR 0068): the engine writes the start territory after it (Engine.seedAtFood()).
    if (this.territory) for (const t of [...this.territory.copies, this.territory.owners]) clearUint(gl, t);
    this.tt = 0;
    // And the sinks: no cell was a sink before (ADR 0069).
    if (this.sinks) {
      for (const t of [...this.sinks.rates.flat(), ...this.sinks.state]) clear(gl, t);
      for (const t of this.sinks.levels.flat()) clearUint(gl, t);
    }
    this.sr = 0;
    this.st = 0;
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
   * paints what one call per stroke paints. A stroke of a pole has its outline in `poles` in place of the outline
   * target, and an erase and a wall have one in both while a pole may lie in `env` (drawOutlines()).
   *
   * A stroke of the Slime tool changes no byte of `env` or of the outline target. What the strokes do with the slime
   * field follows after the environment of all of them (brushSlime(), as paint() in ../sim.ts).
   */
  paint(strokes: readonly Stroke[]) {
    const env = strokes.filter((s) => paintsEnv(s.kind));
    const slime = slimeModel(this.settings) && strokes.some((s) => changesSlime(s.kind));
    if (env.length === 0 && !slime) return;
    this.revision++;
    if (env.length > 0) this.paintEnv(env);
    this.brushSlime(strokes);
  }

  /** The strokes of paint() that change the environment, with their outlines. */
  private paintEnv(strokes: readonly Stroke[]) {
    this.changed();
    // After a change of boundary the outline target is held to `env` under the new one first. Strokes under another
    // boundary leave that to the next readback or frame (below), so one call paints what one call per stroke paints.
    if (this.shapeHeld !== undefined) this.syncShape();
    const gl = this.gl;
    const p = this.prog.paint;
    // The target of the outlines of the electrodes, before any target is bound: the strokes paint a pole.
    if (strokes.some((s) => isPole(s.kind))) this.ensurePoles();
    const run: RunItem[] = [];
    let boundary: Boundary | undefined;
    let kind = -1; // the kind the paint state is set for; -1: the env target is not bound
    let foreign = false;
    const drawRun = () => {
      if (run.length === 0) return;
      this.drawOutlines(run);
      // The same segments on the outlines of the electrodes, with the poles as the two layers.
      const poled = run.filter((item) => item.poles);
      if (this.poles && poled.length > 0) this.drawOutlines(poled, this.poles);
      run.length = 0;
      this.pending.clear();
      kind = -1;
    };
    for (const stroke of strokes) {
      const b = stroke.boundary ?? this.settings.boundary;
      const wrap = b === 'wrap';
      const k = EnvKind[stroke.kind];
      const pole = isPole(stroke.kind);
      if (b !== this.settings.boundary) foreign = true;
      if (k === EnvKind.wall) [this.walls, this.wallOverAgents] = [true, true];
      if (releases(stroke.kind)) [this.sources, this.scentless] = [true, false];
      if (k !== EnvKind.erase) this.hasEnvironment = true;
      if (pole) this.hasElectrodes = true;
      if (pole) this.poleLayers[k === EnvKind.cathode ? 0 : 1] = true;
      if (k !== EnvKind.erase && !pole) this.layers[k - 1] = true;
      // By the poles that the strokes before left: before the first pole no cell holds one.
      const poles = polesOutlined(stroke.kind, this.hasElectrodes);
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
        run.push({ segment, kind: stroke.kind, rects: reach, poles });
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
   * Paints only what the strokes do with the slime field (Sim.paintSlime(), ADR 0055, decision 7): the engine paints
   * the slime of its edit list again after a reset, which clears every stamp. Nothing in the Jones model.
   */
  paintSlime(strokes: readonly Stroke[]) {
    if (!slimeModel(this.settings) || !strokes.some((s) => changesSlime(s.kind))) return;
    this.revision++;
    this.brushSlime(strokes);
  }

  /**
   * What strokes do with the slime field (slime-paint.frag; brushSlime() in ../sim.ts), in their order, against `env`
   * as it is now: one draw per segment into the target of the stamps, scissored to the cells that the segment can
   * reach. A stroke of the Slime tool gives the open cells of its footprint the stamp of the current step, and an erase
   * and a wall clear the stamp of their cells. Every other kind draws nothing, and so do an erase and a wall while no
   * cell holds a stamp (`stamped`). Nothing in the Jones model, which has no field.
   */
  private brushSlime(strokes: readonly Stroke[]) {
    if (!slimeModel(this.settings)) return;
    const gl = this.gl;
    let field: { stamps: Target; amounts: [Target, Target]; fronts: Target } | undefined;
    let boundary: Boundary | undefined;
    for (const stroke of strokes) {
      if (stroke.kind === 'slime') this.stamped = true;
      if (!changesSlime(stroke.kind) || !this.stamped) continue;
      const b = stroke.boundary ?? this.settings.boundary;
      const wrap = b === 'wrap';
      const k = EnvKind[stroke.kind];
      for (const segment of paintSegments(stroke, this.width, this.height, wrap)) {
        const rects = scissorRects(segment, this.width, this.height, wrap);
        if (rects.length === 0) continue; // outside a closed arena: no cell to paint
        if (!field) {
          field = this.ensureSlime();
          gl.viewport(0, 0, this.width, this.height);
          gl.enable(gl.SCISSOR_TEST);
        }
        if (b !== boundary) {
          this.writeParams(undefined, 0, b);
          boundary = b;
        }
        const [now, free] = [field.amounts[this.am], field.amounts[flip(this.am)]];
        // The amounts of the segment first (PASS 1 of slime-paint.frag, ADR 0057): they read the stamps of before
        // the segment. A stroke of the Slime tool also reads the amounts of before it, from a copy of its cells in
        // the free target. Then the stamps (PASS 0).
        const passes: [Program, Target, Record<string, WebGLTexture>][] = [
          [this.prog.slimeBrushAmount(), now, { stamps: field.stamps.texture, old: free.texture }],
          // The front field (PASS 2, ADR 0060) reads the stamps of before the segment too.
          [this.prog.slimeBrushFront(), field.fronts, { stamps: field.stamps.texture }],
          [this.prog.slimeBrush(), field.stamps, {}],
        ];
        for (const [p, to, more] of passes) {
          if (to === now && stroke.kind === 'slime') {
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, now.fbo);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, free.fbo);
            for (const [x, y, w, h] of rects) {
              gl.scissor(x, y, w, h);
              gl.blitFramebuffer(x, y, x + w, y + h, x, y, x + w, y + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
            }
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
          gl.useProgram(p.program);
          textures(gl, p.program, { env: this.env.texture, ...more });
          gl.uniform1i(p.loc('arena'), BOUNDARIES.indexOf(this.settings.boundary));
          gl.uniform1i(p.loc('kind'), k);
          gl.uniform1f(p.loc('radius'), segment.radius);
          gl.uniform2f(p.loc('from'), ...segment.from);
          gl.uniform2f(p.loc('to'), ...segment.to);
          for (const r of rects) {
            gl.scissor(...r);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          }
        }
      }
    }
    if (field) gl.disable(gl.SCISSOR_TEST);
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
    // No pole is left: the simulation holds their outlines again from the next pole on.
    this.dropPoles();
    // Clear clears every stamp, as an erase of the whole grid does (ADR 0055, decision 7).
    const stamps = this.slime;
    if (stamps) clearUint(this.gl, stamps);
    for (const t of this.amount ?? []) clearUint(this.gl, t);
    if (this.front) clearUint(this.gl, this.front);
    this.stamped = false;
    [this.walls, this.wallOverAgents] = [false, false];
    this.hasEnvironment = false;
    this.hasElectrodes = false;
    // The scent that the targets hold stays until the next reset.
    this.sources = false;
    this.shapeHeld = this.settings.boundary;
    this.layers.fill(false);
  }

  /**
   * Holds the outline target to `env` under the current boundary (shape.frag op 3, see Simulation.syncShape()), once
   * after the boundary changed or after strokes under another boundary. Op 3 reads the bytes before from a copy,
   * made one tile at a time so the copy stays small. The outline distances of the electrodes follow in the same way,
   * while the simulation holds them.
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
    const held: [Program, Target][] = [[this.prog.shape, this.shape]];
    if (this.poles) held.push([this.prog.poleShape(), this.poles]);
    for (const [program, outlines] of held)
      for (let y = 0; y < this.height; y += th)
        for (let x = 0; x < this.width; x += tw) {
          const [w, h] = [Math.min(tw, this.width - x), Math.min(th, this.height - y)];
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, outlines.fbo);
          gl.bindTexture(gl.TEXTURE_2D, copy.texture);
          gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, x, y, w, h);
          gl.scissor(x, y, w, h);
          this.pass(program, outlines, { env: this.env.texture, old: copy.texture }, { op: 3 }, (p) => {
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

  readPoles(): Promise<Uint8Array> {
    this.syncShape();
    if (!this.poles) return Promise.resolve(new Uint8Array(this.width * this.height * 4));
    return Promise.resolve(readTarget(this.gl, this.poles) as Uint8Array);
  }

  /** Agent `index` is its texel: WebGL2 never reorders agents, so the slot is the id (ADR 0005). */
  writeAgent(index: number, a: AgentState) {
    if (!Number.isInteger(index) || index < 0 || index >= this.agents) throw new RangeError(`No agent ${index}.`);
    const x = index % this.agentWidth;
    const y = Math.floor(index / this.agentWidth);
    // A test can put an agent anywhere, also on a wall.
    if (this.walls) this.wallOverAgents = true;
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
   * `env`. So with the outline distances of the electrodes, which the simulation holds while the bytes hold a pole.
   */
  writeEnv(data: Uint8Array) {
    this.changed();
    this.revision++;
    writeTarget(this.gl, this.env, 0, 0, this.width, this.height, data);
    clear(this.gl, this.shape);
    const any = (channel: number) => data.some((v, i) => i % 4 === channel && v > 0);
    this.walls = any(0);
    this.wallOverAgents = this.walls;
    [0, 1, 2].forEach((c) => (this.layers[c] = any(c)));
    this.hasElectrodes = any(3);
    this.dropPoles();
    if (this.hasElectrodes) {
      // A new target holds zeros. Either pole may lie in the bytes.
      this.ensurePoles();
      this.poleLayers.fill(true);
    }
    this.hasEnvironment = this.layers.some(Boolean) || this.hasElectrodes;
    this.sources = any(1) || any(2) || any(3);
    if (this.sources) this.scentless = false;
    this.shapeHeld = undefined;
    if (this.walls) {
      this.writeParams(); // binds this simulation's parameters for the passes
      this.updateClearance();
    }
  }

  destroy() {
    this.destroyed = true;
    const gl = this.gl;
    const all = [...this.agentsTex, ...this.trail, ...this.scent, this.counts, this.env, this.shape, this.tally];
    all.push(this.noScent, ...this.order, ...this.orderLevels);
    all.push(this.walled, this.clearance);
    if (this.panels) all.push(this.panels);
    if (this.presence) all.push(this.presence);
    if (this.collision) all.push(...this.collision.occ, this.collision.claims);
    all.push(...this.growthTargets());
    if (this.poles) all.push(this.poles);
    for (const t of all) destroyTarget(gl, t);
    for (const f of this.mrt) gl.deleteFramebuffer(f);
    this.dropViewThird();
    this.dropFlow();
    this.dropTubes();
    this.dropStream();
    this.dropSlime();
    // The territory and the sinks of the rules of stage 4 (ADR 0068, ADR 0069).
    this.dropTerritory();
    gl.deleteBuffer(this.ubo);
  }

  /**
   * Draws the outlines of a run of segments that paint() has applied to `env` (shape.frag), kind by kind
   * (OUTLINE_DRAWS): in a run, segments of different kinds have boxes that do not meet (PendingOutlines), so their
   * draws touch other cells. Scissors cut every draw to the grid in a closed arena and split it where it crosses the
   * edge of the periodic grid. The Params block holds the run's boundary. `poles`: the target of the outlines of the
   * electrodes, to draw into it in place of the outline target (POLE_DRAWS), with the poles as the two layers.
   */
  private drawOutlines(run: readonly RunItem[], poles?: Target) {
    const gl = this.gl;
    const sp = poles ? this.prog.poleShape() : this.prog.shape;
    const draws = poles ? POLE_DRAWS : OUTLINE_DRAWS;
    gl.bindFramebuffer(gl.FRAMEBUFFER, (poles ?? this.shape).fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(sp.program);
    // `old` (op 3) is never read here, but its unit must not hold the target: a frame binds it there.
    textures(gl, sp.program, { env: this.env.texture, old: this.env.texture });
    gl.enable(gl.SCISSOR_TEST);
    // `poles` holds no light and no shadow.
    const [walls, food, light] = poles ? [...this.poleLayers, false] : this.layers;
    const draw = ([op, all, equation, cut = 0]: OutlineDraw, rects: readonly Rect[], hold = false, core = false) => {
      // Only the layers that hold anything: a subtraction of food or walls (or of a pole), the light and the shadow.
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
      gl.uniform1i(sp.loc('cut'), cut);
      gl.uniform1i(sp.loc('core'), Number(core));
      gl.uniform2i(sp.loc('layers'), Number(mask[0]), Number(mask[1]));
      for (const r of rects) {
        gl.scissor(...r);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
    const byKind: Partial<Record<EnvTool, RunItem[]>> = {};
    for (const item of run) (byKind[item.kind] ??= []).push(item);
    for (const [kind, items] of Object.entries(byKind) as [EnvTool, RunItem[]][]) {
      const { segment, hold, run: after } = draws[kind];
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
      wallOverAgents: this.wallOverAgents,
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
    // With the flow in the tubes, the pass in which agents starve and come to life by the flow memory (ADR 0029), and
    // with the rules of stage 4 move and come to life only onto the territory (ADR 0068).
    if (flowOn(this.settings)) {
      const territory = this.settings.collisions && territoryOn(this.settings);
      return this.prog.flowing(senseWalls, trailSaturation(this.settings) > 0, territory);
    }
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
    // The rules of stage 4 (ADR 0068): the agent passes and growth read the territory of the step before, the owners
    // come from the agents after the moves and the births, and the push writes the next territory.
    const territory = this.settings.collisions && territoryOn(this.settings) ? this.ensureTerritory() : undefined;
    const held: Record<string, WebGLTexture> = territory ? { territory: territory.copies[this.tt].texture } : {};
    // The sinks of each strain (ADR 0069), in the passes of the flow.
    const sinks = territory ? this.ensureSinks() : undefined;
    // With the rules the sensors read the mean pressure of the flow of the step before and what the sink of each cell
    // takes over its conductivity, of each strain (TERRITORY in agents.frag, ADR 0070, ADR 0075), which PASS 5 of
    // flow.frag writes first, and the state and the counts of the paid births (ADR 0100): 16 samplers in all, the 16
    // that every device has.
    if (flow && sinks) this.encodeDrift(flow, sinks);
    const pressures: Record<string, WebGLTexture> =
      flow && sinks ? { pressures: sinks.pressures.texture, takes: sinks.takes.texture } : {};
    // With the rules of stage 4, mode 3 reads the budget and the counts of the step (ADR 0100): 16 samplers in all.
    const paidTextures: Record<string, WebGLTexture> = sinks
      ? { paidState: sinks.state[this.st].texture, paidCounts: sinks.counts.texture }
      : {};
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
          ...held,
          ...pressures,
          ...paidTextures,
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
      // With the rules of stage 4 (ADR 0100): the counts of the step start at 0; the respawns that wait and the deaths
      // of mode 1, then mode 3 lets the respawns that the budget pays claim their cells. The agents then lie in A.
      let claimed = B;
      if (sinks) {
        clear(gl, sinks.counts);
        this.countPaid(sinks, B, [MARKS.waits, MARKS.died]);
        agentPass(3, B, A, occ.texture, dummy);
        claimed = A;
      }
      clear(gl, col.claims);
      // A tool's spot needs the occupancy (tools.glsl placement), and a spot of the flow its memory and the territory.
      const claimPoints = territory ? this.prog.territory().points : flow ? this.prog.flow().points : this.prog.points;
      const spots = { occ: occ.texture, ...flowMemory, ...held };
      this.points(1, col.claims, gl.MAX, claimed, [0, 0, 0, 0], spots, claimPoints);
      if (sinks) {
        // Settle into B, and count the respawns that came to life.
        agentPass(2, A, B, occ.texture, col.claims.texture);
        this.a = flip(this.a);
        this.countPaid(sinks, B, [MARKS.reborn]);
      } else agentPass(2, B, A, occ.texture, col.claims.texture);
      const next = col.occ[flip(this.q)];
      clear(gl, next);
      this.points(2, next, gl.FUNC_ADD);
      this.q = flip(this.q);
    }
    this.deposit();
    // Growth and shrinkage after the deposits, so an agent that shrinkage deletes keeps the trail of its move, as on
    // WebGPU (ADR 0025). Only with the rule, on the steps that test them.
    const tests = growthTests(this.settings, this.step);
    if (col && (tests.grow || tests.shrink)) this.encodeGrowth(tests.grow, held, sinks);
    // The owners after the moves and the births of the step (owners.vert).
    if (territory) this.encodeOwners(territory);
    const covered = this.settings.coveredFood;
    // The unused sampler `occ` gets a texture that is no target of the diffusion pass.
    const occ = covered ? this.occupancyAfterMoves() : this.env.texture;
    const senseFirst = this.settings.stepOrder === 'sense-first';
    // A mean window above 3 × 3 runs two draws per pass (ADR 0046): the map then ends in the pair it came from.
    for (const v of diffusePlanOf(this.settings)) {
      const out = flip(this.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mrt[out]);
      gl.viewport(0, 0, this.width, this.height);
      // The pass that adds the step's sources (diffuse.frag): the last moving first, the first sensing first (ADR 0027);
      // with covered food while it is on.
      const withCovered = covered && (senseFirst ? v.first : v.last);
      const d = v.box ? this.prog.box(withCovered, false) : withCovered ? this.prog.covered() : this.prog.diffuse;
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
      if (v.box) {
        gl.uniform1i(d.loc('radius'), v.box.radius);
        gl.uniform1i(d.loc('columns'), Number(v.box.columns));
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.p = out;
    }
    // The stamps of the slime field, from the trail after the step's diffusion, while the slime has a life time
    // (slime.frag; encodeSlime in ../sim.ts, ADR 0055): a cell that holds plasm gets the stamp of the step, and the
    // pass discards the fragment of every other cell.
    if (slimeSteps(this.settings) > 0) {
      this.stamped = true;
      const { stamps, amounts, fronts } = this.ensureSlime();
      const trail = this.trail[this.p].texture;
      // The amounts first (ADR 0057): their pass reads the stamps of before the step, and writes every amount into
      // the free target.
      const held = { trail, stamps: stamps.texture, amounts: amounts[this.am].texture };
      this.pass(this.prog.slimeAmount(), amounts[flip(this.am)], held, {});
      this.am = flip(this.am);
      // The front field (ADR 0060) reads the stamps of before the step too.
      this.pass(this.prog.slimeFront(), fronts, { trail, stamps: stamps.texture }, {});
      this.pass(this.prog.slime(), stamps, { trail }, {});
    }
    if (flow) this.encodeFlow(flow, territory && sinks ? { territory, sinks } : undefined);
    // The push last (ADR 0067, decision 6). It reads the constants of stage 4 of the uniform block of the flow, which the
    // block of every strain holds (flowBlock()).
    if (territory && flow) this.encodePush(territory);
  }

  /**
   * Adds the agents of `agents` that hold each mark of `marks` to its count of the step (paid.vert, ADR 0100): one point
   * per agent slot and mark, with additive blending into `sinks.counts`, a lane per strain.
   */
  private countPaid(sinks: GlSinks, agents: Target, marks: readonly (readonly [number, number])[]) {
    const gl = this.gl;
    const p = this.prog.territory().paid;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sinks.counts.fbo);
    gl.viewport(0, 0, sinks.counts.width, sinks.counts.height);
    gl.useProgram(p.program);
    textures(gl, p.program, { agents: agents.texture });
    gl.uniform1i(p.loc('agentWidth'), this.agentWidth);
    gl.uniform1i(p.loc('parts'), marks.length);
    gl.uniform1i(p.loc('lanes'), PAID_COUNT_LANES);
    gl.uniform1uiv(
      p.loc('marks'),
      Uint32Array.from({ length: 4 }, (_, k) => marks[k]?.[0] ?? 0),
    );
    gl.uniform1iv(
      p.loc('texels'),
      Int32Array.from({ length: 4 }, (_, k) => marks[k]?.[1] ?? 0),
    );
    this.blend(gl.FUNC_ADD);
    gl.drawArrays(gl.POINTS, 0, marks.length * this.agents);
    gl.disable(gl.BLEND);
  }

  /**
   * Adds the steps of the rate of each agent with a key of the growth test to the sum P of its strain (paid.vert SHARE,
   * ADR 0100, part A): two points per agent slot, the steps / 64 to PAID_COUNTS shareHigh and the rest to shareLow.
   */
  private countShare(sinks: GlSinks) {
    const gl = this.gl;
    const p = this.prog.territory().share;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sinks.counts.fbo);
    gl.viewport(0, 0, sinks.counts.width, sinks.counts.height);
    gl.useProgram(p.program);
    textures(gl, p.program, {
      agents: this.agentsTex[this.a].texture,
      keys: sinks.keys.texture,
      ...this.ratesOf(sinks),
    });
    gl.uniform1i(p.loc('agentWidth'), this.agentWidth);
    gl.uniform1i(p.loc('parts'), 2);
    gl.uniform1i(p.loc('lanes'), PAID_COUNT_LANES);
    gl.uniform1iv(p.loc('texels'), Int32Array.of(PAID_COUNTS.shareHigh, PAID_COUNTS.shareLow, 0, 0));
    this.blend(gl.FUNC_ADD);
    gl.drawArrays(gl.POINTS, 0, 2 * this.agents);
    gl.disable(gl.BLEND);
  }

  /** The owners of every cell from the agents after the moves and the births (owners.vert, PASS 2 of territory.frag). */
  private encodeOwners(territory: { owners: Target }) {
    const gl = this.gl;
    const p = this.prog.territory().owners;
    clearUint(gl, territory.owners);
    gl.bindFramebuffer(gl.FRAMEBUFFER, territory.owners.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(p.program);
    textures(gl, p.program, { agents: this.agentsTex[this.a].texture });
    gl.uniform1i(p.loc('agentWidth'), this.agentWidth);
    // A target of unsigned integers takes no blending: with one agent per cell no two points meet.
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.POINTS, 0, this.agents);
  }

  /** The push (PASS 0 of territory.frag): the next territory, which becomes the current one. */
  private encodePush(territory: { copies: Pair<Target>; owners: Target }) {
    const { copies, owners } = territory;
    const tex = { territory: copies[this.tt].texture, owners: owners.texture, env: this.env.texture };
    this.pass(this.prog.territory().push, copies[flip(this.tt)], tex, {});
    this.tt = flip(this.tt);
  }

  /**
   * The targets of the territory, made at their first use while the rules of stage 4 run (sizing.ts
   * TERRITORY_BYTES_PER_CELL). New targets hold zeros: no cell lies in a territory.
   */
  private ensureTerritory(): { copies: Pair<Target>; owners: Target } {
    if (!this.territory) {
      const gl = this.gl;
      const [w, h] = [this.width, this.height];
      this.territory = allOrNothing(gl, (keep) => {
        const make = () => keep(target(gl, w, h, gl.R8UI));
        return { copies: [make(), make()], owners: make() };
      });
      this.tt = 0;
    }
    return this.territory;
  }

  /** Frees the targets of the territory, and with them those of the sinks. */
  private dropTerritory() {
    this.dropSinks();
    if (!this.territory) return;
    for (const t of [...this.territory.copies, this.territory.owners]) destroyTarget(this.gl, t);
    this.territory = undefined;
  }

  /**
   * The targets of the sinks, made at their first use while the rules of stage 4 run (sizing.ts SINK_BYTES_PER_CELL_GL,
   * and DRIFT_BYTES_PER_CELL_GL for the two targets of the drift), for the strains of the settings: settings with
   * another number of strains get new targets, as the flow gets new ones (ensureFlow()). New targets hold zeros: no
   * cell was a sink.
   */
  private ensureSinks(): GlSinks {
    const strains = flowStrains(this.settings);
    if (this.sinks && this.sinks.strains !== strains) this.dropSinks();
    if (!this.sinks) {
      const gl = this.gl;
      const agentHeight = Math.ceil(this.slots / this.agentWidth);
      this.sinks = allOrNothing(gl, (keep) =>
        makeSinks(
          (w, h, format) => keep(target(gl, w, h, format)),
          this.width,
          this.height,
          strains,
          this.agentWidth,
          agentHeight,
        ),
      );
      this.sr = 0;
      this.st = 0;
    }
    return this.sinks;
  }

  /** Frees the targets of the sinks, and the framebuffers of the test that write the keys and of the drift. */
  private dropSinks() {
    for (const fbo of this.keyFbos.values()) this.gl.deleteFramebuffer(fbo);
    this.keyFbos.clear();
    if (this.driftFbo) this.gl.deleteFramebuffer(this.driftFbo);
    this.driftFbo = undefined;
    if (!this.sinks) return;
    const { rates, levels, state, keys, counts, pressures, takes } = this.sinks;
    for (const t of [...rates.flat(), ...levels.flat(), ...state, keys, counts, pressures, takes])
      destroyTarget(this.gl, t);
    this.sinks = undefined;
  }

  /**
   * The target of PASS 5 of flow.frag (ADR 0075): `pressures` and `takes` of the sinks as the two targets of one
   * framebuffer, made at its first use.
   */
  private driftTarget(sinks: GlSinks): Target {
    const gl = this.gl;
    if (!this.driftFbo) {
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sinks.pressures.texture, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, sinks.takes.texture, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteFramebuffer(fbo);
        throw new Error('The drift cannot write the mean pressures and what the sinks take at once');
      }
      this.driftFbo = fbo;
    }
    return { ...sinks.pressures, fbo: this.driftFbo };
  }

  /**
   * What the sensors of each strain read of its flow (PASS 5 of flow.frag, ADR 0075), at the start of a step, before
   * the agent passes: lane s of the mean pressures and of take / G, from the memory, the pressure, the rates and the
   * state as the flow of the step before left them. Each strain draws with its block into its lane alone; then the
   * block of the first strain, which the agent passes read, is bound again.
   */
  private encodeDrift(flow: NonNullable<GlSim['flow']>, sinks: GlSinks) {
    const gl = this.gl;
    const drift = this.prog.sinks().drift;
    const dst = this.driftTarget(sinks);
    for (let strain = 0; strain < sinks.strains; strain++) {
      this.flowBlock(flow, strain);
      gl.colorMask(strain === 0, strain === 1, strain === 2, strain === 3);
      this.pass(
        drift,
        dst,
        {
          memory: at(flow.memory, strain)[this.flowM].texture,
          pressureIn: at(at(flow.pressure, strain), this.flowP).texture,
          rates: at(sinks.rates, strain)[this.sr].texture,
          state: sinks.state[this.st].texture,
        },
        {},
      );
    }
    gl.colorMask(true, true, true, true);
    this.flowBlock(flow, 0);
  }

  /**
   * The target of the test of growth while the rules of stage 4 run (growth.frag PASS 2, ADR 0071): the agents `dst`
   * and the keys of the paid births, as the two targets of one framebuffer, made at its first use for each copy of the
   * agents.
   */
  private withKeys(dst: Target, sinks: GlSinks): Target {
    const gl = this.gl;
    let fbo = this.keyFbos.get(dst.texture);
    if (!fbo) {
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst.texture, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, sinks.keys.texture, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteFramebuffer(fbo);
        throw new Error('The test of growth cannot write the agents and the keys of the paid births at once');
      }
      this.keyFbos.set(dst.texture, fbo);
    }
    return { ...dst, fbo };
  }

  /**
   * The sink rates of the step before for the samplers `rates` to `rates3` of growth.frag PASS 2 (ADR 0071): strain A
   * in the place of a strain that the scene does not have.
   */
  private ratesOf(sinks: GlSinks): Record<string, WebGLTexture> {
    const rate = (s: number) => (sinks.rates[s] ?? at(sinks.rates, 0))[this.sr].texture;
    return { rates: rate(0), rates1: rate(1), rates2: rate(2), rates3: rate(3) };
  }

  /**
   * The sinks of a strain and its state (sinks.frag, ADR 0069), after the update of its flow and before its pressure,
   * with the block of the strain bound: `memory` is its memory after the update, `ports` the ports of the step. The
   * next copies of the rates and of the state become the current ones after the last strain (encodeFlow()).
   */
  private encodeSinks(
    stage4: { territory: { copies: Pair<Target>; owners: Target }; sinks: GlSinks },
    strain: number,
    memory: WebGLTexture,
    ports: WebGLTexture,
  ) {
    const gl = this.gl;
    const programs = this.prog.sinks();
    const { territory, sinks } = stage4;
    const rates = at(sinks.rates, strain);
    const next = rates[flip(this.sr)];
    this.pass(
      programs.sinks,
      next,
      {
        env: this.env.texture,
        owners: territory.owners.texture,
        territory: territory.copies[this.tt].texture,
        stamps: this.ensureSlime().stamps.texture,
        memory,
        ratesIn: rates[this.sr].texture,
        // The ports of the step: the test of the tube of a sink (ADR 0072).
        ports,
      },
      {},
    );
    // The pyramid of the sums: the first level from the rates, each level above from the one below it.
    const levels = at(sinks.levels, strain);
    levels.forEach((level, k) => {
      const below = levels[k - 1];
      if (!below) this.pass(programs.first, level, { rates: next.texture, memory }, {});
      else
        this.pass(programs.level, level, { below: below.texture }, {}, (p) => {
          gl.uniform2i(p.loc('belowSize'), below.width, below.height);
        });
    });
    // The state of the strain: its two texels of the next copy.
    const out = sinks.state[flip(this.st)];
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.viewport(0, strain, 2, 1);
    const state = programs.state;
    gl.useProgram(state.program);
    const sums = at(levels, levels.length - 1).texture;
    const stateIn = sinks.state[this.st].texture;
    textures(gl, state.program, { sums, ports, stateIn, paidCounts: sinks.counts.texture });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** For tests: the sink rates of a strain, with a minus sign for a sink of the last step (../sim.ts readSinks()). */
  readSinks(strain = 0): Promise<Float32Array> {
    const n = this.width * this.height;
    const rates = this.sinks?.rates[strain];
    if (!rates) return Promise.resolve(new Float32Array(n));
    const rgba = readTarget(this.gl, rates[this.sr]);
    return Promise.resolve(Float32Array.from({ length: n }, (_, i) => rgba[i * 4] ?? 0));
  }

  /** For tests: the sums of each strain of the last step, the top of its pyramid (../sim.ts readSinkSums()). */
  readSinkSums(): Promise<Uint32Array> {
    const out = new Uint32Array(SINK_SUM_WORDS * flowStrains(this.settings));
    this.sinks?.levels.forEach((levels, strain) => {
      out.set(readUint4Target(this.gl, at(levels, levels.length - 1)), strain * SINK_SUM_WORDS);
    });
    return Promise.resolve(out);
  }

  /** For tests: the state of each strain of the last step (../sim.ts readSinkState()). */
  readSinkState(): Promise<Float32Array> {
    if (!this.sinks) return Promise.resolve(new Float32Array(SINK_STATE_LANES * flowStrains(this.settings)));
    return Promise.resolve(readTarget(this.gl, this.sinks.state[this.st]) as Float32Array);
  }

  /** For tests: replaces the state of each strain (Sim.writeSinkState()), while the rules of stage 4 run. */
  writeSinkState(data: Float32Array) {
    if (!territoryOn(this.settings)) return;
    const sinks = this.ensureSinks();
    const lanes = data.subarray(0, SINK_STATE_LANES * sinks.strains);
    writeTarget(this.gl, sinks.state[this.st], 0, 0, 2, sinks.strains, lanes);
  }

  /** For tests: the keys of the paid births of the last growth step, by agent (../sim.ts readPaidKeys()). */
  readPaidKeys(): Promise<Float32Array> {
    if (!this.sinks) return Promise.resolve(new Float32Array(0));
    const rgba = readTarget(this.gl, this.sinks.keys);
    return Promise.resolve(Float32Array.from({ length: this.agents }, (_, i) => rgba[i * 4] ?? 0));
  }

  /** For tests: the counts of the last step that settle the budget (../sim.ts readPaidCounts(); ADR 0100). */
  readPaidCounts(): Promise<Uint32Array> {
    const strains = flowStrains(this.settings);
    if (!this.sinks) return Promise.resolve(new Uint32Array(PAID_COUNT_LANES * strains));
    const rgba = readTarget(this.gl, this.sinks.counts);
    const n = this.sinks.strains;
    return Promise.resolve(
      Uint32Array.from(
        { length: PAID_COUNT_LANES * n },
        (_, k) => rgba[(k % PAID_COUNT_LANES) * 4 + Math.floor(k / PAID_COUNT_LANES)] ?? 0,
      ),
    );
  }

  /** For tests: replaces the sink rates of a strain, one float per cell (Sim.writeSinks()), while the rules run. */
  writeSinks(data: Float32Array, strain = 0) {
    if (!territoryOn(this.settings)) return;
    const rates = this.ensureSinks().rates[strain];
    if (rates) writeTarget(this.gl, rates[this.sr], 0, 0, this.width, this.height, data);
  }

  /** The start territory (Sim.addTerritory(); PASS 1 of territory.frag). Nothing while the rules do not run. */
  addTerritory(strain: number, x: number, y: number, radius: number) {
    if (!territoryOn(this.settings)) return;
    const gl = this.gl;
    const { copies } = this.ensureTerritory();
    this.writeParams();
    const p = this.prog.territory().disc;
    const tex = { territory: copies[this.tt].texture, env: this.env.texture };
    this.pass(p, copies[flip(this.tt)], tex, {}, (prog) => {
      gl.uniform4f(prog.loc('disc'), x, y, radius, strain);
    });
    this.tt = flip(this.tt);
  }

  /** For tests and measurements: the territory, one byte per cell (Sim.readTerritory()). */
  readTerritory(): Promise<Uint8Array> {
    if (!this.territory) return Promise.resolve(new Uint8Array(this.width * this.height));
    return Promise.resolve(Uint8Array.from(readUintTarget(this.gl, this.territory.copies[this.tt])));
  }

  /** For tests: the owners of the last step, one byte per cell (Sim.readOwners()). */
  readOwners(): Promise<Uint8Array> {
    if (!this.territory) return Promise.resolve(new Uint8Array(this.width * this.height));
    return Promise.resolve(Uint8Array.from(readUintTarget(this.gl, this.territory.owners)));
  }

  /** For tests: replaces the territory, one byte per cell (Sim.writeTerritory()), while the rules of stage 4 run. */
  writeTerritory(data: Uint8Array) {
    if (!territoryOn(this.settings)) return;
    const gl = this.gl;
    const t = this.ensureTerritory().copies[this.tt];
    // Rows of one byte per cell: no row needs to start at a multiple of 4.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    writeTarget(gl, t, 0, 0, this.width, this.height, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  /**
   * The flow in the tubes after the diffusion of a step (flow.frag; encodeFlow in ../sim.ts, ADR 0029): the update of
   * the memory from the pressure and the trail of this step, then the pressure iterations on the new conductivity.
   * Once per strain, each with its own targets and its own block (ADR 0031).
   */
  private encodeFlow(
    flow: NonNullable<GlSim['flow']>,
    stage4?: { territory: { copies: Pair<Target>; owners: Target }; sinks: GlSinks },
  ) {
    const programs = this.prog.flow();
    // While the rules of stage 4 run, the update and the pressure that take the sinks (TERRITORY in flow.frag, ADR
    // 0070): the update reads the current copy of the state, whether the front took flux in the step before; the
    // pressure reads the next copies of the rates and of the state, which encodeSinks() writes for its strain.
    const taking = stage4 ? this.prog.sinks() : undefined;
    // Over 8 neighbours (EIGHT in flow.frag, ADR 0086), the update and the pressure of that variant, with the sinks or
    // without them.
    const eight = flowEight(this.settings) ? this.prog.flowEight(stage4 !== undefined) : undefined;
    const update = eight?.update ?? taking?.update ?? programs.update;
    const iterate = eight?.pressure ?? taking?.pressure ?? programs.pressure;
    const env = this.env.texture;
    const [m, next] = [this.flowM, flip(this.flowM)];
    let p = this.flowP;
    // The port of every site and strain, from the memory before the step (PASS 2 to 4 of flow.frag): the hits of the
    // blocks of the list of cells, the lanes of each site, and the least of them. The block of the first strain has the
    // sites of all.
    this.flowBlock(flow, 0);
    const { cells, hits, hitRows } = this.siteCells(flow);
    const before = flow.ports[flow.port];
    flow.port = flip(flow.port);
    const ports = flow.ports[flow.port];
    const memoryOf = (strain: number) => (flow.memory[strain] ?? at(flow.memory, 0))[m].texture;
    const memories = { memory: memoryOf(0), memory1: memoryOf(1), memory2: memoryOf(2), memory3: memoryOf(3) };
    this.pass(programs.blocks, hits, { env, ...memories, cells: cells.texture }, { hitRows });
    this.pass(programs.lanes, flow.lanes, { hits: hits.texture }, { hitRows });
    this.pass(programs.sites, ports, { cells: cells.texture, lanes: flow.lanes.texture, portsIn: before.texture }, {});
    flow.memory.forEach((memories, strain) => {
      const pressure = at(flow.pressure, strain);
      this.flowBlock(flow, strain);
      p = this.flowP;
      const took = stage4 ? { state: stage4.sinks.state[this.st].texture } : {};
      this.pass(
        update,
        memories[next],
        {
          env,
          memory: memories[m].texture,
          pressureIn: at(pressure, p).texture,
          trail: this.trail[this.p].texture,
          ports: ports.texture,
          ...took,
        },
        {},
      );
      const memory = memories[next].texture;
      // While the rules of stage 4 run, the sinks of the strain from its memory after the update (ADR 0069).
      if (stage4) this.encodeSinks(stage4, strain, memory, ports.texture);
      const sinks = stage4
        ? {
            rates: at(stage4.sinks.rates, strain)[flip(this.sr)].texture,
            state: stage4.sinks.state[flip(this.st)].texture,
          }
        : {};
      for (let i = 0; i < FLOW_ITERATIONS; i++) {
        const [behind, out] = [(p + 2) % 3, (p + 1) % 3];
        this.pass(
          iterate,
          at(pressure, out),
          {
            env,
            memory,
            pressureIn: at(pressure, p).texture,
            pressureBefore: at(pressure, behind).texture,
            ports: ports.texture,
            ...sinks,
          },
          // The first two iterations take the pressure of the reference cell off (RECENTRE in flow.wgsl).
          { recentre: i < 2 ? i + 1 : 0 },
        );
        p = out;
      }
    });
    this.flowM = next;
    this.flowP = p;
    if (stage4) {
      this.sr = flip(this.sr);
      this.st = flip(this.st);
    }
  }

  /**
   * Growth and shrinkage after the moves of a test step (growth.frag, growth.vert; growth.wgsl in sim.ts, ADR 0025).
   * The current occupancy is the one after the moves: it gives the window counts and the empty cells. The agents
   * pass through the tests, and on a growth step through the claims, the pyramids and the births. Then the occupancy
   * is counted anew for the next step.
   */
  private encodeGrowth(grow: boolean, territory: Record<string, WebGLTexture>, sinks: GlSinks | undefined) {
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
    // With the flow in the tubes, the test in which an agent on a starved cell does not divide and no child is born
    // onto one (FLOW in growth.frag, ADR 0029 and ADR 0053): it reads the flow memory that the agent pass of the step
    // read.
    const flow = flowOn(this.settings) ? this.flow : undefined;
    const flowMemory: Record<string, WebGLTexture> = flow ? this.flowMemories(flow) : {};
    // With the rules of stage 4, the test in which a child is born only onto the territory (TERRITORY in growth.frag,
    // ADR 0068): it reads the territory that the agent pass of the step read. It also marks the agents of the front of
    // the births that the flux pays and writes their keys, from the sink rates of the step before (ADR 0071).
    const paid = territory.territory ? sinks : undefined;
    const test = paid ? this.prog.territory().test : flow ? this.prog.growthFlowing() : p.test;
    this.pass(
      test,
      paid ? this.withKeys(tested, paid) : tested,
      {
        agentsIn: this.agentsTex[this.a].texture,
        windows,
        occ,
        env,
        ...flowMemory,
        ...territory,
        ...(paid ? this.ratesOf(paid) : {}),
      },
      {
        agentWidth,
      },
    );
    this.a = flip(this.a);
    // The sum P of the rates of the agents with a key, which the rank reads (paid.vert SHARE, ADR 0100, part A).
    if (grow && paid) this.countShare(paid);
    if (grow && paid) {
      // The rank of the paid births (PASS 5): a paid parent marks GROWS, PAID and the neighbour of its child, and the
      // points below claim the neighbour for it. It reads the budget of the state of the step before.
      const stage4 = this.prog.territory();
      this.pass(
        stage4.rank,
        this.agentsTex[flip(this.a)],
        {
          agentsIn: this.agentsTex[this.a].texture,
          keys: paid.keys.texture,
          occ,
          env,
          ...flowMemory,
          ...territory,
          state: paid.state[this.st].texture,
          paidCounts: paid.counts.texture,
        },
        { agentWidth },
      );
      this.a = flip(this.a);
    }
    if (paid) {
      // F, K, the parents of Jones' rule that wait and the deaths by shrinkage of the step (paid.vert, ADR 0100).
      this.countPaid(paid, this.agentsTex[this.a], [MARKS.front, MARKS.paid, MARKS.jones, MARKS.crowded]);
    }
    if (grow && paid) {
      // The parents of Jones' rule that the budget pays (PASS 6, ADR 0100): they mark GROWS.
      const stage4 = this.prog.territory();
      this.pass(
        stage4.jones,
        this.agentsTex[flip(this.a)],
        {
          agentsIn: this.agentsTex[this.a].texture,
          state: paid.state[this.st].texture,
          paidCounts: paid.counts.texture,
        },
        { agentWidth },
      );
      this.a = flip(this.a);
    }
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
        paid ? this.prog.territory().birth : p.birth,
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
        },
      );
      this.a = flip(this.a);
      // The births of the step (paid.vert, ADR 0100).
      if (paid) this.countPaid(paid, this.agentsTex[this.a], [MARKS.born]);
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
      const [w, h] = [this.width, this.height];
      this.growth = allOrNothing(gl, (keep) => {
        const make = (width: number, height: number, format: number) => keep(target(gl, width, height, format));
        const pyramid = (n: number, width: number, format: number): Pyramid => {
          const { sizes, rows, heights, top } = pyramidLayout(n, width);
          const textures: Pair<Target> = [
            make(width, Math.max(1, heights[0] ?? 0), format),
            make(width, Math.max(1, heights[1] ?? 0), format),
          ];
          return { textures, width, sizes, rows, top };
        };
        return {
          rows: make(w, h, gl.RG32F),
          windows: make(w, h, gl.RG32F),
          claims: make(w, h, gl.R32F),
          births: make(w, h, gl.RG32F),
          cells: pyramid(w * h, w, gl.RGBA32F),
          dead: pyramid(this.agents, this.agentWidth, gl.R32F),
        };
      });
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
