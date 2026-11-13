import { BOUNDARIES, type Boundary, type Settings } from '../model/params';
import { at } from './at';
import { outlineBox, ownHeldEverywhere, paintBox, paintSegments, type Rect } from './brush';
import { FLOW, FLOW_BYTES, FLOW_ITERATIONS, flowOn, flowSites, flowStrains, packFlow } from './flow';
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
} from './pack';
import { readBuffer, readTexture } from './readback';
import agentsWgsl from './shaders/agents.wgsl?raw';
import common from './shaders/common.wgsl?raw';
import diffuseWgsl from './shaders/diffuse.wgsl?raw';
import flowWgsl from './shaders/flow.wgsl?raw';
import growthWgsl from './shaders/growth.wgsl?raw';
import initWgsl from './shaders/init.wgsl?raw';
import paintWgsl from './shaders/paint.wgsl?raw';
import sortWgsl from './shaders/sort.wgsl?raw';
import tubesWgsl from './shaders/tubes.wgsl?raw';
import { variant } from './shaders/variant';
import wallsWgsl from './shaders/walls.wgsl?raw';
import { diffusePlan, viewTrailOn, type Diffuse } from './sizing';
import { TUBES, tubesShown } from './tubes';
import { EnvKind, SHAPE_RANGE, type AgentState, type Sim, type Stroke } from './types';

const AGENT_BYTES = 16;
const GROUP = 256;
const TILE = 16;
/** Brush segments per submission (paint()): 4096 slots of 256 bytes. */
const BRUSH_CHUNK = 4096;
/** One brush slot as paint.wgsl `Brush` reads it: the segment, its paint box and its outline box. */
const BRUSH_BYTES = 48;
/** The narrowest eraser with a workgroup of 16 × 16 cells more than 4.05 cells inside it (paint.wgsl eraserCore). */
const CORE_RADIUS = 10.61 + SHAPE_RANGE + 0.05;
/** Steps between two spatial sorts of the agents. Measured: their locality halves about 150 steps after a sort. */
const SORT_INTERVAL = 32;
/** Cells per side of a sort tile (sort.wgsl SHIFT). */
const SORT_TILE = 8;
/** Cells per side of a workgroup of the flow passes (flow.wgsl). */
const FLOW_GROUP = 8;
/** Cells per side of a workgroup of the passes of the picture of the tubes (tubes.wgsl). */
const TUBE_GROUP = 8;

type Pair<T> = [T, T];
type Bit = 0 | 1;
const flip = (b: Bit): Bit => (b === 0 ? 1 : 0);

/** The buffers of growth and shrinkage (growth.wgsl), allocated while growth is on. */
interface GrowthBuffers {
  rows: GPUBuffer;
  windows: GPUBuffer;
  claims: GPUBuffer;
  births: GPUBuffer;
  cellSums: GPUBuffer;
  dead: GPUBuffer;
  deadSums: GPUBuffer;
  /** One uniform per pyramid level that a build pass writes (growth.wgsl `level`). */
  levels: GPUBuffer[];
}
/**
 * The state of the flow in the tubes (flow.wgsl, ADR 0029), allocated while the flow is on: the memory of each cell
 * (flow memory, tube body, conductivity, roles) in two textures that the update pass writes in turn, the pressure of
 * the four lanes in three textures (the one in work, the one before as momentum, the one that an iteration writes), and
 * the uniform block of the passes. Every strain has a flow of its own (ADR 0031): each texture has a layer per strain,
 * and each strain has its uniform block.
 */
interface FlowState {
  /** The strains of the settings that the state was made for: the layers of every texture. */
  strains: number;
  memory: Pair<GPUTexture>;
  /** Every layer of each memory texture, for the agent passes and growth: an agent reads the layer of its strain. */
  memoryArrays: Pair<GPUTextureView>;
  /** Per strain: its layer of each memory texture, for the passes of the flow. */
  memoryViews: Pair<GPUTextureView>[];
  pressure: GPUTexture[];
  /** Per strain: its layer of each pressure texture. */
  pressureViews: GPUTextureView[][];
  /** Per strain: the uniform block of its passes (flow.ts packFlow()). */
  uniforms: GPUBuffer[];
}
/**
 * The textures of the picture of the tubes (tubes.wgsl, ADR 0034), allocated while the settings show it: per cell and
 * strain the factor of the radius of its tube, and the trail that the view draws.
 */
interface TubeState {
  roots: GPUTexture;
  rootsView: GPUTextureView;
  picture: GPUTexture;
  pictureView: GPUTextureView;
}
/** A trail and a scent texture with their views: the view's pairs (viewTextures). */
interface ViewPair {
  trail: GPUTexture;
  trailView: GPUTextureView;
  scent: GPUTexture;
  scentView: GPUTextureView;
}

/** All simulation state on the GPU for one grid size and agent count (WebGPU). */
export class Simulation implements Sim {
  step = 0;
  /**
   * Counts the changes of the trail, the scent and the shape outside steps (reset, strokes, clearing, writes, a new
   * hold of the shape); `step` counts the steps. Together they tell when a picture or a map made from them is old: the
   * frame on screen (Engine.frame), the scent view's coarse map and the trail's coarse map (render.ts).
   */
  revision = 0;
  private parity: Bit = 0;
  private occParity: Bit = 0;
  private settings: Settings;
  private readonly paramData = new ArrayBuffer(PARAMS_BYTES);
  private readonly params: GPUBuffer;
  /** The parameters once per boundary, for brush strokes (paint()): a stroke picks its boundary by offset. */
  private readonly paintParams: GPUBuffer;
  /** Brush segments, one per uniform offset step (paint()). */
  private readonly brushes: GPUBuffer;
  private readonly offsetStep: number;
  /** Two agent buffers: the sort writes into the other one (ping-pong, no copy back). */
  private readonly agentBuffers: Pair<GPUBuffer>;
  /** Which agent buffer is current. Every bind group that holds one has it in its cache key. */
  private agentParity: Bit = 0;
  /** Agents per sort tile, then offsets and cursors (sort.wgsl). */
  private readonly tiles: GPUBuffer;
  /** The new agent for writeAgent() (agents.wgsl `replace`). */
  private readonly replacement: GPUBuffer;
  /** Sort the agents by position every this many steps; 0 never (measurements and tests). */
  sortInterval = SORT_INTERVAL;
  /** The step whose sort has run already, ahead of it (sortNow()); −1: none. */
  private sortedFor = -1;
  readonly trail: Pair<GPUTexture>;
  readonly scent: Pair<GPUTexture>;
  private readonly trailViews: Pair<GPUTextureView>;
  private readonly scentViews: Pair<GPUTextureView>;
  /** The view's third trail and scent, for the view of a step that moves first with two diffusion passes or more. */
  private viewThird?: ViewPair | undefined;
  /** The textures that hold the view's map (viewTextures), and whether a change of the state since made it stale. */
  private viewOut?: { trail: GPUTexture; scent: GPUTexture } | undefined;
  private viewStale = true;
  /** The picture of the tubes (pictureTexture), and whether a change of the state since made it stale. */
  private tubes?: TubeState | undefined;
  private tubesStale = true;
  readonly counts: GPUBuffer;
  readonly env: GPUBuffer;
  /** Outline distances, light and the walls' shadow, for the renderer only (paint.wgsl `outline`). */
  private readonly shapeBuffer: GPUBuffer;
  /**
   * False until something other than the eraser is painted after the last clear; the renderer then skips the
   * environment.
   */
  hasEnvironment = false;
  /**
   * The boundary under which every byte of `shape` is held to `env`. After a change of boundary, or after strokes
   * painted under another boundary (then undefined), syncShape() holds it again before its next use.
   */
  private shapeHeld: Boundary | undefined;
  readonly stats: GPUBuffer;
  private collision?: { occ: Pair<GPUBuffer>; claims: GPUBuffer };
  /** The buffers of growth and shrinkage, while growth is on (ADR 0025). */
  private growth?: GrowthBuffers | undefined;
  /** The state of the flow in the tubes, while it is on (ADR 0029). */
  private flow?: FlowState | undefined;
  /** Which memory texture is current, and which pressure texture holds the pressure in work. */
  private flowM: Bit = 0;
  private flowP = 0;
  /** The food sites that give and take the flux (foodSites()). */
  private sites: [number, number][] = [];
  private readonly flowData = new ArrayBuffer(FLOW_BYTES);
  private paintGroup?: GPUBindGroup;
  /**
   * A wall was painted since the last clear: moves and sensors then check every cell they cross (agents.wgsl
   * clearPath, ADR 0020).
   */
  private walls = false;
  /**
   * A food or a light may lie in `env`: a stroke painted one, or bytes written held one, since the last clear.
   */
  private sources = false;
  /**
   * The scent textures hold only zeros, and no step can change that: a reset cleared them while `env` held no food
   * and no light. The agent and diffusion passes then read the scent from a texture of one texel, `noScent`
   * (ADR 0028): 3 of an agent's 6 sensor reads and the scent of every cell came from a texture of zeros as large as the
   * grid. The passes and their arithmetic stay as they are, and they still write the scent of every cell: zeros, as
   * before. The passes read the texel of a cell, which lies outside a texture of one texel for every cell but (0, 0).
   * For such a read of a texture that is no depth texture, WGSL (`textureLoad`) gives the data of some texel inside
   * it, or (0, 0, 0, 0) or (0, 0, 0, 1). The scent is `rg32float`, and both readers take only `.xy`
   * (agents.wgsl `sense()`, diffuse.wgsl `diffuse`): the one texel holds 0 there, and so does each of the two vectors,
   * so every result that WGSL allows is 0. A reader of `.w` could get 1.
   */
  scentless = false;
  /** One texel of zeros: the scent while `scentless`. */
  private readonly noScent: GPUTexture;
  private readonly noScentView: GPUTextureView;
  /** Per clearance tile: whether it holds a wall cell, and how far the nearest wall lies at least (walls.wgsl). */
  private readonly walled: GPUBuffer;
  private readonly clearance: GPUBuffer;
  private readonly clearTiles: [number, number];
  private readonly groups: [number, number];
  private readonly bindCache = new Map<string, GPUBindGroup>();

