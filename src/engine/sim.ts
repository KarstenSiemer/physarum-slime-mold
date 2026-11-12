import { BOUNDARIES, type Boundary, type Settings } from '../model/params';
import { outlineBox, ownHeldEverywhere, paintBox, paintSegments, type Rect } from './brush';
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
import growthWgsl from './shaders/growth.wgsl?raw';
import initWgsl from './shaders/init.wgsl?raw';
import paintWgsl from './shaders/paint.wgsl?raw';
import sortWgsl from './shaders/sort.wgsl?raw';
import wallsWgsl from './shaders/walls.wgsl?raw';
import { diffusePlan, type Diffuse } from './sizing';
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
/** All simulation state on the GPU for one grid size and agent count (WebGPU). */
export class Simulation implements Sim {
  step = 0;
  /**
   * Counts the changes of the scent and the shape outside steps (reset, strokes, clearing, writes, a new hold of the
   * shape); `step` counts the steps. Together they tell a cache of them when it is old: the scent view's coarse map.
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
  readonly trail: Pair<GPUTexture>;
  readonly scent: Pair<GPUTexture>;
  private readonly trailViews: Pair<GPUTextureView>;
  private readonly scentViews: Pair<GPUTextureView>;
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
  private paintGroup?: GPUBindGroup;
  /**
   * A wall was painted since the last clear: moves and sensors then check every cell they cross (agents.wgsl
   * clearPath, ADR 0020).
   */
  private walls = false;
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
    this.settings = settings;
    if (switchedOn) this.rebuildOccupancy();
    // The memory fit counts the buffers of growth only while it is on (sizing.ts).
    if (!growthOn(settings) && this.growth) {
      const g = this.growth;
      for (const b of [g.rows, g.windows, g.claims, g.births, g.cellSums, g.dead, g.deadSums, ...g.levels]) b.destroy();
      this.growth = undefined;
      for (const key of [...this.bindCache.keys()]) if (key.startsWith('grow')) this.bindCache.delete(key);
    }
  }

  reset() {
    this.revision++;
    this.step = 0;
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

  /** Runs `steps` simulation steps. The agent tool acts on every one of them (ADR 0023). */
  run(steps: number, tool?: AgentTool) {
    for (let k = 0; k < steps; k++) {
      this.writeParams(tool);
      const enc = this.device.createCommandEncoder();
      this.encodeStep(enc);
      this.device.queue.submit([enc.finish()]);
      this.step++;
    }
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
    this.revision++;
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.env);
    enc.clearBuffer(this.shapeBuffer);
    this.device.queue.submit([enc.finish()]);
    this.walls = false;
    this.hasEnvironment = false;
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

  writeTrail(data: Float32Array) {
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
    this.revision++;
    this.device.queue.writeBuffer(this.env, 0, data);
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.shapeBuffer);
    this.device.queue.submit([enc.finish()]);
    this.walls = data.some((v, i) => i % 4 === 0 && v > 0);
    this.hasEnvironment = data.some((v, i) => i % 4 !== 3 && v > 0);
    this.shapeHeld = undefined;
    if (this.walls) this.updateClearance();
  }

  destroy() {
    for (const t of [...this.trail, ...this.scent]) t.destroy();
    for (const b of [this.params, this.paintParams, this.brushes, ...this.agentBuffers, this.tiles, this.replacement])
      b.destroy();
    for (const b of [this.counts, this.env, this.shapeBuffer, this.stats, this.walled, this.clearance]) b.destroy();
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
    const sort = this.sortInterval > 0 && this.step % this.sortInterval === 0;
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
    const [trail, scent] = [this.trailViews[p], this.scentViews[p]];
    // With walls in the extended model, the passes whose sensors check the cells on the way for walls (agents.wgsl
    // SENSE_WALLS, ADR 0020): Jones does not say what a sensor reads behind a wall, so his model reads the sensor's
    // cell only (ADR 0022). With a trail saturation K above 0, the passes that saturate the trail (SATURATE).
    const senseWalls = this.walls && this.settings.model === 'extended';
    const saturate = trailSaturation(this.settings) > 0;
    // Bind groups of 'auto' layouts belong to their pipeline: the key names the variant.
    const w = `${senseWalls ? 1 : 0}${saturate ? 1 : 0}`;
    const agentPasses = saturate ? k.saturated(senseWalls) : senseWalls ? k.walled() : k;
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
        ]),
      );
      pass.dispatchWorkgroups(...this.groups);
      pass.setPipeline(k.settle);
      pass.setBindGroup(
        0,
        this.bind(`settle${q}${a}`, k.settle, [
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
        ]),
      );
      pass.dispatchWorkgroups(...this.groups);
      this.occParity = flip(q);
      if (growth) pass = this.encodeGrowth(enc, pass, growth, tests.grow);
    }
    let d = p;
    for (const v of diffusePlan(this.settings.diffusion)) {
      pass.setPipeline(covered && v.first ? k.covered(v) : k.diffuse(v));
      pass.setBindGroup(0, this.diffuseBind(d, this.occParity));
      pass.dispatchWorkgroups(Math.ceil(this.width / TILE), Math.ceil(this.height / TILE));
      d = flip(d);
    }
    pass.end();
    this.parity = d;
  }

  /**
   * Growth and shrinkage after the moves of a test step (growth.wgsl, ADR 0025), in `pass`, which settle ended. The
   * occupancy after the moves (current, from settle) gives the window counts and the empty cells. The births need
   * the alive count and the occupancy anew: the pass ends for their clears, and a new one returns, for the diffusion.
   * The occupancy at the start of the step holds the one after this step then.
   */
  private encodeGrowth(enc: GPUCommandEncoder, pass: GPUComputePassEncoder, g: GrowthBuffers, grow: boolean) {
    const k = this.kernels.growth();
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
    const used = (name: keyof GrowthKernels, extra: GPUBuffer | null = null) =>
      [...resources, extra].map((r, i) => (GROWTH_BINDINGS[name].includes(i) ? r : null));
    const run = (name: keyof GrowthKernels, groups: [number, number]) => {
      const pipeline = k[name];
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.bind(`grow-${name}${a}${moved}`, pipeline, used(name)));
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
          pass.setBindGroup(0, this.bind(`grow-${name}${i + 1}`, pipeline, used(name, level)));
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
    after2.setBindGroup(0, this.bind(`grow-birth${a}${moved}`, k.birth, used('birth')));
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
    const key = `diffuse${p}${q}`;
    let g = this.bindCache.get(key);
    if (!g) {
      const views = [this.trailViews[p], this.scentViews[p], this.trailViews[flip(p)], this.scentViews[flip(p)]];
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
  /** The first diffusion pass with covered food (diffuse.wgsl COVERED), by variantKey(). */
  private readonly coveredPipelines = new Map<string, GPUComputePipeline>();
  private capacityPipelines?: Starts;
  private growthPipelines?: GrowthKernels;

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
  ) {}

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

  /** The passes of growth and shrinkage (growth.wgsl), built at their first use: every scene has growth off. */
  growth(): GrowthKernels {
    if (!this.growthPipelines) {
      const module = this.device.createShaderModule({ code: common + growthWgsl });
      const pipeline = (entryPoint: string) =>
        this.device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } });
      this.growthPipelines = {
        rowSums: pipeline('rowSums'),
        windowSums: pipeline('windowSums'),
        test: pipeline('test'),
        win: pipeline('win'),
        buildCells: pipeline('buildCells'),
        buildDead: pipeline('buildDead'),
        birth: pipeline('birth'),
      };
    }
    return this.growthPipelines;
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

  /** A first diffusion pass with covered food (diffuse.wgsl COVERED), built at its first use. */
  covered(v: Diffuse): GPUComputePipeline {
    const key = variantKey(v);
    let p = this.coveredPipelines.get(key);
    if (!p) {
      const constants = { FIRST: 1, LAST: Number(v.last), BLUR: Number(v.blur), COVERED: 1 };
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

  diffuse(v: Diffuse): GPUComputePipeline {
    const p = this.variants.get(variantKey(v));
    if (!p) throw new Error(`No diffusion pipeline for variant ${variantKey(v)}`);
    return p;
  }

  private static async build(
    device: GPUDevice,
    agentsSource: string,
    diffuseSource: string,
    initSource: string,
  ): Promise<Kernels> {
    const module = (code: string) => device.createShaderModule({ code: common + code });
    const agents = module(agentsSource);
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
    const plans = [0, 1, 2, 3, 4].flatMap(diffusePlan);
    const unique = [...new Map(plans.map((v) => [variantKey(v), v])).values()];
    const variants = Promise.all(
      unique.map(
        async (v) =>
          [
            variantKey(v),
            await device.createComputePipelineAsync({
              layout,
              compute: {
                module: diffuseModule,
                entryPoint: 'diffuse',
                constants: { FIRST: Number(v.first), LAST: Number(v.last), BLUR: Number(v.blur) },
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

function variantKey(v: Diffuse) {
  return `${+v.first}${+v.last}${+v.blur}`;
}
