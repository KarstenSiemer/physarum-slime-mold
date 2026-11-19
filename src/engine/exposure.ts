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

/** The trail of a strand for the scent view's line: the white level's percentile, within its bin (Levels.strand). */
export const strandLevel = (bins: ArrayLike<number>, cells: number) => levelWithin(bins, cells, WHITE);

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
 * Auto levels: black at the 65th, white at the 99th percentile (like Fogleman's percentile levels). `held`: with one
 * agent per cell, the histogram of the same trail over the cells that hold an agent. The black level then stays at or
 * below PLASM_EDGE times their median (ADR 0062): the 65th percentile takes 65 % of the grid for background, and where
 * the plasm covers more than 35 % of it, it would draw the weaker part of the plasm black.
 */
export function levels(
  bins: ArrayLike<number>,
  cells: number,
  held?: ArrayLike<number>,
): { black: number; gain: number } | undefined {
  const white = levelAbove(bins, cells, WHITE);
  if (white === undefined) return undefined; // (almost) empty field: keep the old levels
  const plasm = held && plasmLevel(held);
  const edge = plasm === undefined ? Infinity : PLASM_EDGE * plasm;
  const black = Math.min(levelAbove(bins, cells, BLACK) ?? 0, 0.8 * white, edge);
  return { black, gain: TARGET / (white - black) };
}

/**
 * The trail that a frame draws, the trail of the model (the same texture without the picture of the tubes), and, with
 * one agent per cell, the agents per cell (Simulation.agentCells): the black level stays below the plasm (levels()).
 * Undefined without the rule.
 */
export type Trails = [drawn: GPUTexture, model: GPUTexture, agentCells: GPUBuffer | undefined];

/** Auto exposure: a GPU histogram every few frames, read back without stalling, smoothed over time. */
export class AutoExposure {
  private readonly module: GPUShaderModule;
  private readonly pipeline: GPUComputePipeline;
  /**
   * The histogram over the cells that hold an agent (histogram.wgsl `held`), built at the first measurement with one
   * agent per cell: a start builds only the passes that it runs (ADR 0049).
   */
  private heldPipeline: GPUComputePipeline | undefined;
  private readonly bins: GPUBuffer;
  private readonly readback: GPUBuffer;
  /** The measurement whose readback is still on its way. */
  private pending: Promise<void> | undefined;
  /** Counts reset() calls: a readback of a replaced simulation must not change the new levels. */
  private generation = 0;
  private frame = 0;
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
    // Three histograms: the trail that the frame draws, the trail of the model where that is another one, and the
    // trail that the frame draws over the cells that hold an agent.
    this.readback = device.createBuffer({ size: BINS * 12, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }

  private pipelineOf(entryPoint: 'histogram' | 'held') {
    return this.device.createComputePipeline({ layout: 'auto', compute: { module: this.module, entryPoint } });
  }

  /**
   * Call once per frame; `fallback` is used until the first measurement. `trails`: see read(). It is the source of
   * every measurement, so the frames, a PNG and a test measure the same textures and the same agents.
   */
  update(trails: () => Trails | undefined, fallback: number): number {
    if (this.gain === 0) this.gain = fallback;
    if (this.pending || this.frame++ % 6 !== 0) return this.gain;
    // No measurement is running, so this one encodes at once, with the textures of this frame.
    void this.measure(trails, 0.25);
    return this.gain;
  }

  /**
   * Measures now; `blend` 1 jumps to the result (tests), smaller values smooth. Waits for a measurement that is still
   * running, so `blend` 1 always gets its own. `trails`: see read().
   */
  async measure(trails: () => Trails | undefined, blend = 1): Promise<void> {
    const l = await this.read(trails);
    if (l) this.apply(l, blend);
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
  async read(trails: () => Trails | undefined): Promise<Levels | undefined> {
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

  private apply(l: Levels, blend: number) {
    this.gain += (l.gain - this.gain) * blend;
    this.black += (l.black - this.black) * blend;
    this.strand += (l.strand - this.strand) * (blend === 1 || this.strand === 0 ? 1 : STRAND_BLEND);
  }

  /**
   * The black level and the gain from the trail that the frame draws, and the strand from the trail of the model. With
   * one agent per cell, a third histogram counts the trail that the frame draws over the cells that hold an agent
   * (levels()). All histograms go into one submission, before any wait: a texture may be freed while the readback is
   * on its way.
   */
  private async histogram(trail: GPUTexture, model: GPUTexture, agentCells?: GPUBuffer): Promise<Levels | undefined> {
    const generation = this.generation;
    const textures = model === trail ? [trail] : [trail, model];
    const enc = this.device.createCommandEncoder();
    /** One histogram of `texture` into part `slot` of the readback; `occ`: over the cells that hold an agent. */
    const count = (texture: GPUTexture, slot: number, occ?: GPUBuffer) => {
      const pipeline = occ ? (this.heldPipeline ??= this.pipelineOf('held')) : this.pipeline;
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
    });
    if (agentCells) count(trail, 2, agentCells);
    this.device.queue.submit([enc.finish()]);
    const cells = trail.width * trail.height;
    try {
      await this.readback.mapAsync(GPUMapMode.READ);
      const all = new Uint32Array(this.readback.getMappedRange());
      const drawn = all.subarray(0, BINS);
      const l = levels(drawn, cells, agentCells && all.subarray(2 * BINS, 3 * BINS));
      const strand = strandLevel(textures.length > 1 ? all.subarray(BINS, 2 * BINS) : drawn, cells);
      this.readback.unmap();
      return l && generation === this.generation ? { ...l, strand } : undefined;
    } catch {
      return undefined; // device lost or buffer destroyed: nothing to measure
    }
  }

  reset() {
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