  private constructor(
    readonly device: GPUDevice,
    private readonly kernels: Kernels,
    settings: Settings,
    readonly width: number,
    readonly height: number,
    readonly agents: number,
    /** Agents alive at the start: fewer than `agents` when the capacity holds more (ADR 0025). */
    readonly start: number,
  ) {
    this.settings = settings;
    this.shapeHeld = settings.boundary;
    const { STORAGE, COPY_SRC, COPY_DST, UNIFORM } = GPUBufferUsage;
    const cells = width * height;
    const buffer = (size: number, usage: number) => device.createBuffer({ size, usage });
    this.params = buffer(PARAMS_BYTES, UNIFORM | COPY_DST);
    this.offsetStep = device.limits.minUniformBufferOffsetAlignment;
    this.paintParams = buffer(BOUNDARIES.length * this.paramsStep, UNIFORM | COPY_DST);
    this.brushes = buffer(BRUSH_CHUNK * this.offsetStep, UNIFORM | COPY_DST);
    this.agentBuffers = [
      buffer(agents * AGENT_BYTES, STORAGE | COPY_SRC | COPY_DST),
      buffer(agents * AGENT_BYTES, STORAGE | COPY_SRC | COPY_DST),
    ];
    const tiles = Math.ceil(width / SORT_TILE) * Math.ceil(height / SORT_TILE);
    this.tiles = buffer(tiles * 4, STORAGE | COPY_DST);
    this.replacement = buffer(AGENT_BYTES, UNIFORM | COPY_DST);
    this.counts = buffer(cells * 16, STORAGE | COPY_SRC | COPY_DST);
    this.env = buffer(cells * 4, STORAGE | COPY_SRC | COPY_DST);
    this.shapeBuffer = buffer(cells * 4, STORAGE | COPY_SRC | COPY_DST);
    this.stats = buffer(16, STORAGE | COPY_SRC | COPY_DST);
    this.clearTiles = [Math.ceil(width / CLEAR_TILE), Math.ceil(height / CLEAR_TILE)];
    this.walled = buffer(this.clearTiles[0] * this.clearTiles[1] * 4, STORAGE);
    this.clearance = buffer(this.clearTiles[0] * this.clearTiles[1] * 4, STORAGE);
    const texture = (format: GPUTextureFormat) =>
      device.createTexture({
        size: [width, height],
        format,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST,
      });
    this.trail = [texture('rgba32float'), texture('rgba32float')];
    this.scent = [texture('rg32float'), texture('rg32float')];
    this.trailViews = [this.trail[0].createView(), this.trail[1].createView()];
    this.scentViews = [this.scent[0].createView(), this.scent[1].createView()];
    // A new texture holds zeros.
    this.noScent = device.createTexture({ size: [1, 1], format: 'rg32float', usage: GPUTextureUsage.TEXTURE_BINDING });
    this.noScentView = this.noScent.createView();
    const n = Math.ceil(agents / GROUP);
    const x = Math.min(n, device.limits.maxComputeWorkgroupsPerDimension);
    this.groups = [x, Math.ceil(n / x)];
    // Now, inside the caller's out-of-memory scope, even while collisions are off: the budget counts them.
    this.ensureCollision();
  }

  /**
   * `agentsSource`, `diffuseSource` and `initSource` replace shaders/agents.wgsl, shaders/diffuse.wgsl and
   * shaders/init.wgsl, for tests that compare the passes with another version of them. `start`: the agents alive at the
   * start (ADR 0025).
   */
  static async create(
    device: GPUDevice,
    settings: Settings,
    width: number,
    height: number,
    agents: number,
    agentsSource = agentsWgsl,
    diffuseSource = diffuseWgsl,
    start = agents,
    initSource = initWgsl,
  ) {
    const kernels = await Kernels.get(device, agentsSource, diffuseSource, initSource);
    const sim = new Simulation(device, kernels, settings, width, height, agents, Math.min(start, agents));
    sim.reset();
    return sim;
  }

  get current(): { trail: GPUTexture; scent: GPUTexture } {
    return { trail: this.trail[this.parity], scent: this.scent[this.parity] };
  }

  /**
   * The trail and scent that the view draws (ADR 0027): the map after the step's diffusion. Sensing first the textures
   * hold it, and the view draws them. Moving first they hold the map as the agents sense it, before its diffusion; the
   * step's diffusion passes without its sources and its cut (diffuse.wgsl VIEW) then write the map after the diffusion,
   * trail and scent, into the free textures of the pair and, from a second pass on, into a third pair. The simulation
   * reads neither: its next step writes the free textures anew. Made once for each state, at the first frame or
   * readback that draws it. The scent view's coarse map keys on the step and on `revision`, which update() counts.
   */
  get viewTextures(): { trail: GPUTexture; scent: GPUTexture } {
    if (this.settings.stepOrder === 'sense-first') return this.current;
    if (this.viewStale || !this.viewOut) this.encodeView();
    return this.viewOut ?? this.current;
  }

  /** The trail of viewTextures. */
  get viewTexture(): GPUTexture {
    return this.viewTextures.trail;
  }

  /** The passes of viewTextures: the step's diffusion plan, the input the map as the agents sense it. */
  private encodeView() {
    this.writeParams();
    const p = this.parity;
    const free = flip(p);
    const occ = this.ensureCollision().occ[this.occParity];
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    const pair = (b: Bit): ViewPair => ({
      trail: this.trail[b],
      trailView: this.trailViews[b],
      scent: this.scent[b],
      scentView: this.scentViews[b],
    });
    let input = pair(p);
    diffusePlan(this.settings.diffusion).forEach((v, i) => {
      // Even passes write the free pair, odd passes the third, so no pass reads what it writes.
      const out = i % 2 === 1 ? this.ensureViewThird() : pair(free);
      const pipeline = this.kernels.view(v);
      const key = `view${+v.first}${+v.last}${+v.blur}${i % 2}${p}${this.occParity}${+this.scentless}`;
      let group = this.bindCache.get(key);
      if (!group) {
        const resources = [
          this.params,
          input.trailView,
          this.scentless ? this.noScentView : input.scentView,
          out.trailView,
          out.scentView,
          this.env,
          this.counts,
          occ,
        ];
        group = this.device.createBindGroup({
          layout: this.kernels.diffuseLayout,
          entries: resources.map((r, binding) => entry(binding, r)),
        });
        this.bindCache.set(key, group);
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(this.width / TILE), Math.ceil(this.height / TILE));
      input = out;
    });
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.viewOut = { trail: input.trail, scent: input.scent };
    this.viewStale = false;
  }

  /** The view's third trail and scent, made at their first use (sizing.ts VIEW_BYTES_PER_CELL counts them). */
  private ensureViewThird(): ViewPair {
    if (!this.viewThird) {
      const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC;
      const size = [this.width, this.height];
      const trail = this.device.createTexture({ size, format: 'rgba32float', usage });
      const scent = this.device.createTexture({ size, format: 'rg32float', usage });
      this.viewThird = { trail, trailView: trail.createView(), scent, scentView: scent.createView() };
    }
    return this.viewThird;
  }

  /** A change of the state: the view's map and the picture of the tubes are made anew at their next use. */
  private changed() {
    this.viewStale = true;
    this.tubesStale = true;
  }

  /**
   * The trail that the picture draws. Without the picture of the tubes that is the view's trail (viewTexture). While
   * the settings show the tubes (tubes.ts tubesShown()) and the flow holds a state, it is the trail with every tube as
   * wide and as bright as its flow memory says (tubes.wgsl, ADR 0034). Made once for each state, at the first frame or
   * readback that draws it. Display only: no pass of the simulation reads it.
   */
  get pictureTexture(): GPUTexture {
    if (!tubesShown(this.settings) || !this.flow) return this.viewTexture;
    if (this.tubesStale || !this.tubes) return this.encodeTubes(this.flow).picture;
    return this.tubes.picture;
  }

  /** The passes of pictureTexture: the factor of the radius of every tube, then the picture. */
  private encodeTubes(flow: FlowState): TubeState {
    this.syncShape();
    // Before the parameters of these passes: moving first the view's passes write theirs (encodeView()).
    const trail = this.viewTexture;
    this.writeParams();
    const tubes = this.ensureTubes();
    // The trail of the view: one of the pair, or the view's third.
    const from = trail === this.trail[0] ? 0 : trail === this.trail[1] ? 1 : 2;
    const trailView = from === 2 ? this.ensureViewThird().trailView : this.trailViews[from];
    const k = this.kernels.tubes();
    const groups = [Math.ceil(this.width / TUBE_GROUP), Math.ceil(this.height / TUBE_GROUP)] as const;
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(k.roots);
    pass.setBindGroup(
      0,
      this.bind(`tubeRoots${this.flowM}`, k.roots, [
        this.params,
        null,
        null,
        flow.memoryArrays[this.flowM],
        tubes.rootsView,
      ]),
    );
    pass.dispatchWorkgroups(...groups);
    pass.setPipeline(k.picture);
    pass.setBindGroup(
      0,
      this.bind(`tubePicture${from}`, k.picture, [
        this.params,
        trailView,
        this.shapeBuffer,
        null,
        null,
        tubes.rootsView,
        tubes.pictureView,
      ]),
    );
    pass.dispatchWorkgroups(...groups);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.tubesStale = false;
    return tubes;
  }

  /** The textures of the picture of the tubes, made at their first use (sizing.ts TUBES_BYTES_PER_CELL counts them). */
  private ensureTubes(): TubeState {
    if (!this.tubes) {
      const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC;
      const make = () => this.device.createTexture({ size: [this.width, this.height], format: 'rgba32float', usage });
      const [roots, picture] = [make(), make()];
      this.tubes = { roots, rootsView: roots.createView(), picture, pictureView: picture.createView() };
    }
    return this.tubes;
  }

  /** Frees the textures of the picture of the tubes, and every bind group that holds a part of the picture's passes. */
  private dropTubes() {
    this.tubes?.roots.destroy();
    this.tubes?.picture.destroy();
    this.tubes = undefined;
    this.forgetTubes();
  }

  /** Drops the bind groups of the picture's passes: they hold the memory of the flow and the trail of the view. */
  private forgetTubes() {
    for (const key of [...this.bindCache.keys()]) if (key.startsWith('tube')) this.bindCache.delete(key);
    this.tubesStale = true;
  }

  /** For tests: the trail that the picture draws (pictureTexture), 4 lanes per cell. */
  readPicture(): Promise<Float32Array> {
    return readTexture(this.device, this.pictureTexture, 4);
  }

