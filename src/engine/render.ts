import { hexToLinear } from '../model/color';
import { BOUNDARIES, MAX_STRAINS, STYLES, type Settings } from '../model/params';
import { readPixels } from './readback';
import renderWgsl from './shaders/render.wgsl?raw';
import type { Simulation } from './sim';
import type { View } from './types';

export const BACKGROUND: Record<Settings['style'], string> = {
  glow: '#05060a',
  gel: '#16140f',
  paper: '#f3efe6',
  agents: '#000000',
};

/** Everything one frame needs. */
export interface Frame {
  sim: Simulation;
  settings: Settings;
  view: View;
  /** Linear gain from trail units to radiance, applied above `black`. */
  exposure: number;
  /** Summed trail level shown as black (auto levels). */
  black: number;
  /** Half-resolution blurred trail (bloom.ts) and how to sample it. */
  bloom: GPUTextureView;
  sampler: GPUSampler;
}

export const VIEW_BYTES = 144;

/** Fills `struct View` (render.wgsl) — also the std140 `View` block of the WebGL2 renderer. */
export function packView(
  data: ArrayBuffer,
  width: number,
  height: number,
  view: View,
  exposure: number,
  black: number,
  settings: Settings,
  frame: number,
  overlays: boolean,
) {
  const fl = new Float32Array(data);
  const u = new Uint32Array(data);
  fl.set([width, height, ...view.center, view.scale, exposure], 0);
  u.set([STYLES.indexOf(settings.style), BOUNDARIES.indexOf(settings.boundary)], 6);
  const strains = settings.strains.slice(0, MAX_STRAINS); // 4 color slots; more would overwrite the next fields
  strains.forEach((s, i) => {
    fl.set(hexToLinear(s.color), 8 + i * 4);
  });
  fl.set(hexToLinear(BACKGROUND[settings.style]), 24);
  u.set([frame, strains.length, overlays ? 1 : 0, 0], 28);
  fl.set([settings.bloom, black, 0, 0], 32);
}

export class Renderer {
  private readonly pipeline: GPURenderPipeline;
  private readonly uniform: GPUBuffer;
  private readonly data = new ArrayBuffer(VIEW_BYTES);
  private readonly groups = new Map<GPUTexture, { group: GPUBindGroup; bloom: GPUTextureView; sampler: GPUSampler }>();
  private frame = 0;
  overlays = true;

  constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
  ) {
    const module = device.createShaderModule({ code: renderWgsl });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    });
    this.uniform = device.createBuffer({ size: VIEW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  /** Draws one frame to the canvas. */
  draw(f: Frame) {
    const { width, height } = this.context.canvas;
    this.encode(this.context.getCurrentTexture(), width, height, f);
  }

  /**
   * Renders one frame offscreen and reads it back as RGBA pixels (PNG export, tests). A WebGPU
   * canvas clears its buffer after presentation, so the canvas itself cannot be read later.
   */
  async capture(f: Frame, width: number, height: number): Promise<ImageData> {
    const texture = this.device.createTexture({
      size: [width, height],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.encode(texture, width, height, f);
    const pixels = await readPixels(this.device, texture);
    texture.destroy();
    if (this.format === 'bgra8unorm') {
      for (let i = 0; i < pixels.length; i += 4) [pixels[i], pixels[i + 2]] = [pixels[i + 2] ?? 0, pixels[i] ?? 0];
    }
    return new ImageData(pixels, width, height);
  }

  private encode(target: GPUTexture, width: number, height: number, f: Frame) {
    packView(this.data, width, height, f.view, f.exposure, f.black, f.settings, this.frame++, this.overlays);
    this.device.queue.writeBuffer(this.uniform, 0, this.data);

    const trail = f.sim.current.trail;
    let cached = this.groups.get(trail);
    if (cached?.bloom !== f.bloom || cached.sampler !== f.sampler) {
      const group = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: trail.createView() },
          { binding: 2, resource: { buffer: f.sim.env } },
          { binding: 3, resource: { buffer: f.sim.counts } },
          { binding: 4, resource: f.bloom },
          { binding: 5, resource: f.sampler },
        ],
      });
      cached = { group, bloom: f.bloom, sampler: f.sampler };
      this.groups.set(trail, cached);
    }
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, cached.group);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /** Bind groups hold textures of one Simulation; drop them when it is replaced. */
  forget() {
    this.groups.clear();
  }

  destroy() {
    this.uniform.destroy();
  }
}
