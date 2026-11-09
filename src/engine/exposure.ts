import histogramWgsl from './shaders/histogram.wgsl?raw';

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
  private pending = false;
  private frame = 0;
  /** Linear gain from trail units to radiance, applied after subtracting `black`. */
  gain = 0;
  /** Summed trail level shown as black. */
  black = 0;

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

  /** Measures now; `blend` 1 jumps to the result (exports, tests), smaller values smooth. */
  async measure(trail: GPUTexture, blend = 1): Promise<void> {
    if (this.pending) return;
    this.pending = true;
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
      const l = levels(new Uint32Array(this.readback.getMappedRange()), cells);
      this.readback.unmap();
      if (l) {
        this.gain += (l.gain - this.gain) * blend;
        this.black += (l.black - this.black) * blend;
      }
    } catch {
      // device lost or buffer destroyed: nothing to measure
    } finally {
      this.pending = false;
    }
  }

  reset() {
    this.gain = 0;
    this.black = 0;
  }

  destroy() {
    this.bins.destroy();
    this.readback.destroy();
  }
}