  /** For tests: the factor of the radius of the tube of every cell and strain, 4 values per cell; empty without it. */
  async readTubeRoots(): Promise<Float32Array> {
    if (!tubesShown(this.settings) || !this.flow) return new Float32Array(0);
    const tubes = this.tubesStale || !this.tubes ? this.encodeTubes(this.flow) : this.tubes;
    return readTexture(this.device, tubes.roots, 4);
  }

  /** For tests: the trail map that the view draws (viewTexture), 4 lanes per cell. */
  readView(): Promise<Float32Array> {
    return readTexture(this.device, this.viewTextures.trail, 4);
  }

  /** For tests: the scent that the view draws (viewTextures), 2 values per cell. */
  readViewScent(): Promise<Float32Array> {
    return readTexture(this.device, this.viewTextures.scent, 2);
  }

  /** The agent buffer that holds the current state, in sort order (ids in `bits`, ADR 0005). */
  get agentBuffer(): GPUBuffer {
    return this.agentBuffers[this.agentParity];
  }

  /**
   * Agents per cell after the last step. Kept up to date only in collision mode, where the renderer reads it, and
   * while covered food is on (diffuse.wgsl COVERED).
   */
  get occupancy(): GPUBuffer {
    return this.ensureCollision().occ[this.occParity];
  }

  /** Outline distances, light and the walls' shadow for the renderer; call syncShape() before reading it. */
  get shape(): GPUBuffer {
    return this.shapeBuffer;
  }

  /**
   * Holds `shape` to `env` under the current boundary (paint.wgsl `refresh`), once after the boundary changed or
   * after strokes under another boundary (ADR 0019 replays each edit under its own): a dish counts fewer cells than
   * the box or the periodic grid, and the periodic grid has neighbours across its edges. Called before every
   * readback and frame, and by paint() after a change of boundary; it does nothing while `shape` is held.
   */
  syncShape() {
    if (this.shapeHeld === this.settings.boundary) return;
    this.revision++;
    this.shapeHeld = this.settings.boundary;
    if (!this.hasEnvironment) return; // nothing painted: `shape` holds only zeros, under every boundary
    this.writeParams();
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.kernels.refresh);
    pass.setBindGroup(0, this.bind('refresh', this.kernels.refresh, [this.params, this.env, null, this.shapeBuffer]));
    pass.dispatchWorkgroups(Math.ceil(this.width / TILE), Math.ceil(this.height / TILE));
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /** Applies new parameters. Grid size and agent count need a new Simulation instead. */
  update(settings: Settings) {
    const switchedOn = settings.collisions && !this.settings.collisions;
    // Moving first new settings make a new view of the same state, and the scent view's coarse map counts it as a change
    // of the scent (ADR 0027); the step after them changes the step count anyway.
    if (settings.stepOrder === 'move-first' || this.settings.stepOrder === 'move-first') this.revision++;
    this.settings = settings;
    this.changed();
    if (switchedOn) this.rebuildOccupancy();
    // The memory fit counts the view's third texture only while a step moves first with two passes or more.
    if (!viewTrailOn(settings) && this.viewThird) {
      this.viewThird.trail.destroy();
      this.viewThird.scent.destroy();
      this.viewThird = undefined;
      this.viewOut = undefined;
      for (const key of [...this.bindCache.keys()]) if (key.startsWith('view')) this.bindCache.delete(key);
      this.forgetTubes();
    }
    // The memory fit counts the textures of the picture of the tubes only while the settings show it (tubes.ts).
    if (!tubesShown(settings)) this.dropTubes();
    // The memory fit counts the textures of the flow only while it is on (sizing.ts).
    if (!flowOn(settings)) this.dropFlow();
    // The memory fit counts the buffers of growth only while it is on (sizing.ts).
    if (!growthOn(settings) && this.growth) {
      const g = this.growth;
      for (const b of [g.rows, g.windows, g.claims, g.births, g.cellSums, g.dead, g.deadSums, ...g.levels]) b.destroy();
      this.growth = undefined;
      for (const key of [...this.bindCache.keys()]) if (key.startsWith('grow')) this.bindCache.delete(key);
    }
  }

  reset() {
    this.changed();
    this.revision++;
    // The scent textures are cleared below, and without a food or a light no step adds scent.
    this.scentless = !this.sources;
    this.step = 0;
    this.sortedFor = -1;
    this.parity = 0;
    this.agentParity = 0;
    this.writeParams();
    const enc = this.device.createCommandEncoder();
    for (const t of [...this.trail, ...this.scent]) {
      enc
        .beginRenderPass({
          colorAttachments: [{ view: t.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
        })
        .end();
    }
    enc.clearBuffer(this.counts);
    if (this.flow) this.clearFlow(enc, this.flow);
    const pass = enc.beginComputePass();
    const init = this.starts().init;
    pass.setPipeline(init);
    pass.setBindGroup(
      0,
      this.bind(`init${this.agentParity}${this.start < this.agents ? 'c' : ''}`, init, [
        this.params,
        this.agentBuffer,
        null,
        null,
        this.env,
      ]),
    );
    pass.dispatchWorkgroups(...this.groups);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    if (this.settings.collisions) {
      this.placeOnFreeCells();
      this.rebuildOccupancy();
    }
    this.countAlive();
  }

  /** The alive agents per strain into `stats`, which alive() reads, before the first step (init.wgsl census). */
  private countAlive() {
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.stats);
    const pass = enc.beginComputePass();
    pass.setPipeline(this.kernels.census);
    pass.setBindGroup(
      0,
      this.bind(`census${this.agentParity}`, this.kernels.census, [
        this.params,
        this.agentBuffer,
        null,
        null,
        null,
        null,
        this.stats,
      ]),
    );
    pass.dispatchWorkgroups(...this.groups);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /**
   * One agent per cell from the first step (ADR 0008): claim rounds after init (init.wgsl, startRounds()). Each
   * round needs its number in the parameters, so it is a submission of its own.
   */
  private placeOnFreeCells() {
    const col = this.ensureCollision();
    const q = flip(this.occParity);
    const occ = col.occ[q];
    const k = this.starts();
    const c = this.start < this.agents ? 'c' : '';
    const resources = [this.params, this.agentBuffer, null, null, this.env, null, null, occ, col.claims];
    const claim = this.bind(`claimStart${this.agentParity}${q}${c}`, k.claimStart, resources);
    const settle = this.bind(`settleStart${this.agentParity}${q}${c}`, k.settleStart, resources);
    const rounds = startRounds(this.settings, this.walls);
    for (let round = 0; round < rounds; round++) {
      this.writeParams(undefined, round);
      const enc = this.device.createCommandEncoder();
      if (round === 0) enc.clearBuffer(occ);
      enc.clearBuffer(col.claims);
      const pass = enc.beginComputePass();
      pass.setPipeline(k.claimStart);
      pass.setBindGroup(0, claim);
      pass.dispatchWorkgroups(...this.groups);
      pass.setPipeline(k.settleStart);
      pass.setBindGroup(0, settle);
      pass.dispatchWorkgroups(...this.groups);
      pass.end();
      this.device.queue.submit([enc.finish()]);
    }
  }

  /**
   * The start passes: with a capacity above the start population the ones that start only the first agents of each
   * strain (init.wgsl CAPACITY), else the ones of the code before (ADR 0025).
   */
  private starts(): Starts {
    return this.start < this.agents ? this.kernels.capacity() : this.kernels;
  }

  /**
   * The starts of the food strokes on this grid, in cells and in the order of the strokes (ADR 0029): the food sites
   * that give and take the flux of the flow in the tubes (flow.ts flowSites()). For a food dot the start is its
   * centre. The engine sets them after each paint.
   */
  foodSites(centres: readonly (readonly [number, number])[]) {
    this.sites = flowSites(centres, this.width, this.height);
  }

  /**
   * The textures and the uniform blocks of the flow, made at their first use (sizing.ts FLOW_BYTES_PER_CELL), with a
   * layer and a block per strain of the settings (ADR 0031). Settings with another number of strains get a new state.
   */
  private ensureFlow(): FlowState {
    const strains = flowStrains(this.settings);
    if (this.flow && this.flow.strains !== strains) this.dropFlow();
    if (!this.flow) {
      const usage =
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST;
      const size = [this.width, this.height, strains];
      const make = () => this.device.createTexture({ size, format: 'rgba32float', usage });
      const whole = (t: GPUTexture) => t.createView({ dimension: '2d-array' });
      const layer = (t: GPUTexture, strain: number) =>
        t.createView({ dimension: '2d', baseArrayLayer: strain, arrayLayerCount: 1 });
      const each = <T>(of: (strain: number) => T) => Array.from({ length: strains }, (_, strain) => of(strain));
      const memory: Pair<GPUTexture> = [make(), make()];
      const pressure = [make(), make(), make()];
      this.flow = {
        strains,
        memory,
        memoryArrays: [whole(memory[0]), whole(memory[1])],
        memoryViews: each((strain): Pair<GPUTextureView> => [layer(memory[0], strain), layer(memory[1], strain)]),
        pressure,
        pressureViews: each((strain) => pressure.map((t) => layer(t, strain))),
        uniforms: each(() =>
          this.device.createBuffer({ size: FLOW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        ),
      };
      const enc = this.device.createCommandEncoder();
      this.clearFlow(enc, this.flow);
      this.device.queue.submit([enc.finish()]);
    }
    return this.flow;
  }

  /** The start of the flow of every strain: every cell with the memory of fresh ground, no tube, no pressure. */
  private clearFlow(enc: GPUCommandEncoder, flow: FlowState) {
    const clear = (view: GPUTextureView, clearValue: number[]) => {
      enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue }] }).end();
    };
    for (const view of flow.memoryViews.flat()) clear(view, [FLOW.fresh, 0, 0, 0]);
    for (const view of flow.pressureViews.flat()) clear(view, [0, 0, 0, 0]);
    this.flowM = 0;
    this.flowP = 0;
  }

  /** Frees the state of the flow, and every bind group that holds a part of it. */
  private dropFlow() {
    if (!this.flow) return;
    for (const t of [...this.flow.memory, ...this.flow.pressure]) t.destroy();
    for (const b of this.flow.uniforms) b.destroy();
    this.flow = undefined;
    for (const key of [...this.bindCache.keys()]) if (key.includes('flow')) this.bindCache.delete(key);
    this.forgetTubes();
  }

