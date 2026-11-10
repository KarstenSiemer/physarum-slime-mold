import { BOUNDARIES, type Settings } from '../model/params';
import { paintBox, paintSegments, type Rect } from './brush';
import { packParams, PARAMS_BYTES, startRounds, type AgentTool } from './pack';
import { readBuffer, readTexture } from './readback';
import agentsWgsl from './shaders/agents.wgsl?raw';
import common from './shaders/common.wgsl?raw';
import diffuseWgsl from './shaders/diffuse.wgsl?raw';
import initWgsl from './shaders/init.wgsl?raw';
import paintWgsl from './shaders/paint.wgsl?raw';
import sortWgsl from './shaders/sort.wgsl?raw';
import { diffusePlan, type Diffuse } from './sizing';
import { EnvKind, type AgentState, type Sim, type Stroke } from './types';

const AGENT_BYTES = 16;
const GROUP = 256;
const TILE = 16;
/** Brush segments per submission (paint()): 4096 slots of 256 bytes. */
const BRUSH_CHUNK = 4096;
/** Steps between two spatial sorts of the agents. Measured: their locality halves about 150 steps after a sort. */
const SORT_INTERVAL = 32;
/** Cells per side of a sort tile (sort.wgsl SHIFT). */
const SORT_TILE = 8;

type Pair<T> = [T, T];
type Bit = 0 | 1;
const flip = (b: Bit): Bit => (b === 0 ? 1 : 0);
/** All simulation state on the GPU for one grid size and agent count (WebGPU). */
export class Simulation implements Sim {
  step = 0;
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
  readonly stats: GPUBuffer;
  private collision?: { occ: Pair<GPUBuffer>; claims: GPUBuffer };
  private paintGroup?: GPUBindGroup;
  /** A wall was painted since the last clear: moves then check every cell they cross (agents.wgsl clearPath). */
  private walls = false;
  private readonly groups: [number, number];
  private readonly bindCache = new Map<string, GPUBindGroup>();

  private constructor(
    readonly device: GPUDevice,
    private readonly kernels: Kernels,
    settings: Settings,
    readonly width: number,
    readonly height: number,
    readonly agents: number,
  ) {
    this.settings = settings;
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
    this.stats = buffer(16, STORAGE | COPY_SRC | COPY_DST);
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

  static async create(device: GPUDevice, settings: Settings, width: number, height: number, agents: number) {
    const sim = new Simulation(device, await Kernels.get(device), settings, width, height, agents);
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

  /** Applies new parameters. Grid size and agent count need a new Simulation instead. */
  update(settings: Settings) {
    const switchedOn = settings.collisions && !this.settings.collisions;
    this.settings = settings;
    if (switchedOn) this.rebuildOccupancy();
  }

  reset() {
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
    pass.setPipeline(this.kernels.init);
    pass.setBindGroup(
      0,
      this.bind(`init${this.agentParity}`, this.kernels.init, [this.params, this.agentBuffer, null, null, this.env]),
    );
    pass.dispatchWorkgroups(...this.groups);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    if (this.settings.collisions) {
      this.placeOnFreeCells();
      this.rebuildOccupancy();
    }
  }

  /**
   * One agent per cell from the first step (ADR 0008): claim rounds after init (init.wgsl, startRounds()). Each
   * round needs its number in the parameters, so it is a submission of its own.
   */
  private placeOnFreeCells() {
    const col = this.ensureCollision();
    const q = flip(this.occParity);
    const occ = col.occ[q];
    const k = this.kernels;
    const resources = [this.params, this.agentBuffer, null, null, this.env, null, null, occ, col.claims];
    const claim = this.bind(`claimStart${this.agentParity}${q}`, k.claimStart, resources);
    const settle = this.bind(`settleStart${this.agentParity}${q}`, k.settleStart, resources);
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

  /** Runs `steps` simulation steps. The agent tool acts on the first step only. */
  run(steps: number, tool?: AgentTool) {
    for (let k = 0; k < steps; k++) {
      this.writeParams(k === 0 ? tool : undefined);
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
   */
  paint(strokes: readonly Stroke[]) {
    if (strokes.length === 0) return;
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
        { binding: 2, resource: { buffer: this.brushes, size: 32 } },
      ],
    });
    // Every stroke as segments the pass paints exactly, each with the box of cells it can reach (brush.ts).
    const segments: Stroke[] = [];
    const boxes: Rect[] = [];
    const offsets: number[] = [];
    for (const stroke of strokes) {
      const boundary = stroke.boundary ?? this.settings.boundary;
      const wrap = boundary === 'wrap';
      if (stroke.kind === 'wall') this.walls = true;
      for (const segment of paintSegments(stroke, this.width, this.height, wrap)) {
        const box = paintBox(segment, this.width, this.height, wrap);
        if (!box) continue;
        segments.push(segment);
        boxes.push(box);
        offsets.push(BOUNDARIES.indexOf(boundary) * this.paramsStep);
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
        const o = (j * step) / 4;
        [f[o], f[o + 1], f[o + 2], f[o + 3]] = [from[0], from[1], to[0], to[1]];
        [i32[o + 4], i32[o + 5]] = [x, y];
        f[o + 6] = radius;
        u[o + 7] = EnvKind[kind];
      });
      this.device.queue.writeBuffer(this.brushes, 0, data);
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this.kernels.paint);
      chunk.forEach((_, j) => {
        const [, , w, h] = boxes[first + j] ?? [0, 0, 0, 0];
        pass.setBindGroup(0, this.paintGroup, [offsets[first + j] ?? 0, j * step]);
        pass.dispatchWorkgroups(Math.ceil(w / TILE), Math.ceil(h / TILE));
      });
      pass.end();
      this.device.queue.submit([enc.finish()]);
    }
  }

