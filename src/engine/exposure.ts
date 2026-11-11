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
 * steps of √2. The scent view's mark (scent.ts) moves with it, so it must not jump between bins. Within the bin the
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

/** The trail of a strand for the scent view's mark: the white level's percentile, within its bin (Levels.strand). */
export const strandLevel = (bins: ArrayLike<number>, cells: number) => levelWithin(bins, cells, WHITE);

/** Share of a new measurement that the strand level takes: slower than the exposure, so the mark does not jitter. */
export const STRAND_BLEND = 0.1;

/** Auto levels: black at the 65th, white at the 99th percentile (like Fogleman's percentile levels). */
export function levels(bins: ArrayLike<number>, cells: number): { black: number; gain: number } | undefined {
  const white = levelAbove(bins, cells, WHITE);
  if (white === undefined) return undefined; // (almost) empty field: keep the old levels
  const black = Math.min(levelAbove(bins, cells, BLACK) ?? 0, 0.8 * white);
  return { black, gain: TARGET / (white - black) };
}

/** Auto exposure: a GPU histogram every few frames, read back without stalling, smoothed over time. */
export class AutoExposure {
  private readonly pipeline: GPUComputePipeline;
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
    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: histogramWgsl }), entryPoint: 'histogram' },
    });
    this.bins = device.createBuffer({
      size: BINS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.readback = device.createBuffer({ size: BINS * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }

  /** Call once per frame; `fallback` is used until the first measurement. */
  update(trail: GPUTexture, fallback: number): number {
    if (this.gain === 0) this.gain = fallback;
    if (this.pending || this.frame++ % 6 !== 0) return this.gain;
    void this.measure(trail, 0.25);
    return this.gain;
  }

  /**
   * Measures now; `blend` 1 jumps to the result (tests), smaller values smooth. Waits for a measurement that is still
   * running, so `blend` 1 always gets its own.
   */
  async measure(trail: GPUTexture, blend = 1): Promise<void> {
    const l = await this.read(trail);
    if (l) this.apply(l, blend);
  }

  /**
   * The levels measured now, without changing the levels that frames use: an export draws with them, and the line of
   * the scent view goes on from its smoothed strand (ADR 0009). Undefined for an (almost) empty field or a replaced
   * simulation.
   */
  async read(trail: GPUTexture): Promise<Levels | undefined> {
    while (this.pending) await this.pending;
    const run = this.histogram(trail);
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

  private async histogram(trail: GPUTexture): Promise<Levels | undefined> {
    const generation = this.generation;
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.bins);
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: trail.createView() },
          { binding: 1, resource: { buffer: this.bins } },
        ],
      }),
    );
    pass.dispatchWorkgroups(Math.ceil(trail.width / 16), Math.ceil(trail.height / 16));
    pass.end();
    enc.copyBufferToBuffer(this.bins, 0, this.readback, 0, BINS * 4);
    this.device.queue.submit([enc.finish()]);
    const cells = trail.width * trail.height;
    try {
      await this.readback.mapAsync(GPUMapMode.READ);
      const bins = new Uint32Array(this.readback.getMappedRange());
      const l = levels(bins, cells);
      const strand = strandLevel(bins, cells);
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