  /** Whether the state of the flow holds this strain, and the settings hold it too (readFlow(), readPressure()). */
  private flowHolds(strain: number): boolean {
    return this.flow !== undefined && strain < Math.min(this.flow.strains, flowStrains(this.settings));
  }

  /**
   * For tests: the memory of the flow of a strain per cell (flow memory, tube body, conductivity, roles), 4 values
   * per cell; empty while the flow is off, and for a strain that the settings do not hold. The state follows a new
   * number of strains at the next step: until then it is empty for a strain that is new.
   */
  async readFlow(strain = 0): Promise<Float32Array> {
    if (!this.flow || !this.flowHolds(strain)) return new Float32Array(0);
    return readTexture(this.device, at(this.flow.memory, this.flowM), 4, strain);
  }

  /**
   * For tests: replaces the memory of the flow of a strain, 4 values per cell as readFlow() returns them. Only while
   * the flow is on, and for a strain of the settings.
   */
  writeFlow(data: Float32Array, strain = 0) {
    if (!flowOn(this.settings) || strain >= flowStrains(this.settings)) return;
    const texture = at(this.ensureFlow().memory, this.flowM);
    const size = [this.width, this.height];
    this.device.queue.writeTexture({ texture, origin: [0, 0, strain] }, data, { bytesPerRow: this.width * 16 }, size);
    // The picture of the tubes shows the memory (ADR 0034): a picture or a map made from the old one is old.
    this.changed();
    this.revision++;
  }

  /** For tests: the pressure of the four lanes of the flow of a strain, 4 values per cell; empty as readFlow(). */
  async readPressure(strain = 0): Promise<Float32Array> {
    if (!this.flow || !this.flowHolds(strain)) return new Float32Array(0);
    return readTexture(this.device, at(this.flow.pressure, this.flowP), 4, strain);
  }

  /** Runs `steps` simulation steps. The agent tool acts on every one of them (ADR 0023). */
  run(steps: number, tool?: AgentTool) {
    if (steps > 0) this.changed();
    for (let k = 0; k < steps; k++) {
      this.writeParams(tool);
      const enc = this.device.createCommandEncoder();
      this.encodeStep(enc);
      this.device.queue.submit([enc.finish()]);
      this.step++;
    }
  }

  /** The next step that sorts: the next multiple of the interval from the current step on. */
  private get sortStep() {
    return Math.ceil(this.step / this.sortInterval) * this.sortInterval;
  }

  sortDue(steps: number): boolean {
    if (this.sortInterval <= 0) return false;
    const next = this.sortStep;
    return next < this.step + steps && next !== this.sortedFor;
  }