  clearEnvironment() {
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.env);
    this.device.queue.submit([enc.finish()]);
    this.walls = false;
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

  async readCounts(): Promise<Float32Array> {
    return Float32Array.from(new Uint32Array(await readBuffer(this.device, this.counts)));
  }

  async readEnv(): Promise<Uint8Array> {
    return new Uint8Array(await readBuffer(this.device, this.env));
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

  writeEnv(data: Uint8Array) {
    this.device.queue.writeBuffer(this.env, 0, data);
    this.walls = data.some((v, i) => i % 4 === 0 && v > 0);
  }

  destroy() {
    for (const t of [...this.trail, ...this.scent]) t.destroy();
    for (const b of [this.params, this.paintParams, this.brushes, ...this.agentBuffers, this.tiles, this.replacement])
      b.destroy();
    for (const b of [this.counts, this.env, this.stats]) b.destroy();
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
    const q = this.occParity;
    if (col) {
      enc.clearBuffer(col.claims);
      enc.clearBuffer(col.occ[flip(q)]);
    }
    const pass = enc.beginComputePass();
    if (sort) this.encodeSort(pass);
    const a = this.agentParity;
    const [trail, scent] = [this.trailViews[p], this.scentViews[p]];
    if (!col) {
      pass.setPipeline(k.move);
      pass.setBindGroup(
        0,
        this.bind(`move${p}${a}`, k.move, [
          this.params,
          this.agentBuffer,
          trail,
          scent,
          this.env,
          this.counts,
          this.stats,
        ]),
      );
      pass.dispatchWorkgroups(...this.groups);
    } else {
      const [occ, next] = [col.occ[q], col.occ[flip(q)]];
      pass.setPipeline(k.claim);
      pass.setBindGroup(
        0,
        this.bind(`claim${p}${q}${a}`, k.claim, [
          this.params,
          this.agentBuffer,
          trail,
          scent,
          this.env,
          null,
          null,
          occ,
          col.claims,
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
        ]),
      );
      pass.dispatchWorkgroups(...this.groups);
      this.occParity = flip(q);
    }
    let d = p;
    for (const v of diffusePlan(this.settings.diffusion)) {
      pass.setPipeline(k.diffuse(v));
      pass.setBindGroup(0, this.diffuseBind(d));
      pass.dispatchWorkgroups(Math.ceil(this.width / TILE), Math.ceil(this.height / TILE));
      d = flip(d);
    }
    pass.end();
    this.parity = d;
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

  private diffuseBind(p: Bit) {
    const key = `diffuse${p}`;
    let g = this.bindCache.get(key);
    if (!g) {
      const views = [this.trailViews[p], this.scentViews[p], this.trailViews[flip(p)], this.scentViews[flip(p)]];
      g = this.device.createBindGroup({
        layout: this.kernels.diffuseLayout,
        entries: [this.params, ...views, this.env, this.counts].map((r, binding) => entry(binding, r)),
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

/** Compiled pipelines, shared by every Simulation on one device. */
class Kernels {
  private static readonly cache = new WeakMap<GPUDevice, Promise<Kernels>>();

  private constructor(
    readonly init: GPUComputePipeline,
    readonly claimStart: GPUComputePipeline,
    readonly settleStart: GPUComputePipeline,
    readonly move: GPUComputePipeline,
    readonly claim: GPUComputePipeline,
    readonly settle: GPUComputePipeline,
    readonly occupy: GPUComputePipeline,
    readonly replace: GPUComputePipeline,
    readonly paint: GPUComputePipeline,
    readonly sort: Record<'countTiles' | 'scanTiles' | 'scatter', GPUComputePipeline>,
    readonly diffuseLayout: GPUBindGroupLayout,
    readonly paintLayout: GPUBindGroupLayout,
    private readonly variants: Map<string, GPUComputePipeline>,
  ) {}

  static get(device: GPUDevice): Promise<Kernels> {
    let k = Kernels.cache.get(device);
    if (!k) {
      k = Kernels.build(device);
      Kernels.cache.set(device, k);
    }
    return k;
  }

  diffuse(v: Diffuse): GPUComputePipeline {
    const p = this.variants.get(variantKey(v));
    if (!p) throw new Error(`No diffusion pipeline for variant ${variantKey(v)}`);
    return p;
  }

  private static async build(device: GPUDevice): Promise<Kernels> {
    const module = (code: string) => device.createShaderModule({ code: common + code });
    const agents = module(agentsWgsl);
    const compute = (m: GPUShaderModule, entryPoint: string) =>
      device.createComputePipelineAsync({ layout: 'auto', compute: { module: m, entryPoint } });
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
      ],
    });
    // Brush strokes pick their brush and their boundary's parameters by dynamic offset (Simulation.paint).
    const paintLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true } },
        { binding: 1, visibility: C, buffer: { type: 'storage' } },
        { binding: 2, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true } },
      ],
    });
    const diffuseModule = module(diffuseWgsl);
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
    const start = module(initWgsl);
    const [init, claimStart, settleStart, move, claim, settle, occupy, replace, paint, countTiles, scanTiles, scatter] =
      await Promise.all([
        compute(start, 'init'),
        compute(start, 'claimStart'),
        compute(start, 'settleStart'),
        compute(agents, 'advance'),
        compute(agents, 'claim'),
        compute(agents, 'settle'),
        compute(agents, 'occupy'),
        compute(agents, 'replace'),
        device.createComputePipelineAsync({
          layout: device.createPipelineLayout({ bindGroupLayouts: [paintLayout] }),
          compute: { module: module(paintWgsl), entryPoint: 'paint' },
        }),
        compute(sort, 'countTiles'),
        compute(sort, 'scanTiles'),
        compute(sort, 'scatter'),
      ]);
    const sorting = { countTiles, scanTiles, scatter };
    return new Kernels(
      init,
      claimStart,
      settleStart,
      move,
      claim,
      settle,
      occupy,
      replace,
      paint,
      sorting,
      diffuseLayout,
      paintLayout,
      new Map(await variants),
    );
  }
}

function variantKey(v: Diffuse) {
  return `${+v.first}${+v.last}${+v.blur}`;
}
