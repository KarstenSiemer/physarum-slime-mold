import { at } from './at';
import bloomWgsl from './shaders/bloom.wgsl?raw';

const LEVELS = 5;
const FORMAT: GPUTextureFormat = 'rgba16float';

interface Chain {
  width: number;
  height: number;
  levels: GPUTexture[];
  /** Stable view of level 0, the result (render bind groups are cached by it). */
  out: GPUTextureView;
  /** Index 0: prefilter; 1–4: downsample (source level i − 1); 5–8: upsample (source level 4 … 1). */
  uniforms: GPUBuffer[];
  /** Bind groups per trail texture (ping-pong) and sampler mode (0 clamp, 1 repeat). */
  groups: Map<GPUTexture, GPUBindGroup[][]>;
}

/** Soft glow: a blurred mip chain of the exposed trail, one lane per strain (see bloom.wgsl). */
export class Bloom {
  private readonly prefilter: GPURenderPipeline;
  private readonly down: GPURenderPipeline;
  private readonly up: GPURenderPipeline;
  readonly samplers: GPUSampler[];
  private chain: Chain | undefined;
  private readonly gain = new Float32Array(4);

  constructor(private readonly device: GPUDevice) {
    const module = device.createShaderModule({ code: bloomWgsl });
    const pipeline = (entryPoint: string, blend?: GPUBlendState) =>
      device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint, targets: [{ format: FORMAT, ...(blend ? { blend } : {}) }] },
      });
    const add: GPUBlendComponent = { operation: 'add', srcFactor: 'one', dstFactor: 'one' };
    this.prefilter = pipeline('prefilter');
    this.down = pipeline('down');
    this.up = pipeline('up', { color: add, alpha: add });
    this.samplers = (['clamp-to-edge', 'repeat'] as const).map((mode) =>
      device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: mode, addressModeV: mode }),
    );
  }

  /** Blurs `trail × gain` and returns the half-resolution result for the render pass. */
  run(trail: GPUTexture, gain: number, black: number, wrap: boolean): GPUTextureView {
    const c = this.ensure(trail);
    const groups = at(this.groupsFor(c, trail), wrap ? 1 : 0);
    this.gain[2] = gain;
    this.gain[3] = black;
    this.device.queue.writeBuffer(at(c.uniforms, 0), 0, this.gain);
    const enc = this.device.createCommandEncoder();
    const draw = (pipeline: GPURenderPipeline, group: number, target: number, load: boolean) => {
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: at(c.levels, target).createView(),
            loadOp: load ? 'load' : 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 0],
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, at(groups, group));
      pass.draw(3);
      pass.end();
    };
    draw(this.prefilter, 0, 0, false);
    for (let i = 1; i < LEVELS; i++) draw(this.down, i, i, false);
    for (let k = 0; k < LEVELS - 1; k++) draw(this.up, LEVELS + k, LEVELS - 2 - k, true);
    this.device.queue.submit([enc.finish()]);
    return this.view(trail);
  }

  /** The current half-resolution result. */
  view(trail: GPUTexture): GPUTextureView {
    return this.ensure(trail).out;
  }

  private ensure(trail: GPUTexture): Chain {
    if (this.chain?.width === trail.width && this.chain.height === trail.height) return this.chain;
    this.destroy();
    const levels = Array.from({ length: LEVELS }, (_, i) =>
      this.device.createTexture({
        size: [Math.max(1, Math.ceil(trail.width / 2 ** (i + 1))), Math.max(1, Math.ceil(trail.height / 2 ** (i + 1)))],
        format: FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      }),
    );
    const sources = [trail, ...levels.slice(0, LEVELS - 1), ...levels.slice(1).reverse()];
    const uniforms = sources.map((src) => {
      const b = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(b, 0, new Float32Array([1 / src.width, 1 / src.height, 0, 0]));
      return b;
    });
    const out = at(levels, 0).createView();
    this.chain = { width: trail.width, height: trail.height, levels, out, uniforms, groups: new Map() };
    return this.chain;
  }

  private groupsFor(c: Chain, trail: GPUTexture): GPUBindGroup[][] {
    let g = c.groups.get(trail);
    if (g) return g;
    const sources = [...c.levels.slice(0, LEVELS - 1), ...c.levels.slice(1).reverse()];
    const uniform = (i: number) => ({ buffer: at(c.uniforms, i) });
    g = this.samplers.map((sampler) => [
      this.device.createBindGroup({
        layout: this.prefilter.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: uniform(0) },
          { binding: 3, resource: trail.createView() },
        ],
      }),
      ...sources.map((src, k) =>
        this.device.createBindGroup({
          layout: (k < LEVELS - 1 ? this.down : this.up).getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: uniform(k + 1) },
            { binding: 1, resource: src.createView() },
            { binding: 2, resource: sampler },
          ],
        }),
      ),
    ]);
    c.groups.set(trail, g);
    return g;
  }

  destroy() {
    for (const t of this.chain?.levels ?? []) t.destroy();
    for (const b of this.chain?.uniforms ?? []) b.destroy();
    this.chain = undefined;
  }
}