  /**
   * The sort of the next step that sorts, now and in a submission of its own; that step then runs without it. The
   * agents may be a few steps away from that step: the sort only orders the buffer, and no result depends on the
   * order (ADR 0005).
   */
  sortNow() {
    if (this.sortInterval <= 0) return;
    this.writeParams();
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.tiles);
    const pass = enc.beginComputePass();
    this.encodeSort(pass);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.sortedFor = this.sortStep;
  }

  /** Bytes per copy of the parameters in paintParams: PARAMS_BYTES rounded up to the offset step. */
  private get paramsStep() {
    return Math.ceil(PARAMS_BYTES / this.offsetStep) * this.offsetStep;
  }

  /**
   * Paints brush strokes in order, BRUSH_CHUNK segments per submission. Each dispatch picks its brush and its
   * boundary's parameters by dynamic offset, so a replay of 100 000 strokes is 25 submissions instead of 100 000.
   * Every segment's paint dispatch is followed by its outline dispatch over its outline box (brush.ts outlineBox),
   * in the same compute pass: each dispatch sees the writes of the one before, so the outline reads `env` as it is
   * after its segment (paint.wgsl `outline`), as one call per stroke does.
   */
  paint(strokes: readonly Stroke[]) {
    if (strokes.length === 0) return;
    this.changed();
    this.revision++;
    // After a change of boundary `shape` is held to `env` under the new one first. Strokes under another boundary
    // leave that to the next readback or frame (below), so one call paints what one call per stroke paints.
    if (this.shapeHeld !== undefined) this.syncShape();
    const step = this.offsetStep;
    const params = new ArrayBuffer(BOUNDARIES.length * this.paramsStep);
    BOUNDARIES.forEach((boundary, i) => {
      const rt = { width: this.width, height: this.height, agents: this.agents, step: this.step };
      new Uint8Array(params, i * this.paramsStep, PARAMS_BYTES).set(
        new Uint8Array(packParams({ ...this.settings, boundary }, rt)),
      );
    });
    this.device.queue.writeBuffer(this.paintParams, 0, params);
    this.paintGroup ??= this.device.createBindGroup({
      layout: this.kernels.paintLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paintParams, size: PARAMS_BYTES } },
        { binding: 1, resource: { buffer: this.env } },
        { binding: 2, resource: { buffer: this.brushes, size: BRUSH_BYTES } },
        { binding: 3, resource: { buffer: this.shapeBuffer } },
      ],
    });
    // Every stroke as segments the pass paints exactly, each with the box of cells it can reach and the box of
    // cells its outline updates (brush.ts).
    const segments: Stroke[] = [];
    const boxes: Rect[] = [];
    const reaches: Rect[] = [];
    const offsets: number[] = [];
    const own: boolean[] = [];
    let foreign = false;
    for (const stroke of strokes) {
      const boundary = stroke.boundary ?? this.settings.boundary;
      const wrap = boundary === 'wrap';
      if (stroke.kind === 'wall') this.walls = true;
      if (stroke.kind !== 'erase') this.hasEnvironment = true;
      if (stroke.kind === 'food' || stroke.kind === 'light') [this.sources, this.scentless] = [true, false];
      if (boundary !== this.settings.boundary) foreign = true;
      for (const segment of paintSegments(stroke, this.width, this.height, wrap)) {
        const box = paintBox(segment, this.width, this.height, wrap);
        if (!box) continue;
        segments.push(segment);
        boxes.push(box);
        reaches.push(outlineBox(segment, this.width, this.height, wrap) ?? box);
        offsets.push(BOUNDARIES.indexOf(boundary) * this.paramsStep);
        own.push(!ownHeldEverywhere(segment, this.width, this.height, boundary));
      }
    }
    for (let first = 0; first < segments.length; first += BRUSH_CHUNK) {
      const chunk = segments.slice(first, first + BRUSH_CHUNK);
      const data = new ArrayBuffer(chunk.length * step);
      const f = new Float32Array(data);
      const i32 = new Int32Array(data);
      const u = new Uint32Array(data);
      chunk.forEach(({ from, to, radius, kind }, j) => {
        const [x, y] = boxes[first + j] ?? [0, 0];
        const [rx, ry, rw, rh] = reaches[first + j] ?? [0, 0, 0, 0];
        const o = (j * step) / 4;
        [f[o], f[o + 1], f[o + 2], f[o + 3]] = [from[0], from[1], to[0], to[1]];
        [i32[o + 4], i32[o + 5]] = [x, y];
        f[o + 6] = radius;
        u[o + 7] = EnvKind[kind];
        [i32[o + 8], i32[o + 9], u[o + 10], u[o + 11]] = [rx, ry, rw, rh];
      });
      this.device.queue.writeBuffer(this.brushes, 0, data);
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginComputePass();
      chunk.forEach((_, j) => {
        const [, , w, h] = boxes[first + j] ?? [0, 0, 0, 0];
        const [, , rw, rh] = reaches[first + j] ?? [0, 0, 0, 0];
        pass.setPipeline(this.kernels.paint);
        pass.setBindGroup(0, this.paintGroup, [offsets[first + j] ?? 0, j * step]);
        pass.dispatchWorkgroups(Math.ceil(w / TILE), Math.ceil(h / TILE));
        // Same layout: the bind group and its offsets stay. The eraser and walls load a tile of `env`; most segments
        // need no search of their own cells.
        pass.setPipeline(this.kernels.outline[outlineVariant(chunk[j], own[first + j] ?? true)]);
        pass.dispatchWorkgroups(Math.ceil(rw / TILE), Math.ceil(rh / TILE));
      });
      pass.end();
      this.device.queue.submit([enc.finish()]);
    }
    if (foreign) this.shapeHeld = undefined;
    // Without walls no pass reads the clearance: an erase then needs none, and builds no pass for walls.
    if (this.walls && strokes.some((s) => s.kind === 'wall' || s.kind === 'erase')) this.updateClearance();
  }

  /**
   * The clearance of every tile from the walls in `env` (walls.wgsl): the agent passes read it to skip walks that
   * cannot meet a wall. Needed again after every change of the walls. Without it, a new wall could lie inside the
   * clearance and be skipped; after an erase, walks would only run where they are not needed.
   */
  private updateClearance() {
    const k = this.kernels.walled();
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    const groups: [number, number] = [Math.ceil(this.clearTiles[0] / 8), Math.ceil(this.clearTiles[1] / 8)];
    pass.setPipeline(k.markWalls);
    pass.setBindGroup(0, this.bind('markWalls', k.markWalls, [this.params, this.env, this.walled]));
    pass.dispatchWorkgroups(...groups);
    pass.setPipeline(k.measureClearance);
    const measure = [this.params, null, this.walled, this.clearance];
    pass.setBindGroup(0, this.bind('measureClearance', k.measureClearance, measure));
    pass.dispatchWorkgroups(...groups);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  clearEnvironment() {
    this.changed();
    this.revision++;
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.env);
    enc.clearBuffer(this.shapeBuffer);
    this.device.queue.submit([enc.finish()]);
    this.walls = false;
    this.hasEnvironment = false;
    // The scent that the textures hold stays until the next reset.
    this.sources = false;
    this.shapeHeld = this.settings.boundary;
  }

  finish(): Promise<void> {
    return this.device.queue.onSubmittedWorkDone();
  }

  async alive(): Promise<number[]> {
    const counts = new Uint32Array(await readBuffer(this.device, this.stats));
    return Array.from(counts.slice(0, this.settings.strains.length));
  }

  /** Agents in id order, whatever order the sort left them in; `bits` without the id. */
  async readAgents(): Promise<AgentState[]> {
    const v = new DataView(await readBuffer(this.device, this.agentBuffer));
    const out = new Array<AgentState | undefined>(this.agents);
    for (let k = 0; k < this.agents; k++) {
      const bits = v.getUint32(k * AGENT_BYTES + 12, true);
      const id = bits >>> 3;
      // The sort moves agents and must never lose or duplicate one.
      if (id >= this.agents || out[id]) throw new Error(`Agent ids are not a permutation (slot ${k}, id ${id}).`);
      out[id] = {
        x: v.getFloat32(k * AGENT_BYTES, true),
        y: v.getFloat32(k * AGENT_BYTES + 4, true),
        heading: v.getFloat32(k * AGENT_BYTES + 8, true),
        bits: bits & 7,
      };
    }
    return out as AgentState[];
  }

  readTrail(): Promise<Float32Array> {
    return readTexture(this.device, this.current.trail, 4);
  }

  readScent(): Promise<Float32Array> {
    return readTexture(this.device, this.current.scent, 2);
  }

  async readCounts(): Promise<Float32Array> {
    return Float32Array.from(new Uint32Array(await readBuffer(this.device, this.counts)));
  }

  async readEnv(): Promise<Uint8Array> {
    return new Uint8Array(await readBuffer(this.device, this.env));
  }

  async readShape(): Promise<Uint8Array> {
    this.syncShape();
    return new Uint8Array(await readBuffer(this.device, this.shapeBuffer));
  }

  /**
   * Replaces the agent with id `index` (as readAgents() orders them), wherever the sort has put it. The id
   * stays, so ids remain unique: `a.bits` sets only the strain and the alive bit.
   */
  writeAgent(index: number, a: AgentState) {
    if (!Number.isInteger(index) || index < 0 || index >= this.agents) throw new RangeError(`No agent ${index}.`);
    const b = new ArrayBuffer(AGENT_BYTES);
    const v = new DataView(b);
    v.setFloat32(0, a.x, true);
    v.setFloat32(4, a.y, true);
    v.setFloat32(8, a.heading, true);
    v.setUint32(12, ((a.bits & 7) | (index << 3)) >>> 0, true);
    this.device.queue.writeBuffer(this.replacement, 0, b);
    const k = this.kernels;
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(k.replace);
    const resources = [this.params, this.agentBuffer, null, null, null, null, null, null, null, null, this.replacement];
    pass.setBindGroup(0, this.bind(`replace${this.agentParity}`, k.replace, resources));
    pass.dispatchWorkgroups(...this.groups);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  writeScent(data: Float32Array) {
    this.changed();
    this.revision++;
    this.scentless = false;
    this.device.queue.writeTexture({ texture: this.current.scent }, data, { bytesPerRow: this.width * 8 }, [
      this.width,
      this.height,
    ]);
  }

  writeTrail(data: Float32Array) {
    this.changed();
    this.revision++;
    this.device.queue.writeTexture({ texture: this.current.trail }, data, { bytesPerRow: this.width * 16 }, [
      this.width,
      this.height,
    ]);
  }

  /**
   * For tests. `shape` cannot know the distances of an environment written as bytes: it is cleared, and its next use
   * holds it to `env` (syncShape()), so the sign of every outline byte, the light and the shadow follow `env`.
   */
  writeEnv(data: Uint8Array) {
    this.changed();
    this.revision++;
    this.device.queue.writeBuffer(this.env, 0, data);
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.shapeBuffer);
    this.device.queue.submit([enc.finish()]);
    this.walls = data.some((v, i) => i % 4 === 0 && v > 0);
    this.hasEnvironment = data.some((v, i) => i % 4 !== 3 && v > 0);
    this.sources = data.some((v, i) => (i % 4 === 1 || i % 4 === 2) && v > 0);
    if (this.sources) this.scentless = false;
    this.shapeHeld = undefined;
    if (this.walls) this.updateClearance();
  }

  destroy() {
    for (const t of [...this.trail, ...this.scent, this.noScent]) t.destroy();
    for (const b of [this.params, this.paintParams, this.brushes, ...this.agentBuffers, this.tiles, this.replacement])
      b.destroy();
    for (const b of [this.counts, this.env, this.shapeBuffer, this.stats, this.walled, this.clearance]) b.destroy();
    this.viewThird?.trail.destroy();
    this.viewThird?.scent.destroy();
    this.dropFlow();
    this.dropTubes();
    const g = this.growth;
    if (g)
      for (const b of [g.rows, g.windows, g.claims, g.births, g.cellSums, g.dead, g.deadSums, ...g.levels]) b.destroy();
    this.collision?.occ.forEach((b) => {
      b.destroy();
    });
    this.collision?.claims.destroy();
  }

  /** `boundary` replaces the current one for a brush stroke (Stroke.boundary); the next step writes it back. */
  private writeParams(tool?: AgentTool, round = 0, boundary = this.settings.boundary) {
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
    this.device.queue.writeBuffer(this.params, 0, packParams(s, rt, this.paramData));
  }

  private encodeStep(enc: GPUCommandEncoder) {
    const k = this.kernels;
    const p = this.parity;
    const sort = this.sortInterval > 0 && this.step % this.sortInterval === 0 && this.sortedFor !== this.step;
    if (sort) enc.clearBuffer(this.tiles);
    enc.clearBuffer(this.counts);
    enc.clearBuffer(this.stats);
    const col = this.settings.collisions ? this.ensureCollision() : undefined;
    // Covered food reads the agents per cell after the moves (diffuse.wgsl COVERED): collision mode counts them
    // anyway, and without it `occupy` counts them into the same buffers.
    const covered = this.settings.coveredFood;
    const q = this.occParity;
    // The occupancy at the start of the step: the rule reads it (agents.wgsl openCell); `advance` binds it unread.
    const occ = this.ensureCollision().occ[q];
    if (col) enc.clearBuffer(col.claims);
    if (col || covered) enc.clearBuffer(this.ensureCollision().occ[flip(q)]);
    // Growth and shrinkage only with the rule, on the steps that test them (ADR 0025).
    const tests = growthTests(this.settings, this.step);
    const growth = col && (tests.grow || tests.shrink) ? this.ensureGrowth() : undefined;
    if (growth && tests.grow) {
      enc.clearBuffer(growth.claims);
      enc.clearBuffer(growth.births);
    }
    let pass = enc.beginComputePass();
    if (sort) this.encodeSort(pass);
    const a = this.agentParity;
    // While the scent holds only zeros, the sensors read them from one texel (`scentless`).
    const [trail, scent] = [this.trailViews[p], this.scentless ? this.noScentView : this.scentViews[p]];
    // With walls in the extended model, the passes whose sensors check the cells on the way for walls (agents.wgsl
    // SENSE_WALLS, ADR 0020): Jones does not say what a sensor reads behind a wall, so his model reads the sensor's
    // cell only (ADR 0022). With a trail saturation K above 0, the passes that saturate the trail (SATURATE).
    const senseWalls = this.walls && this.settings.model === 'extended';
    const saturate = trailSaturation(this.settings) > 0;
    // Bind groups of 'auto' layouts belong to their pipeline: the key names the variant.
    // With the flow in the tubes, the passes in which agents starve and come to life by the flow memory (agents.wgsl
    // `//#if FLOW`, ADR 0029): they read the memory of the step before, each agent the layer of its strain (ADR 0031).
    const flow = flowOn(this.settings) ? this.ensureFlow() : undefined;
    flow?.uniforms.forEach((block, strain) => {
      this.device.queue.writeBuffer(block, 0, packFlow(this.settings, this.sites, this.flowData, strain));
    });
    const flowing = flow ? k.flowing(senseWalls, saturate) : undefined;
    const fm = this.flowM;
    const w = `${senseWalls ? 1 : 0}${saturate ? 1 : 0}${this.scentless ? 1 : 0}${flow ? `flow${fm}` : ''}`;
    const agentPasses = flowing ?? (saturate ? k.saturated(senseWalls) : senseWalls ? k.walled() : k);
    // The agent passes read only the constants of the block, which every strain has: the block of the first strain.
    const [flowMemory, flowUniform] = flow ? [at(flow.memoryArrays, fm), at(flow.uniforms, 0)] : [null, null];
    if (!col) {
      const move = agentPasses.move;
      pass.setPipeline(move);
      pass.setBindGroup(
        0,
        this.bind(`move${p}${q}${a}${w}`, move, [
          this.params,
          this.agentBuffer,
          trail,
          scent,
          this.env,
          this.counts,
          this.stats,
          occ,
          null,
          null,
          null,
          this.clearance,
          flowMemory,
          flowUniform,
        ]),
      );
      pass.dispatchWorkgroups(...this.groups);
      if (covered) {
        const next = this.ensureCollision().occ[flip(q)];
        pass.setPipeline(k.occupy);
        const resources = [this.params, this.agentBuffer, null, null, null, null, null, null, null, next];
        pass.setBindGroup(0, this.bind(`occupy${a}${q}`, k.occupy, resources));
        pass.dispatchWorkgroups(...this.groups);
        this.occParity = flip(q);
      }
    } else {
      const next = col.occ[flip(q)];
      const claim = agentPasses.claim;
      pass.setPipeline(claim);
      pass.setBindGroup(
        0,
        this.bind(`claim${p}${q}${a}${w}`, claim, [
          this.params,
          this.agentBuffer,
          trail,
          scent,
          this.env,
          null,
          null,
          occ,
          col.claims,
          null,
          null,
          this.clearance,
          flowMemory,
          flowUniform,
        ]),
      );
      pass.dispatchWorkgroups(...this.groups);
      // Without the flow one `settle` serves every variant of the agent passes. With the flow each variant has its
      // own (Kernels.flowing()), so the key names the variant, as the keys of `move` and `claim` do.
      const settle = flowing?.settle ?? k.settle;
      const settleKey = flow ? `flow${fm}${senseWalls ? 1 : 0}${saturate ? 1 : 0}` : '';
      pass.setPipeline(settle);
      pass.setBindGroup(
        0,
        this.bind(`settle${q}${a}${settleKey}`, settle, [
          this.params,
          this.agentBuffer,
          null,
          null,
          this.env,
          this.counts,
          this.stats,
          occ,
          col.claims,
          next,
          null,
          this.clearance,
          flowMemory,
          flowUniform,
        ]),
      );
      pass.dispatchWorkgroups(...this.groups);
      this.occParity = flip(q);
      if (growth) pass = this.encodeGrowth(enc, pass, growth, tests.grow, flowMemory, flowUniform);
    }
    let d = p;
    // The pass that adds the step's sources (diffuse.wgsl): the last moving first, the first sensing first (ADR 0027);
    // with covered food while it is on.
    const senseFirst = this.settings.stepOrder === 'sense-first';
    for (const v of diffusePlan(this.settings.diffusion)) {
      pass.setPipeline(
        covered && (senseFirst ? v.first : v.last) ? k.covered(v, senseFirst) : k.diffuse(v, senseFirst),
      );
      pass.setBindGroup(0, this.diffuseBind(d, this.occParity));
      pass.dispatchWorkgroups(Math.ceil(this.width / TILE), Math.ceil(this.height / TILE));
      d = flip(d);
    }
    if (flow) this.encodeFlow(pass, flow, d);
    pass.end();
    this.parity = d;
  }

  /**
   * The flow in the tubes after the diffusion of a step (flow.wgsl, ADR 0029): the update of the memory from the
   * pressure and the trail of this step, then the pressure iterations on the new conductivity. `trail`: the texture
   * that holds the trail after the step. Once per strain, each with its own layers and its own block (ADR 0031): the
   * passes of a strain read no state of another strain.
   */
  private encodeFlow(pass: GPUComputePassEncoder, flow: FlowState, trail: Bit) {
    const passes = this.kernels.flowPasses();
    const groups = [Math.ceil(this.width / FLOW_GROUP), Math.ceil(this.height / FLOW_GROUP)] as const;
    const [m, next] = [this.flowM, flip(this.flowM)];
    let p = this.flowP;
    for (let strain = 0; strain < flow.strains; strain++) {
      const [uniform, memory, pressure] = [
        at(flow.uniforms, strain),
        at(flow.memoryViews, strain),
        at(flow.pressureViews, strain),
      ];
      p = this.flowP;
      pass.setPipeline(passes.update);
      pass.setBindGroup(
        0,
        this.bind(`flowUpdate${strain}-${m}${p}${trail}`, passes.update, [
          this.params,
          uniform,
          this.trailViews[trail],
          this.env,
          memory[m],
          memory[next],
          at(pressure, p),
        ]),
      );
      pass.dispatchWorkgroups(...groups);
      for (let i = 0; i < FLOW_ITERATIONS; i++) {
        // The first two iterations take the pressure of the reference cell off (flow.wgsl RECENTRE).
        const pipeline = at(passes.pressure, Math.min(i, 2) === 2 ? 0 : i + 1);
        const [before, out] = [(p + 2) % 3, (p + 1) % 3];
        pass.setPipeline(pipeline);
        pass.setBindGroup(
          0,
          this.bind(`flowPressure${strain}-${Math.min(i, 2)}${next}${p}`, pipeline, [
            this.params,
            uniform,
            null,
            this.env,
            memory[next],
            null,
            at(pressure, p),
            at(pressure, before),
            at(pressure, out),
          ]),
        );
        pass.dispatchWorkgroups(...groups);
        p = out;
      }
    }
    this.flowM = next;
    this.flowP = p;
  }

  /**
   * Growth and shrinkage after the moves of a test step (growth.wgsl, ADR 0025), in `pass`, which settle ended. The
   * occupancy after the moves (current, from settle) gives the window counts and the empty cells. The births need
   * the alive count and the occupancy anew: the pass ends for their clears, and a new one returns, for the diffusion.
   * The occupancy at the start of the step holds the one after this step then.
   */
  private encodeGrowth(
    enc: GPUCommandEncoder,
    pass: GPUComputePassEncoder,
    g: GrowthBuffers,
    grow: boolean,
    flowMemory: GPUTextureView | null,
    flowUniform: GPUBuffer | null,
  ) {
    // With the flow in the tubes, the passes in which an agent on a starved cell does not divide (growth.wgsl
    // `//#if FLOW`, ADR 0029): they read the flow memory that the agent passes of the step read.
    const flow = flowMemory !== null;
    const k = this.kernels.growth(flow);
    const f = flow ? `flow${this.flowM}` : '';
    const a = this.agentParity;
    const moved = this.occParity;
    const after = this.ensureCollision().occ[moved];
    const next = this.ensureCollision().occ[flip(moved)];
    const cellGroups = this.cellGroups;
    const resources = [
      this.params,
      this.agentBuffer,
      this.env,
      after,
      this.counts,
      g.rows,
      g.windows,
      g.claims,
      g.births,
      g.cellSums,
      g.dead,
      g.deadSums,
      next,
      this.stats,
    ];
    // An 'auto' layout holds only the bindings that its entry point uses (GROWTH_BINDINGS).
    const used = (name: keyof GrowthKernels, extra: GPUBuffer | null = null) => {
      const bindings = flow ? [...GROWTH_BINDINGS[name], ...GROWTH_FLOW_BINDINGS[name]] : GROWTH_BINDINGS[name];
      return [...resources, extra, flowMemory, flowUniform].map((r, i) => (bindings.includes(i) ? r : null));
    };
    const run = (name: keyof GrowthKernels, groups: [number, number]) => {
      const pipeline = k[name];
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.bind(`grow-${name}${a}${moved}${f}`, pipeline, used(name)));
      pass.dispatchWorkgroups(...groups);
    };
    run('rowSums', cellGroups);
    run('windowSums', cellGroups);
    run('test', this.groups);
    if (grow) {
      run('win', this.groups);
      const build = (name: 'buildCells' | 'buildDead', n: number) => {
        const pipeline = k[name];
        pass.setPipeline(pipeline);
        pyramidLevels(n).forEach((size, i) => {
          const level = g.levels[i + 1];
          if (!level) throw new Error(`No uniform for pyramid level ${i + 1}`);
          pass.setBindGroup(0, this.bind(`grow-${name}${i + 1}${f}`, pipeline, used(name, level)));
          pass.dispatchWorkgroups(...this.groupsFor(size));
        });
      };
      build('buildCells', this.width * this.height);
      build('buildDead', this.agents);
    }
    pass.end();
    enc.clearBuffer(this.stats);
    enc.clearBuffer(next);
    const after2 = enc.beginComputePass();
    after2.setPipeline(k.birth);
    after2.setBindGroup(0, this.bind(`grow-birth${a}${moved}${f}`, k.birth, used('birth')));
    after2.dispatchWorkgroups(...this.groups);
    this.occParity = flip(moved);
    return after2;
  }

  /** Workgroups of 256 for `n` invocations, in two dimensions beyond the limit of one (as `groups`). */
  private groupsFor(n: number): [number, number] {
    const groups = Math.max(1, Math.ceil(n / GROUP));
    const x = Math.min(groups, this.device.limits.maxComputeWorkgroupsPerDimension);
    return [x, Math.ceil(groups / x)];
  }

  /** Workgroups of 256 for one invocation per cell (growth.wgsl box sums). */
  private get cellGroups(): [number, number] {
    return this.groupsFor(this.width * this.height);
  }

  /** The buffers of growth and shrinkage, at their first use while growth is on (ADR 0025). */
  private ensureGrowth(): GrowthBuffers {
    if (!this.growth) {
      const { STORAGE, COPY_SRC, COPY_DST, UNIFORM } = GPUBufferUsage;
      const cells = this.width * this.height;
      const make = (size: number, usage = STORAGE | COPY_SRC | COPY_DST) =>
        this.device.createBuffer({ size: Math.max(16, size), usage });
      const sum = (n: number) => pyramidLevels(n).reduce((t, m) => t + m, 0);
      const top = Math.max(pyramidLevels(cells).length, pyramidLevels(this.agents).length);
      const levels = Array.from({ length: top + 1 }, (_, k) => {
        const b = make(16, UNIFORM | COPY_DST);
        this.device.queue.writeBuffer(b, 0, new Uint32Array([k, 0, 0, 0]));
        return b;
      });
      this.growth = {
        rows: make(cells * 8),
        windows: make(cells * 8),
        claims: make(cells * 4),
        births: make(cells * 8),
        cellSums: make(sum(cells) * 16),
        dead: make(this.agents * 4),
        deadSums: make(sum(this.agents) * 4),
        levels,
      };
    }
    return this.growth;
  }

  /**
   * For tests: the agents in the growth and the shrinkage window around each cell (2 per cell), as the last step
   * that tested growth or shrinkage counted them after its moves. Empty before such a step.
   */
  async readWindows(): Promise<Uint32Array> {
    return this.growth ? new Uint32Array(await readBuffer(this.device, this.growth.windows)) : new Uint32Array(0);
  }

  /**
   * Counting sort of the agents by 8 × 8 tile of their cell (sort.wgsl), from the current agent buffer into
   * the other one, which then becomes current. The tiles buffer must be cleared before the pass.
   */
  private encodeSort(pass: GPUComputePassEncoder) {
    const k = this.kernels.sort;
    const a = this.agentParity;
    const [from, to] = [this.agentBuffers[a], this.agentBuffers[flip(a)]];
    pass.setPipeline(k.countTiles);
    pass.setBindGroup(0, this.bind(`countTiles${a}`, k.countTiles, [this.params, from, null, this.tiles]));
    pass.dispatchWorkgroups(...this.groups);
    pass.setPipeline(k.scanTiles);
    pass.setBindGroup(0, this.bind('scanTiles', k.scanTiles, [this.params, null, null, this.tiles]));
    pass.dispatchWorkgroups(1);
    pass.setPipeline(k.scatter);
    pass.setBindGroup(0, this.bind(`scatter${a}`, k.scatter, [this.params, from, to, this.tiles]));
    pass.dispatchWorkgroups(...this.groups);
    this.agentParity = flip(a);
  }

  /** `q`: the occupancy buffer that holds the agents per cell after this step's moves (diffuse.wgsl COVERED). */
  private diffuseBind(p: Bit, q: Bit) {
    const key = `diffuse${p}${q}${+this.scentless}`;
    let g = this.bindCache.get(key);
    if (!g) {
      // While the scent holds only zeros, the pass reads them from one texel and writes zeros (`scentless`).
      const scentIn = this.scentless ? this.noScentView : this.scentViews[p];
      const views = [this.trailViews[p], scentIn, this.trailViews[flip(p)], this.scentViews[flip(p)]];
      const occ = this.ensureCollision().occ[q];
      g = this.device.createBindGroup({
        layout: this.kernels.diffuseLayout,
        entries: [this.params, ...views, this.env, this.counts, occ].map((r, binding) => entry(binding, r)),
      });
      this.bindCache.set(key, g);
    }
    return g;
  }

  /** Bind group from a list where index = binding; `null` skips a binding. Cached by key. */
  private bind(key: string, pipeline: GPUComputePipeline, resources: (GPUBuffer | GPUTextureView | null)[]) {
    let g = this.bindCache.get(key);
    if (!g) {
      const entries = resources.flatMap((r, binding) => (r ? [entry(binding, r)] : []));
      g = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
      this.bindCache.set(key, g);
    }
    return g;
  }

  private ensureCollision() {
    if (!this.collision) {
      const size = this.width * this.height * 4;
      const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
      const make = () => this.device.createBuffer({ size, usage });
      this.collision = { occ: [make(), make()], claims: make() };
    }
    return this.collision;
  }

  private rebuildOccupancy() {
    const col = this.ensureCollision();
    const target = col.occ[flip(this.occParity)];
    this.writeParams();
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(target);
    const pass = enc.beginComputePass();
    pass.setPipeline(this.kernels.occupy);
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.kernels.occupy.getBindGroupLayout(0),
        entries: [entry(0, this.params), entry(1, this.agentBuffer), entry(9, target)],
      }),
    );
    pass.dispatchWorkgroups(...this.groups);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.occParity = flip(this.occParity);
  }
}

