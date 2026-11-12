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
/** Filterable everywhere, unlike 32-bit floats. */
const HEIGHT_FORMAT: GPUTextureFormat = 'r16float';

/**
 * Fills `struct View` (render.wgsl), which is also the std140 `View` block of the WebGL2 renderer. `occupancy`:
 * the simulation keeps agents per cell (collision mode), for the agents style and for agents on food.
 */
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
  occupancy: boolean,
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
  u.set([frame, strains.length, overlays ? 1 : 0, occupancy ? 1 : 0], 28);
  // Copies of the grid around a periodic lattice show at this brightness (ADR 0026); 1 shows them as they are.
  const copies = settings.lattice && settings.boundary === 'wrap' ? LATTICE_COPIES : 1;
  fl.set([settings.bloom, black, copies, 0], 32);
}

/** How much of the scene the copies around a periodic lattice show (packView). */
export const LATTICE_COPIES = 0.15;

interface Groups {
  group: GPUBindGroup;
  /** The gel height pass (`heightField` in render.wgsl). */
  heights: GPUBindGroup;
  bloom: GPUTextureView;
  sampler: GPUSampler;
}

/** A render pass and the gel height pass, without (index 0) or with (1) the food, light and walls. */
type Variants = [GPURenderPipeline, GPURenderPipeline];

export class Renderer {
  private readonly layout: GPUBindGroupLayout;
  private readonly heightLayout: GPUBindGroupLayout;
  private readonly pipelines: Variants;
  private readonly heightPipelines: Variants;
  private readonly heightSampler: GPUSampler;
  private readonly uniform: GPUBuffer;
  private readonly data = new ArrayBuffer(VIEW_BYTES);
  /** By trail texture, then by occupancy buffer: both alternate between two. */
  private readonly groups = new Map<GPUTexture, Map<GPUBuffer, Groups>>();
  /** Gel height field: one texel per cell plus a one-cell border (render.wgsl `heightField`). */
  private heights: { texture: GPUTexture; view: GPUTextureView } | undefined;
  private frame = 0;
  overlays = true;

  constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
  ) {
    const module = device.createShaderModule({ code: renderWgsl });
    const F = GPUShaderStage.FRAGMENT;
    const storage = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: F,
      buffer: { type: 'read-only-storage' },
    });
    // Explicit, so one bind group serves the pipelines with and without the environment.
    this.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: F, buffer: { type: 'uniform' } },
        { binding: 1, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        storage(2),
        storage(3),
        { binding: 4, visibility: F, texture: { sampleType: 'float' } },
        { binding: 5, visibility: F, sampler: { type: 'filtering' } },
        { binding: 6, visibility: F, texture: { sampleType: 'float' } },
        { binding: 7, visibility: F, sampler: { type: 'filtering' } },
        storage(8),
      ],
    });
    this.heightLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: F, buffer: { type: 'uniform' } },
        { binding: 1, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        storage(2),
        storage(8),
      ],
    });
    const variants = (entryPoint: string, layout: GPUBindGroupLayout, target: GPUTextureFormat) =>
      [false, true].map((env) =>
        device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
          vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint, targets: [{ format: target }], constants: { ENV: Number(env) } },
        }),
      ) as Variants;
    this.pipelines = variants('fs', this.layout, format);
    this.heightPipelines = variants('heightField', this.heightLayout, HEIGHT_FORMAT);
    this.heightSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
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
    const { sim } = f;
    sim.syncShape();
    // Collision mode keeps the occupancy up to date (WebGPU allocates it with every simulation).
    const occupancy = f.settings.collisions;
    packView(this.data, width, height, f.view, f.exposure, f.black, f.settings, this.frame++, this.overlays, occupancy);
    this.device.queue.writeBuffer(this.uniform, 0, this.data);

    const trail = sim.viewTexture;
    const occ = sim.occupancy;
    const heights = this.heightsFor(trail);
    let byOcc = this.groups.get(trail);
    if (!byOcc) {
      byOcc = new Map();
      this.groups.set(trail, byOcc);
    }
    let cached = byOcc.get(occ);
    if (cached?.bloom !== f.bloom || cached.sampler !== f.sampler) {
      const view = trail.createView();
      const group = this.device.createBindGroup({
        layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: view },
          { binding: 2, resource: { buffer: sim.shape } },
          { binding: 3, resource: { buffer: sim.counts } },
          { binding: 4, resource: f.bloom },
          { binding: 5, resource: f.sampler },
          { binding: 6, resource: heights },
          { binding: 7, resource: this.heightSampler },
          { binding: 8, resource: { buffer: occ } },
        ],
      });
      const heightGroup = this.device.createBindGroup({
        layout: this.heightLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: view },
          { binding: 2, resource: { buffer: sim.shape } },
          { binding: 8, resource: { buffer: occ } },
        ],
      });
      cached = { group, heights: heightGroup, bloom: f.bloom, sampler: f.sampler };
      byOcc.set(occ, cached);
    }
    // Without food, light or walls the environment code would only cost time: the variant without it
    // draws the same pixels.
    const variant = sim.hasEnvironment ? 1 : 0;
    const enc = this.device.createCommandEncoder();
    // The gel style samples its height field five times per pixel: once per frame at grid
    // resolution here, instead of five full trail filters per pixel.
    if (f.settings.style === 'gel') {
      const pre = enc.beginRenderPass({ colorAttachments: [{ view: heights, loadOp: 'clear', storeOp: 'store' }] });
      pre.setPipeline(this.heightPipelines[variant]);
      pre.setBindGroup(0, cached.heights);
      pre.draw(3);
      pre.end();
    }
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(this.pipelines[variant]);
    pass.setBindGroup(0, cached.group);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /** The gel height field for a trail of this size, made anew when the size changes. */
  private heightsFor(trail: GPUTexture): GPUTextureView {
    const [width, height] = [trail.width + 2, trail.height + 2];
    if (this.heights?.texture.width !== width || this.heights.texture.height !== height) {
      this.heights?.texture.destroy();
      const texture = this.device.createTexture({
        size: [width, height],
        format: HEIGHT_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.heights = { texture, view: texture.createView() };
      this.groups.clear();
    }
    return this.heights.view;
  }

  /** Bind groups hold textures of one Simulation; drop them when it is replaced. */
  forget() {
    this.groups.clear();
  }

  destroy() {
    this.uniform.destroy();
    this.heights?.texture.destroy();
  }
}
