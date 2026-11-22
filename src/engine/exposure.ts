import histogramWgsl from './shaders/histogram.wgsl?raw';
import type { Levels } from './types';

const BINS = 64;
/** Fraction of cells allowed above the white level. */
const WHITE = 0.01;
/**
 * Fraction of cells above the black level (65th percentile). Sparse networks have > 65 % empty
 * cells, so black stays 0; dense fields (Jones' lacunae cover ~60 %) get a dark background.
 */
const BLACK = 0.35;
/** Radiance the white level maps to (before tone mapping). */
const TARGET = 1.3;
/**
 * With one agent per cell the agents are the plasm, and the black level stays at or below this share of the median
 * trail of the cells that hold an agent (ADR 0062). The mean of the diffusion is symmetric, so at the edge of a wide
 * band of plasm the trail is half of the trail inside it: a black level above that half cuts into the plasm.
 */
export const PLASM_EDGE = 0.5;
/** The top of the lowest bin of the histograms: where the median of the agents lies below it, most hold no trail. */
const LOWEST = 2 ** -9.5;

/**
 * Trail level that a `fraction` of all cells exceed, from log₂ histogram bins (see histogram.wgsl).
 * Empty cells count as zero. Undefined if fewer cells than that fraction hold any trail.
 */
export function levelAbove(bins: ArrayLike<number>, cells: number, fraction: number): number | undefined {
  let above = 0;
  for (let b = BINS - 1; b >= 0; b--) {
    above += bins[b] ?? 0;
    if (above >= fraction * cells) return 2 ** ((b + 0.5) / 2 - 10);
  }
  return undefined;
}

/**
 * The trail level that a `fraction` of all cells exceed, read within its log₂ bin: levelAbove() gives the bin's centre,
 * steps of √2. The scent view's line (scent.ts) moves with it, so it must not jump between bins. Within the bin the
 * cells are taken to thin out (or gather) exponentially, at the rate of the bins below and above it: in the tail of the
 * trail fewer cells hold more, so most of a bin's cells lie at its low end. In 60 states of 15 scenes this read the
 * 99th percentile within 3.2 % of the exact one; a flat share within the bin read it up to 20 % high (review of
 * 2026-11-11, ADR 0009). 0 if fewer cells than that fraction hold any trail.
 */
export function levelWithin(bins: ArrayLike<number>, cells: number, fraction: number): number {
  let above = 0;
  for (let b = BINS - 1; b >= 0; b--) {
    const n = bins[b] ?? 0;
    if (n > 0 && above + n >= fraction * cells) {
      const need = fraction * cells - above; // cells of this bin above the level
      const rate = Math.min(8, Math.max(-8, 0.5 * Math.log(((bins[b + 1] ?? 0) + 1) / ((bins[b - 1] ?? 0) + 1))));
      // The share x of the bin below the level: the cells above x are need.
      const x = Math.abs(rate) < 1e-6 ? 1 - need / n : Math.log(Math.exp(rate) - (need * Math.expm1(rate)) / n) / rate;
      return 2 ** ((b + Math.min(1, Math.max(0, x))) / 2 - 10);
    }
    above += n;
  }
  return 0;
}

/**
 * The trail of a strand for the scent view's line: the white level's percentile, within its bin (Levels.strand), and
 * never below `floor`, the floor of the white level in the trail of the model (whiteFloor(), ADR 0090).
 */
export const strandLevel = (bins: ArrayLike<number>, cells: number, floor = 0) =>
  Math.max(levelWithin(bins, cells, WHITE), floor);

/** Share of a new measurement that the strand level takes: slower than the exposure, so the line does not jitter. */
export const STRAND_BLEND = 0.1;

/**
 * The median of the trail of the cells that hold an agent, from their histogram `held`, read within its bin
 * (levelWithin()). A cell with an agent and without trail counts in the lowest bin (histogram.wgsl `held`). Undefined
 * while no cell holds an agent.
 */