function entry(binding: number, r: GPUBuffer | GPUTextureView): GPUBindGroupEntry {
  return { binding, resource: r instanceof GPUBuffer ? { buffer: r } : r };
}

/** The start passes (init.wgsl): the code before, or the ones for a capacity above the start (CAPACITY). */
interface Starts {
  init: GPUComputePipeline;
  claimStart: GPUComputePipeline;
  settleStart: GPUComputePipeline;
}

/** The bindings that each pass of growth.wgsl uses: the 'auto' layout of its pipeline holds only these. */
export const GROWTH_BINDINGS: Record<keyof GrowthKernels, readonly number[]> = {
  rowSums: [0, 3, 5],
  windowSums: [0, 5, 6],
  test: [0, 1, 2, 3, 4, 6, 7],
  win: [0, 1, 2, 3, 4, 6, 7, 8, 10],
  buildCells: [0, 8, 9, 14],
  buildDead: [0, 10, 11, 14],
  birth: [0, 1, 8, 9, 10, 11, 12, 13],
};

/**
 * The bindings that a pass of growth.wgsl uses in addition with the flow in the tubes (`//#if FLOW`): the flow memory
 * and the uniform block of the flow, in the passes that decide who divides.
 */
export const GROWTH_FLOW_BINDINGS: Record<keyof GrowthKernels, readonly number[]> = {
  rowSums: [],
  windowSums: [],
  test: [15, 16],
  win: [15, 16],
  buildCells: [],
  buildDead: [],
  birth: [],
};