export function plasmLevel(held: ArrayLike<number>): number | undefined {
  let agents = 0;
  for (let b = 0; b < BINS; b++) agents += held[b] ?? 0;
  return agents > 0 ? levelWithin(held, agents, 0.5) : undefined;
}

/**
 * The floor of the white level (ADR 0090): the median trail of the cells that hold an agent (plasmLevel()). 0 while no
 * cell holds an agent, and while their median lies in the lowest bin: most of the agents hold no trail yet, as in the
 * step of an inoculation, and the floor would give a gain of a thousand.
 */
export function whiteFloor(held?: ArrayLike<number>): number {
  const plasm = held && plasmLevel(held);
  return plasm !== undefined && plasm > LOWEST ? plasm : 0;
}

/**
 * Auto levels: black at the 65th, white at the 99th percentile (like Fogleman's percentile levels). `held`: the
 * histogram of the same trail over the cells that hold an agent: with one agent per cell (`one`) the cells of the
 * agents, without the rule the cells that an agent moved into in the step.
 * - The white level is never below the median trail of those cells (whiteFloor(), ADR 0090). A colony on less than 1 %
 *   of the grid puts the 99th percentile on the faint trail that the diffusion spreads around it, and the picture drew
 *   its plasm as a blob. Where the agents cover more than about 2 % of the grid, the 99th percentile lies above it.
 * - With one agent per cell the black level stays at or below PLASM_EDGE times their median (ADR 0062): the 65th
 *   percentile takes 65 % of the grid for background, and where the plasm covers more than 35 % of it, it would draw
 *   the weaker part of the plasm black. Without the rule agents share cells, and the 65th percentile is the look of
 *   the dense scenes.
 * Undefined for an (almost) empty field: fewer than 1 % of the cells hold trail, and no agent holds trail.
 */
export function levels(
  bins: ArrayLike<number>,
  cells: number,
  held?: ArrayLike<number>,
  one = true,
): { black: number; gain: number; white: number } | undefined {
  const white = Math.max(levelAbove(bins, cells, WHITE) ?? 0, whiteFloor(held));
  if (white === 0) return undefined; // (almost) empty field: keep the old levels
  const plasm = one && held ? plasmLevel(held) : undefined;
  const edge = plasm === undefined ? Infinity : PLASM_EDGE * plasm;
  const black = Math.min(levelAbove(bins, cells, BLACK) ?? 0, 0.8 * white, edge);
  return { black, gain: TARGET / (white - black), white };
}

/** The levels of a measurement, with its white level and the floor of it (levels(), whiteFloor()). */
export type Measured = Levels & { white: number; floor: number };

/**
 * The levels of the frames after a measurement `l`: they take the share `blend` of it, so the picture changes slowly,
 * and the strand the share STRAND_BLEND (none with a `blend` of 0). But the floor of the white level holds at once
 * (ADR 0090): where the white level of the frames lies below it, they take the whole measurement. And while the floor
 * sets the white level, the frames brighten no higher than the gain `fixed` with which they start. The trail of a new
 * colony grows from nothing to its plasm in a few steps, by up to 2.6 times from one frame to the next: a gain from
 * its first steps would draw it white, and the smoothing would hold such a gain for a while.
 */
export function smooth(now: Levels, l: Measured, blend: number, fixed = Infinity): Levels {
  const jump = blend === 1 || TARGET / now.gain + now.black < l.floor;
  const share = jump ? 1 : blend;
  const gain = now.gain + (l.gain - now.gain) * share;
  return {
    gain: jump || l.white > l.floor ? gain : Math.min(gain, Math.max(now.gain, fixed)),
    black: now.black + (l.black - now.black) * share,
    strand: now.strand + (l.strand - now.strand) * (jump || now.strand === 0 ? 1 : blend && STRAND_BLEND),
  };
}

/**
 * Whether the frames measure again in the next frame, not after their usual pause (ADR 0090): while the floor sets
 * the white level, the colony is small, and its trail can double in two frames. While a measurement gives nothing,
 * a colony on an empty dish must not wait for the next turn either. Such a measurement only holds the floor: it has
 * a `blend` of 0 in smooth(), so the picture brightens at the pace of before.
 */
export const measureSoon = (l: Measured | undefined) => !l || l.white <= l.floor;

/**
 * The trail that a frame draws, the trail of the model (the same texture without the picture of the tubes), with one
 * agent per cell the agents per cell (Simulation.agentCells), and without the rule the agents that moved into each
 * cell in the step, four strains per cell (Simulation.movedCells). levels() reads the trail of those cells.
 */
export type Trails = [
  drawn: GPUTexture,
  model: GPUTexture,
  agentCells: GPUBuffer | undefined,
  movedCells: GPUBuffer | undefined,
];

/** Auto exposure: a GPU histogram every few frames, read back without stalling, smoothed over time. */
export class AutoExposure {
  private readonly module: GPUShaderModule;
  private readonly pipeline: GPUComputePipeline;
  /**
   * The histogram over the cells that hold an agent (histogram.wgsl `held`), built at the first measurement with one
   * agent per cell: a start builds only the passes that it runs (ADR 0049).
   */
  private heldPipeline: GPUComputePipeline | undefined;
  /** The same over the cells that an agent moved into, without the rule (histogram.wgsl `moved`, ADR 0090). */
  private movedPipeline: GPUComputePipeline | undefined;
  private readonly bins: GPUBuffer;
  private readonly readback: GPUBuffer;
  /** The measurement whose readback is still on its way. */
  private pending: Promise<void> | undefined;
  /** Counts reset() calls: a readback of a replaced simulation must not change the new levels. */
  private generation = 0;
  private frame = 0;
  /** Measure in the next frame, not only in every sixth one (measureSoon()). */
  private soon = true;
  /** A turn of every sixth frame has come, and no measurement has taken its share yet (smooth()). */
  private due = true;
  /** Linear gain from trail units to radiance, applied after subtracting `black`. */
  gain = 0;
  /** Summed trail level shown as black. */
  black = 0;
  /** The trail of a strand (Levels.strand). */
  strand = 0;