/** The passes of growth and shrinkage (growth.wgsl, ADR 0025). */
interface GrowthKernels {
  rowSums: GPUComputePipeline;
  windowSums: GPUComputePipeline;
  test: GPUComputePipeline;
  win: GPUComputePipeline;
  buildCells: GPUComputePipeline;
  buildDead: GPUComputePipeline;
  birth: GPUComputePipeline;
}

/** `advance` (move) and `claim`, the agent passes that steer. */
interface Steering {
  move: GPUComputePipeline;
  claim: GPUComputePipeline;
}

/** The agent passes with the flow in the tubes (Kernels.flowing()): `settle` places agents by the flow too. */
interface Flowing extends Steering {
  settle: GPUComputePipeline;
}

/** The passes of the flow in the tubes (flow.wgsl): the update, and the pressure iteration by RECENTRE (0, 1, 2). */
interface FlowKernels {
  update: GPUComputePipeline;
  pressure: GPUComputePipeline[];
}

/** The passes of the picture of the tubes (tubes.wgsl, ADR 0034). */
interface TubeKernels {
  roots: GPUComputePipeline;
  picture: GPUComputePipeline;
}

/** The pipelines for an environment that may hold walls (Kernels.walled()). */
interface Walled extends Steering {
  markWalls: GPUComputePipeline;
  measureClearance: GPUComputePipeline;
  // `move` and `claim` here: their sensors check for walls (agents.wgsl SENSE_WALLS).
}

/** Compiled pipelines, shared by every Simulation on one device. */
class Kernels {
  /** Per device, by the sources of the agent and diffusion passes. */
  private static readonly cache = new WeakMap<GPUDevice, Map<string, Promise<Kernels>>>();
  private walledPipelines?: Walled;
  /** The steering passes with the saturating trail perception (agents.wgsl SATURATE), without and with walls. */
  private readonly saturatedPipelines: [Steering?, Steering?] = [];
  /** The last diffusion pass with covered food (diffuse.wgsl COVERED), by variantKey(). */
  private readonly coveredPipelines = new Map<string, GPUComputePipeline>();
  /** The view's diffusion passes of a step that moves first (diffuse.wgsl VIEW), by variantKey(). */
  private readonly viewPipelines = new Map<string, GPUComputePipeline>();
  private capacityPipelines?: Starts;
  private growthPipelines?: GrowthKernels;
  private growthFlowPipelines?: GrowthKernels;
  /** The agent passes with the flow in the tubes (agents.wgsl `//#if FLOW`), by walls and saturation. */
  private flowModule?: GPUShaderModule;
  private readonly flowingPipelines = new Map<string, Flowing>();
  private flowPipelines?: FlowKernels;
  private tubePipelines?: TubeKernels;

  private constructor(
    readonly init: GPUComputePipeline,
    readonly claimStart: GPUComputePipeline,
    readonly settleStart: GPUComputePipeline,
    readonly census: GPUComputePipeline,
    readonly move: GPUComputePipeline,
    readonly claim: GPUComputePipeline,
    readonly settle: GPUComputePipeline,
    readonly occupy: GPUComputePipeline,
    readonly replace: GPUComputePipeline,
    readonly paint: GPUComputePipeline,
    /** The outline pass, by outlineVariant(). */
    readonly outline: Readonly<Record<OutlineVariant, GPUComputePipeline>>,
    readonly refresh: GPUComputePipeline,
    readonly sort: Record<'countTiles' | 'scanTiles' | 'scatter', GPUComputePipeline>,
    readonly diffuseLayout: GPUBindGroupLayout,
    readonly paintLayout: GPUBindGroupLayout,
    private readonly variants: Map<string, GPUComputePipeline>,
    private readonly device: GPUDevice,
    private readonly agents: GPUShaderModule,
    private readonly walls: GPUShaderModule,
    private readonly diffuseModule: GPUShaderModule,
    private readonly startModule: GPUShaderModule,
    private readonly agentsSource: string,
  ) {}