  constructor(private readonly device: GPUDevice) {
    this.module = device.createShaderModule({ code: histogramWgsl });
    this.pipeline = this.pipelineOf('histogram');
    this.bins = device.createBuffer({
      size: BINS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    // Four histograms: the trail that the frame draws, the trail of the model where that is another one, and the same
    // two over the cells that hold an agent.
    this.readback = device.createBuffer({ size: BINS * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }

  private pipelineOf(entryPoint: 'histogram' | 'held' | 'moved') {
    return this.device.createComputePipeline({ layout: 'auto', compute: { module: this.module, entryPoint } });
  }

  /**
   * Call once per frame; `fallback` is used until the first measurement. `trails`: see read(). It is the source of
   * every measurement, so the frames, a PNG and a test measure the same textures and the same agents.
   */
  update(trails: () => Trails | undefined, fallback: number): number {
    if (this.gain === 0) this.gain = fallback;
    if (this.frame++ % 6 === 0) this.due = true;
    if (this.pending || !(this.due || this.soon)) return this.gain;
    // No measurement is running, so this one encodes at once, with the textures of this frame. Between two turns it
    // only holds the floor of the white level (measureSoon()).
    void this.measure(trails, this.due ? 0.25 : 0, fallback);
    this.due = false;
    return this.gain;
  }

  /**
   * Measures now; `blend` 1 jumps to the result (tests), smaller values smooth. Waits for a measurement that is still
   * running, so `blend` 1 always gets its own. `trails`: see read().
   */
  async measure(trails: () => Trails | undefined, blend = 1, fixed?: number): Promise<void> {
    const l = await this.read(trails);
    if (l) this.apply(l, blend, fixed);
    this.soon = measureSoon(l);
  }

  /**
   * The levels measured now, without changing the levels that frames use: an export draws with them, and the line of
   * the scent view goes on from its smoothed strand (ADR 0009). Undefined for an (almost) empty field or a replaced
   * simulation. `trails` gives the trail that the frame draws, the trail of the model, where the frame draws another
   * one (the picture of the tubes, ADR 0034: the strand is a level of the model's trail), and with one agent per cell
   * the agents per cell (Trails). It is asked after the wait
   * for a measurement that is still running: new settings can free a texture meanwhile (the picture of the tubes, the
   * view of a step that moves first). It gives nothing if the simulation was destroyed in that time.
   */
  async read(trails: () => Trails | undefined): Promise<Measured | undefined> {
    while (this.pending) await this.pending;
    const textures = trails();
    if (!textures) return undefined;
    const run = this.histogram(...textures);
    this.pending = run
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => (this.pending = undefined));
    return run;
  }

  private apply(l: Measured, blend: number, fixed?: number) {
    ({ gain: this.gain, black: this.black, strand: this.strand } = smooth(this, l, blend, fixed));
  }

  /**
   * The black level and the gain from the trail that the frame draws, and the strand from the trail of the model. Two
   * more histograms count both trails over the cells that hold an agent (levels(), strandLevel()): with one agent per
   * cell over `agentCells`, without the rule over the cells that an agent moved into (`movedCells`). All histograms go
   * into one submission, before any wait: a texture may be freed while the readback is on its way.
   */
  private async histogram(
    trail: GPUTexture,
    model: GPUTexture,
    agentCells?: GPUBuffer,
    movedCells?: GPUBuffer,
  ): Promise<Measured | undefined> {
    const generation = this.generation;
    const textures = model === trail ? [trail] : [trail, model];
    const cellsOf = agentCells ?? movedCells;
    const enc = this.device.createCommandEncoder();
    /** One histogram of `texture` into part `slot` of the readback; `occ`: over the cells that hold an agent. */
    const count = (texture: GPUTexture, slot: number, occ?: GPUBuffer) => {
      const pipeline = !occ
        ? this.pipeline
        : agentCells
          ? (this.heldPipeline ??= this.pipelineOf('held'))
          : (this.movedPipeline ??= this.pipelineOf('moved'));
      enc.clearBuffer(this.bins);
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        this.device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: texture.createView() },
            { binding: 1, resource: { buffer: this.bins } },
            ...(occ ? [{ binding: 2, resource: { buffer: occ } }] : []),
          ],
        }),
      );
      pass.dispatchWorkgroups(Math.ceil(texture.width / 16), Math.ceil(texture.height / 16));
      pass.end();
      enc.copyBufferToBuffer(this.bins, 0, this.readback, slot * BINS * 4, BINS * 4);
    };
    textures.forEach((texture, i) => {
      count(texture, i);
      if (cellsOf) count(texture, 2 + i, cellsOf);
    });
    this.device.queue.submit([enc.finish()]);
    const cells = trail.width * trail.height;
    try {
      await this.readback.mapAsync(GPUMapMode.READ);
      const all = new Uint32Array(this.readback.getMappedRange());
      const part = (k: number) => all.subarray(k * BINS, (k + 1) * BINS);
      const [drawn, held] = [part(0), cellsOf && part(2)];
      const l = levels(drawn, cells, held, agentCells !== undefined);
      const two = textures.length > 1;
      const strand = strandLevel(two ? part(1) : drawn, cells, whiteFloor(two ? cellsOf && part(3) : held));
      const floor = whiteFloor(held);
      this.readback.unmap();
      return l && generation === this.generation ? { ...l, strand, floor } : undefined;
    } catch {
      return undefined; // device lost or buffer destroyed: nothing to measure
    }
  }

  reset() {
    this.soon = true;
    this.due = true;
    this.gain = 0;
    this.black = 0;
    this.strand = 0;
    this.generation++;
  }

  destroy() {
    this.bins.destroy();
    this.readback.destroy();
  }
}