  /**
   * The agent passes in which agents starve and come to life by the flow memory (agents.wgsl `//#if FLOW`, ADR 0029),
   * built at their first use: every scene but the ones with the flow runs without them. Their source holds the lines
   * of the flow; the source of every other agent pass is the one of the code before.
   */
  flowing(walls: boolean, saturate: boolean): Flowing {
    const key = `${+walls}${+saturate}`;
    let p = this.flowingPipelines.get(key);
    if (!p) {
      const module = (this.flowModule ??= this.device.createShaderModule({
        code: common + variant(this.agentsSource, ['FLOW']),
      }));
      const constants = { ...(saturate ? { SATURATE: 1 } : {}), ...(walls ? { SENSE_WALLS: 1 } : {}) };
      const pipeline = (entryPoint: string) =>
        this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint, constants } });
      p = { move: pipeline('advance'), claim: pipeline('claim'), settle: pipeline('settle') };
      this.flowingPipelines.set(key, p);
    }
    return p;
  }

  /** The passes of the flow in the tubes (flow.wgsl), built at their first use. */
  flowPasses(): FlowKernels {
    if (!this.flowPipelines) {
      const module = this.device.createShaderModule({ code: common + flowWgsl });
      const pipeline = (entryPoint: string, constants: Record<string, number> = {}) =>
        this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint, constants } });
      this.flowPipelines = {
        update: pipeline('update'),
        pressure: [0, 1, 2].map((RECENTRE) => pipeline('pressure', { RECENTRE })),
      };
    }
    return this.flowPipelines;
  }

  /** The passes of the picture of the tubes (tubes.wgsl), built at their first use, with the numbers of tubes.ts. */
  tubes(): TubeKernels {
    if (!this.tubePipelines) {
      const module = this.device.createShaderModule({ code: common + tubesWgsl });
      const constants = {
        RADIUS: TUBES.radius,
        EDGE: TUBES.edge,
        SHEET: TUBES.sheet,
        SPAN: TUBES.span,
        BODY_LOW: FLOW.bodyLow,
      };
      // A pipeline takes only the constants that its entry point uses.
      const pipeline = (entryPoint: string, names: (keyof typeof constants)[]) =>
        this.device.createComputePipeline({
          layout: 'auto',
          compute: { module, entryPoint, constants: Object.fromEntries(names.map((n) => [n, constants[n]])) },
        });
      this.tubePipelines = {
        roots: pipeline('roots', ['SPAN', 'BODY_LOW']),
        picture: pipeline('picture', ['RADIUS', 'EDGE', 'SHEET']),
      };
    }
    return this.tubePipelines;
  }

  /**
   * The start passes for a capacity above the start population (init.wgsl CAPACITY, ADR 0025), built at their first
   * use as walled() builds its passes: no scene of this app starts with more capacity than agents.
   */
  capacity(): Starts {
    if (!this.capacityPipelines) {
      const pipeline = (entryPoint: string) =>
        this.device.createComputePipeline({
          layout: 'auto',
          compute: { module: this.startModule, entryPoint, constants: { CAPACITY: 1 } },
        });
      this.capacityPipelines = {
        init: pipeline('init'),
        claimStart: pipeline('claimStart'),
        settleStart: pipeline('settleStart'),
      };
    }
    return this.capacityPipelines;
  }

  /**
   * The passes of growth and shrinkage (growth.wgsl), built at their first use: only a scene with growth needs them.
   * `flow`: with the lines of the flow in the tubes (`//#if FLOW`, ADR 0029); without them the source is the one of
   * the code before.
   */
  growth(flow: boolean): GrowthKernels {
    const built = flow ? this.growthFlowPipelines : this.growthPipelines;
    if (built) return built;
    const module = this.device.createShaderModule({ code: common + variant(growthWgsl, flow ? ['FLOW'] : []) });
    const pipeline = (entryPoint: string) =>
      this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } });
    const pipelines = {
      rowSums: pipeline('rowSums'),
      windowSums: pipeline('windowSums'),
      test: pipeline('test'),
      win: pipeline('win'),
      buildCells: pipeline('buildCells'),
      buildDead: pipeline('buildDead'),
      birth: pipeline('birth'),
    };
    if (flow) this.growthFlowPipelines = pipelines;
    else this.growthPipelines = pipelines;
    return pipelines;
  }

  /**
   * The pipelines for walls, built at their first use: a simulation without walls never needs them, and built at
   * the start they made the first start of a page 2.6 s longer on SwiftShader (CI, ADR 0010). They are created
   * without waiting, so the queue, not the page, waits for the compiler before the first pass with walls.
   */
  walled(): Walled {
    if (!this.walledPipelines) {
      const pipeline = (module: GPUShaderModule, entryPoint: string, constants: Record<string, number> = {}) =>
        this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint, constants } });
      const sensing = { SENSE_WALLS: 1 };
      this.walledPipelines = {
        markWalls: pipeline(this.walls, 'markWalls'),
        measureClearance: pipeline(this.walls, 'measureClearance'),
        move: pipeline(this.agents, 'advance', sensing),
        claim: pipeline(this.agents, 'claim', sensing),
      };
    }
    return this.walledPipelines;
  }

  /**
   * The steering passes with the saturating trail perception (agents.wgsl SATURATE), built at their first use as
   * walled() builds its passes: most scenes never saturate. `walls`: their sensors also check for walls.
   */
  saturated(walls: boolean): Steering {
    const i = walls ? 1 : 0;
    let p = this.saturatedPipelines[i];
    if (!p) {
      const constants = { SATURATE: 1, ...(walls ? { SENSE_WALLS: 1 } : {}) };
      const pipeline = (entryPoint: string) =>
        this.device.createComputePipeline({ layout: 'auto', compute: { module: this.agents, entryPoint, constants } });
      p = { move: pipeline('advance'), claim: pipeline('claim') };
      this.saturatedPipelines[i] = p;
    }
    return p;
  }

  /** A last diffusion pass with covered food (diffuse.wgsl COVERED), built at its first use. */
  covered(v: Diffuse, senseFirst: boolean): GPUComputePipeline {
    const key = variantKey(v, senseFirst);
    let p = this.coveredPipelines.get(key);
    if (!p) {
      const constants = { ...variantConstants(v, senseFirst), COVERED: 1 };
      const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.diffuseLayout] });
      p = this.device.createComputePipeline({
        layout,
        compute: { module: this.diffuseModule, entryPoint: 'diffuse', constants },
      });
      this.coveredPipelines.set(key, p);
    }
    return p;
  }

  static get(device: GPUDevice, agentsSource: string, diffuseSource: string, initSource: string): Promise<Kernels> {
    let built = Kernels.cache.get(device);
    if (!built) {
      built = new Map();
      Kernels.cache.set(device, built);
    }
    const key = `${agentsSource}\0${diffuseSource}\0${initSource}`;
    let k = built.get(key);
    if (!k) {
      k = Kernels.build(device, agentsSource, diffuseSource, initSource);
      built.set(key, k);
    }
    return k;
  }

  /** A diffusion pass of the view of a step that moves first (diffuse.wgsl VIEW), built at its first use. */
  view(v: Diffuse): GPUComputePipeline {
    const key = variantKey(v, false);
    let p = this.viewPipelines.get(key);
    if (!p) {
      const layout = this.device.createPipelineLayout({ bindGroupLayouts: [this.diffuseLayout] });
      p = this.device.createComputePipeline({
        layout,
        compute: {
          module: this.diffuseModule,
          entryPoint: 'diffuse',
          constants: { ...variantConstants(v, false), VIEW: 1 },
        },
      });
      this.viewPipelines.set(key, p);
    }
    return p;
  }

  diffuse(v: Diffuse, senseFirst: boolean): GPUComputePipeline {
    const p = this.variants.get(variantKey(v, senseFirst));
    if (!p) throw new Error(`No diffusion pipeline for variant ${variantKey(v, senseFirst)}`);
    return p;
  }

  private static async build(
    device: GPUDevice,
    agentsSource: string,
    diffuseSource: string,
    initSource: string,
  ): Promise<Kernels> {
    const module = (code: string) => device.createShaderModule({ code: common + code });
    // Without the lines of the flow in the tubes (`//#if FLOW`, ADR 0029): the source of the code before.
    const agents = module(variant(agentsSource));
    const compute = (m: GPUShaderModule, entryPoint: string, constants: Record<string, number> = {}) =>
      device.createComputePipelineAsync({ layout: 'auto', compute: { module: m, entryPoint, constants } });
    const C = GPUShaderStage.COMPUTE;
    const diffuseLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, texture: { sampleType: 'unfilterable-float' } },
        { binding: 2, visibility: C, texture: { sampleType: 'unfilterable-float' } },
        { binding: 3, visibility: C, storageTexture: { access: 'write-only', format: 'rgba32float' } },
        { binding: 4, visibility: C, storageTexture: { access: 'write-only', format: 'rg32float' } },
        { binding: 5, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 7, visibility: C, buffer: { type: 'read-only-storage' } },
      ],
    });
    // Brush strokes pick their brush and their boundary's parameters by dynamic offset (Simulation.paint), in the
    // paint and the outline pass alike.
    const paintLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true } },
        { binding: 1, visibility: C, buffer: { type: 'storage' } },
        { binding: 2, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true } },
        { binding: 3, visibility: C, buffer: { type: 'storage' } },
      ],
    });
    const diffuseModule = module(diffuseSource);
    const layout = device.createPipelineLayout({ bindGroupLayouts: [diffuseLayout] });
    // Every pass of 0 to 4 passes, in each order of a step (diffuse.wgsl SENSE_FIRST, ADR 0027).
    const plans = [0, 1, 2, 3, 4]
      .flatMap(diffusePlan)
      .flatMap((v) => [false, true].map((senseFirst) => ({ ...v, senseFirst })));
    const unique = [...new Map(plans.map((v) => [variantKey(v, v.senseFirst), v])).values()];
    const variants = Promise.all(
      unique.map(
        async (v) =>
          [
            variantKey(v, v.senseFirst),
            await device.createComputePipelineAsync({
              layout,
              compute: {
                module: diffuseModule,
                entryPoint: 'diffuse',
                constants: { ...variantConstants(v, v.senseFirst) },
              },
            }),
          ] as const,
      ),
    );
    const sort = module(sortWgsl);
    const start = module(initSource);
    const brush = module(paintWgsl);
    const paintPipeline = (entryPoint: string, constants?: Record<string, number>) =>
      device.createComputePipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [paintLayout] }),
        compute: { module: brush, entryPoint, ...(constants ? { constants } : {}) },
      });
    const [
      init,
      claimStart,
      settleStart,
      census,
      move,
      claim,
      settle,
      occupy,
      replace,
      paint,
      coreOwn,
      coreHeld,
      tiledOwn,
      tiledHeld,
      untiledOwn,
      untiledHeld,
      refresh,
      countTiles,
      scanTiles,
      scatter,
    ] = await Promise.all([
      compute(start, 'init'),
      compute(start, 'claimStart'),
      compute(start, 'settleStart'),
      compute(start, 'census'),
      compute(agents, 'advance'),
      compute(agents, 'claim'),
      compute(agents, 'settle'),
      compute(agents, 'occupy'),
      compute(agents, 'replace'),
      paintPipeline('paint'),
      paintPipeline('outline'),
      paintPipeline('outline', { OWN_SEARCH: 0 }),
      paintPipeline('outline', { CORE: 0 }),
      paintPipeline('outline', { CORE: 0, OWN_SEARCH: 0 }),
      paintPipeline('outline', { TILED: 0, CORE: 0 }),
      paintPipeline('outline', { TILED: 0, CORE: 0, OWN_SEARCH: 0 }),
      compute(brush, 'refresh'),
      compute(sort, 'countTiles'),
      compute(sort, 'scanTiles'),
      compute(sort, 'scatter'),
    ]);
    const sorting = { countTiles, scanTiles, scatter };
    return new Kernels(
      init,
      claimStart,
      settleStart,
      census,
      move,
      claim,
      settle,
      occupy,
      replace,
      paint,
      { coreOwn, coreHeld, tiledOwn, tiledHeld, untiledOwn, untiledHeld },
      refresh,
      sorting,
      diffuseLayout,
      paintLayout,
      new Map(await variants),
      device,
      agents,
      module(wallsWgsl),
      diffuseModule,
      start,
      agentsSource,
    );
  }
}

type OutlineVariant = `${'core' | 'tiled' | 'untiled'}${'Own' | 'Held'}`;

/**
 * Which pipeline of the outline pass a segment takes (Kernels.outline): the eraser and walls with the tile of `env`
 * (paint.wgsl TILED), a wide eraser also with its core (CORE), food and light without the tile; each with the search
 * of the segment's own cells where some cell may need it (OWN_SEARCH, brush.ts ownHeldEverywhere()).
 */
function outlineVariant(segment: Stroke | undefined, own: boolean): OutlineVariant {
  const kind = segment?.kind ?? 'food';
  const base =
    kind === 'erase' && (segment?.radius ?? 0) >= CORE_RADIUS
      ? 'core'
      : kind === 'erase' || kind === 'wall'
        ? 'tiled'
        : 'untiled';
  return `${base}${own ? 'Own' : 'Held'}`;
}

function variantKey(v: Diffuse, senseFirst: boolean) {
  return `${+v.first}${+v.last}${+v.blur}${+senseFirst}`;
}

/** The pipeline constants of a diffusion pass (diffuse.wgsl), in the order of a step that `senseFirst` names. */
function variantConstants(v: Diffuse, senseFirst: boolean) {
  return { FIRST: Number(v.first), LAST: Number(v.last), BLUR: Number(v.blur), SENSE_FIRST: Number(senseFirst) };
}
