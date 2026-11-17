import { hexToLinear } from '../model/color';
import { BOUNDARIES, MAX_STRAINS, STYLES, type GelColor, type Settings } from '../model/params';
import { readPixels } from './readback';
import { levelSize, scentLevel, scentLevelSize, scentSensors } from './scent';
import renderWgsl from './shaders/render.wgsl?raw';
import type { Simulation } from './sim';
import { slimeShown, slimeSteps } from './slime';
import { STREAM } from './tubes';
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
  /** The trail of a strand, for the scent view's mark (Levels.strand). */
  strand: number;
  /** Half-resolution blurred trail (bloom.ts) and how to sample it. */
  bloom: GPUTextureView;
  sampler: GPUSampler;
}

/**
 * The colour of thin gel in the gel style (ADR 0009, amendment 2026-11-14): how much white the colour of the thinnest
 * gel holds, and how much of the ground the thinnest gel hides. Thick gel has the colour of its strain and hides the
 * ground.
 */
export const GEL_FX: Record<GelColor, [pale: number, film: number]> = { mild: [0.35, 0.5], strong: [0.6, 0.35] };

/**
 * The layer of the slime in each style (ADR 0055, decision 8): its colour, and its full strength A. The ground under
 * slime of the age 0 holds the share A of that colour, and under older slime the share A · (1 − age / life time)
 * (slimeStrength() in slime-reference.ts). One pale colour for all strains. It is lighter than the ground of the dark
 * styles and darker than paper.
 */
export const SLIME_LOOK: Record<Settings['style'], { color: string; strength: number }> = {
  glow: { color: '#d8dccf', strength: 0.02 },
  gel: { color: '#e4dfcc', strength: 0.024 },
  paper: { color: '#8f8a78', strength: 0.22 },
  agents: { color: '#d8dccf', strength: 0.02 },
};

export const VIEW_BYTES = 256;
/** Filterable everywhere, unlike 32-bit floats. */
const HEIGHT_FORMAT: GPUTextureFormat = 'r16float';
/** The scent view's coarse map: the scent of both layers times the share that holds scent, and that share. */
const COARSE_FORMAT: GPUTextureFormat = 'rgba32float';
/** The trail's coarse map: the trail of 4 strains, as the trail texture holds it. */
const TRAIL_FORMAT: GPUTextureFormat = 'rgba32float';

/**
 * The coarsest map of the trail that a view zoomed out reads (trailLevel()): texels of 16 cells, for up to 32 cells
 * per pixel. The zoom ends at 8 cells per pixel (Engine.zoomAt); only a large grid fitted to a small canvas shows more.
 */
export const TRAIL_LEVELS_MAX = 4;

/**
 * The map of the trail that a pixel reads at `scale` cells per pixel (ADR 0028): 0 is the trail itself, up to 2 cells
 * per pixel; k from 1 to TRAIL_LEVELS_MAX a map of the mean over cells of 2^k per side (levelSize()), whose texels are
 * 1/2 to 1 pixel wide. A pixel then reads the 3 × 3 texels under it, next to those of the pixels beside it, in place
 * of 16 cells far apart (render.wgsl trailArea).
 */
export function trailLevel(scale: number): number {
  return scale > 1 ? Math.min(TRAIL_LEVELS_MAX, Math.max(0, Math.floor(Math.log2(scale)))) : 0;
}

/**
 * Fills `struct View` (render.wgsl), which is also the std140 `View` block of the WebGL2 renderer. `occupancy`:
 * the simulation keeps agents per cell (collision mode), for the agents style and for agents on food. `stream`: the
 * step of the state, while the view draws the stream of the plasm (tubes.ts, point 6). `electrodes`: an electrode may
 * be painted (Sim.hasElectrodes). `slime`: the steps that ran so far (Sim.step), while the frame draws the layer of
 * the slime (ADR 0055, decision 8).
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
  strand: number,
  stream?: number,
  electrodes = false,
  slime?: number,
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
  fl.set([settings.bloom, black, copies, trailLevel(view.scale)], 32);
  // The pattern of the grains starts again after STREAM.period steps, and the grains go back and forth once in
  // STREAM.swing steps.
  const phases = (step: number) => [(step % STREAM.period) / STREAM.period, (step % STREAM.swing) / STREAM.swing];
  // The last value is not of the stream: the electrodes are drawn only while one may be painted (ADR 0047), so other
  // scenes do not read their outline distances.
  fl.set(stream === undefined ? [0, 0, 0, 0] : [1, ...phases(stream), 0], 36);
  fl[39] = electrodes ? 1 : 0;
  fl.set([...GEL_FX[settings.gelColor], 0, 0], 40);
  // The scent view: the map it reads (scentLevel()), and the sensors of its line, their half spread and the hold of a
  // strand (scentSensors()). It draws the repellent in both models: both read it (ADR 0044).
  const level = settings.showScent ? scentLevel(view.scale) : 0;
  fl.set([level, 0, 0, 0], 44);
  const sensors = scentSensors(settings, strand);
  fl.set(sensors.half, 48);
  fl.set(sensors.holds, 52);
  // The layer of the slime: the steps that ran so far and the life time in steps, both as unsigned integers, so that
  // the pass takes the age of a stamp as the passes of the simulation do. Then the colour and the full strength of
  // the style. A frame without the layer reads none of them.
  u.set(slime === undefined ? [0, 0, 0, 0] : [slime, slimeSteps(settings), 0, 0], 56);
  const look = SLIME_LOOK[settings.style];
  fl.set([...hexToLinear(look.color), look.strength], 60);
}

/** How much of the scene the copies around a periodic lattice show (packView). */
export const LATTICE_COPIES = 0.15;

interface Groups {
  group: GPUBindGroup;
  /** The gel height pass (`heightField` in render.wgsl). */
  heights: GPUBindGroup;
  /** The passes that fill a coarse map (`scentDown` and `trailDown` in render.wgsl). */
  down: GPUBindGroup;
  bloom: GPUTextureView;
  sampler: GPUSampler;
  /** The buffer at the binding of the slime field (encode()). */
  stamps: GPUBuffer;
  /** The buffer at the binding of the outline distances of the electrodes (encode()). */
  poles: GPUBuffer;
}

/** The scent view: the render pass with it, without (index 0) or with (1) the food, light and walls, and `scentDown`. */
interface ScentPipelines {
  render: Variants;
  /** Fills the coarse map: the scent of its texels and the share of them that holds scent. */
  down: GPURenderPipeline;
  /** Refreshes the scent of its texels after steps and keeps their share (SUM_ONLY in render.wgsl). */
  sum: GPURenderPipeline;
}

/** A render pass and the gel height pass, without (index 0) or with (1) the food, light and walls. */
type Variants = [GPURenderPipeline, GPURenderPipeline];

/**
 * The descriptor of the render pass from `module` without or with the food, light and walls (`env`), and with one
 * part more or none (`part`): the scent view (`SCENT`) or the layer of the slime (`SLIME`). Without a part the
 * pipeline sets only `ENV`, as before the parts existed.
 */
function renderPipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  format: GPUTextureFormat,
  env: boolean,
  part?: 'SCENT' | 'SLIME',
): GPURenderPipelineDescriptor {
  return {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vs' },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [{ format }],
      constants: { ENV: Number(env), ...(part ? { [part]: 1 } : {}) },
    },
  };
}

export class Renderer {
  private readonly layout: GPUBindGroupLayout;
  private readonly heightLayout: GPUBindGroupLayout;
  private readonly pipelines: Variants;
  /**
   * The pipelines of the scent view, built without blocking from the first frame that asks for the view (scentNow()):
   * most frames never draw it. Until they are built, frames draw without it.
   */
  private scent: ScentPipelines | undefined;
  private scentBuild: Promise<ScentPipelines> | undefined;
  /**
   * The render pass with the layer of the slime (SLIME in render.wgsl, ADR 0055), built without blocking from the
   * first frame that draws the layer (slimeNow()): a scene of the Jones model never does. Until they are built, frames
   * draw without the layer.
   */
  private slime: Variants | undefined;
  private slimeBuild: Promise<Variants> | undefined;
  private readonly downLayout: GPUBindGroupLayout;
  /** The scent view's coarse map (scentDown), made at the first frame that draws the view. */
  private coarse: { texture: GPUTexture; view: GPUTextureView } | undefined;
  /**
   * What the coarse map holds: it is filled again only when the scent or the shape changed, or the level or the arena;
   * a paused simulation keeps it (review of 2026-11-11: it read every cell in every frame).
   */
  private coarseHolds: { sim: Simulation; step: number; revision: number; level: number; boundary: number } | undefined;
  /** Bound in its place until then. */
  private readonly noCoarse: GPUTexture;
  /** The trail's coarse map (trailDown), made at the first frame zoomed out to 2 cells per pixel or more. */
  private trailCoarse: { texture: GPUTexture; view: GPUTextureView } | undefined;
  /**
   * What the trail's coarse map holds: it is filled again only when the trail changed (a step, or a change that the
   * simulation's revision counts), or the level. A paused simulation keeps it.
   */
  private trailHolds: { sim: Simulation; trail: GPUTexture; step: number; revision: number; level: number } | undefined;
  /** The pass that fills it, built at its first use: most frames are not zoomed out. */
  private trailDown: GPURenderPipeline | undefined;
  private readonly module: GPUShaderModule;
  private readonly heightPipelines: Variants;
  private readonly heightSampler: GPUSampler;
  private readonly uniform: GPUBuffer;
  private readonly data = new ArrayBuffer(VIEW_BYTES);
  /**
   * By trail texture, then by scent texture, then by occupancy buffer. The trail and the scent of the view alternate
   * between two textures together, but the picture of the tubes is one trail texture for both (ADR 0034), so the trail
   * does not name the scent. The textures are weak keys: a texture that its simulation freed leaves no group behind.
   * A group is made anew when the bloom, its sampler, the slime field or the outline distances of the electrodes are
   * another one (encode()).
   */
  private groups = new WeakMap<GPUTexture, WeakMap<GPUTexture, Map<GPUBuffer, Groups>>>();
  /** Gel height field: one texel per cell plus a one-cell border (render.wgsl `heightField`). */
  private heights: { texture: GPUTexture; view: GPUTextureView } | undefined;
  private frame = 0;
  overlays = true;

  constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    /**
     * For tests: another version of the render shader, which then draws every frame as the code before the scent view
     * drew it (the pipelines without the view, whatever the settings say).
     */
    private readonly fixed?: string,
  ) {
    const module = device.createShaderModule({ code: fixed ?? renderWgsl });
    this.module = module;
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
        { binding: 9, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        { binding: 10, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        { binding: 11, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        { binding: 12, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        storage(14),
        storage(16),
      ],
    });
    this.downLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: F, buffer: { type: 'uniform' } },
        { binding: 1, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        storage(2),
        { binding: 9, visibility: F, texture: { sampleType: 'unfilterable-float' } },
      ],
    });
    this.noCoarse = device.createTexture({
      size: [1, 1],
      format: COARSE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
    this.heightLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: F, buffer: { type: 'uniform' } },
        { binding: 1, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        storage(2),
        storage(8),
      ],
    });
    const heightVariants = (layout: GPUBindGroupLayout, target: GPUTextureFormat) =>
      [false, true].map((env) =>
        device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
          vertex: { module, entryPoint: 'vs' },
          fragment: {
            module,
            entryPoint: 'heightField',
            targets: [{ format: target }],
            constants: { ENV: Number(env) },
          },
        }),
      ) as Variants;
    this.pipelines = [false, true].map((env) =>
      device.createRenderPipeline(renderPipeline(device, module, this.layout, format, env)),
    ) as Variants;
    this.heightPipelines = heightVariants(this.heightLayout, HEIGHT_FORMAT);
    this.heightSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.uniform = device.createBuffer({ size: VIEW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  /** Draws one frame to the canvas. False while the scent view that the frame asks for is still being built. */
  draw(f: Frame): boolean {
    const { width, height } = this.context.canvas;
    return this.encode(this.context.getCurrentTexture(), width, height, f);
  }

  /**
   * Waits until a frame with these settings shows the view as asked: the pipelines of the scent view or of the layer
   * of the slime are built.
   */
  async ready(settings: Settings): Promise<void> {
    if (this.fixed !== undefined) return;
    if (settings.showScent) await this.scentNow(true);
    if (slimeShown(settings)) await this.slimeNow(true);
  }

  /**
   * Renders one frame offscreen and reads it back as RGBA pixels (PNG export, tests). A WebGPU
   * canvas clears its buffer after presentation, so the canvas itself cannot be read later. The caller waits for
   * ready() before it builds the frame: a frame holds textures of the simulation, which can be gone after a wait.
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

  /**
   * False while the frame draws without the scent view or without the layer of the slime that it asks for: their
   * pipelines are still being built.
   */
  private encode(target: GPUTexture, width: number, height: number, f: Frame): boolean {
    const { sim } = f;
    sim.syncShape();
    // Collision mode keeps the occupancy up to date (WebGPU allocates it with every simulation).
    const occupancy = f.settings.collisions;
    const { exposure, black, strand } = f;
    // The stream of the plasm, while the view draws the picture of the tubes (ADR 0034).
    const stream = sim.streamTexture;
    // The layer of the slime (ADR 0055, decision 8), while the settings show it and the simulation holds the field:
    // without a field no cell has a stamp, and the picture is the one without the layer.
    const slimy = this.fixed === undefined && slimeShown(f.settings) && sim.slimeField !== undefined;
    const layer = slimy ? this.slimeNow() : undefined;
    packView(
      this.data,
      width,
      height,
      f.view,
      exposure,
      black,
      f.settings,
      this.frame++,
      this.overlays,
      occupancy,
      strand,
      stream ? sim.step : undefined,
      sim.hasElectrodes,
      layer ? sim.step : undefined,
    );
    this.device.queue.writeBuffer(this.uniform, 0, this.data);

    // The map after the step's diffusion in either order of a step, trail and scent alike (ADR 0027). The trail is the
    // picture of the tubes while the settings show it (ADR 0034): every map below is made from the trail that is drawn.
    const { scent } = sim.viewTextures;
    const trail = sim.pictureTexture;
    const occ = sim.occupancy;
    const heights = this.heightsFor(trail);
    const view = f.settings.showScent && this.fixed === undefined ? this.scentNow() : undefined;
    const coarse = view ? this.coarseFor(trail) : undefined;
    // Zoomed out, a pixel reads the trail from a coarser map, filled below (trailDown in render.wgsl).
    const trailMap = trailLevel(f.view.scale);
    const trailCoarse = trailMap > 0 ? this.trailCoarseFor(trail) : undefined;
    let byScent = this.groups.get(trail);
    if (!byScent) {
      byScent = new WeakMap();
      this.groups.set(trail, byScent);
    }
    let byOcc = byScent.get(scent);
    if (!byOcc) {
      byOcc = new Map();
      byScent.set(scent, byOcc);
    }
    let cached = byOcc.get(occ);
    // The Jones model has no slime field, and no pass reads its binding then: the cells of the simulation stand in.
    const stamps = sim.slimeField ?? sim.env;
    // Without a pole the simulation holds no outline distances of the electrodes (ADR 0047), and no pass reads their
    // binding then: those of walls and food stand in.
    const poles = sim.poleField ?? sim.shape;
    if (
      cached?.bloom !== f.bloom ||
      cached.sampler !== f.sampler ||
      cached.stamps !== stamps ||
      cached.poles !== poles
    ) {
      const trailView = trail.createView();
      const scentView = scent.createView();
      const group = this.device.createBindGroup({
        layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: trailView },
          { binding: 2, resource: { buffer: sim.shape } },
          { binding: 3, resource: { buffer: sim.counts } },
          { binding: 4, resource: f.bloom },
          { binding: 5, resource: f.sampler },
          { binding: 6, resource: heights },
          { binding: 7, resource: this.heightSampler },
          { binding: 8, resource: { buffer: occ } },
          // The scent of the same state as the trail: both come from Simulation.viewTextures (ADR 0027).
          { binding: 9, resource: scentView },
          { binding: 10, resource: this.coarse?.view ?? this.noCoarse.createView() },
          { binding: 11, resource: this.trailCoarse?.view ?? this.noCoarse.createView() },
          // The stream belongs to the picture of the tubes, which is the trail here: one texture for each trail.
          { binding: 12, resource: (stream ?? this.noCoarse).createView() },
          // The slime field, for the layer of the slime (ADR 0055).
          { binding: 14, resource: { buffer: stamps } },
          // The outline distances of the electrodes (ADR 0047).
          { binding: 16, resource: { buffer: poles } },
        ],
      });
      const heightGroup = this.device.createBindGroup({
        layout: this.heightLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: trailView },
          { binding: 2, resource: { buffer: sim.shape } },
          { binding: 8, resource: { buffer: occ } },
        ],
      });
      const down = this.device.createBindGroup({
        layout: this.downLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: trailView },
          { binding: 2, resource: { buffer: sim.shape } },
          { binding: 9, resource: scentView },
        ],
      });
      cached = { group, heights: heightGroup, down, bloom: f.bloom, sampler: f.sampler, stamps, poles };
      byOcc.set(occ, cached);
    }
    // Without food, light or walls the environment code would only cost time: the variant without it
    // draws the same pixels.
    const variant = sim.hasEnvironment ? 1 : 0;
    const enc = this.device.createCommandEncoder();
    // The gel style samples its height field nine times per pixel: once per frame at grid
    // resolution here, instead of nine full trail filters per pixel.
    if (f.settings.style === 'gel') {
      const pre = enc.beginRenderPass({ colorAttachments: [{ view: heights, loadOp: 'clear', storeOp: 'store' }] });
      pre.setPipeline(this.heightPipelines[variant]);
      pre.setBindGroup(0, cached.heights);
      pre.draw(3);
      pre.end();
    }
    const kept = this.trailHolds;
    if (
      trailCoarse &&
      !(
        kept?.sim === sim &&
        kept.trail === trail &&
        kept.step === sim.step &&
        kept.revision === sim.revision &&
        kept.level === trailMap
      )
    ) {
      this.trailHolds = { sim, trail, step: sim.step, revision: sim.revision, level: trailMap };
      // Built without waiting: the queue, not the page, waits for the compiler before the first pass.
      this.trailDown ??= this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.downLayout] }),
        vertex: { module: this.module, entryPoint: 'vs' },
        fragment: { module: this.module, entryPoint: 'trailDown', targets: [{ format: TRAIL_FORMAT }] },
      });
      const down = enc.beginRenderPass({
        colorAttachments: [{ view: trailCoarse, loadOp: 'clear', storeOp: 'store' }],
      });
      down.setViewport(0, 0, levelSize(trail.width, trailMap), levelSize(trail.height, trailMap), 0, 1);
      down.setPipeline(this.trailDown);
      down.setBindGroup(0, cached.down);
      down.draw(3);
      down.end();
    }
    // Zoomed out, the scent view reads a coarser map of the scent, filled here (scentDown in render.wgsl).
    const level = scentLevel(f.view.scale);
    const boundary = BOUNDARIES.indexOf(f.settings.boundary);
    const holds = this.coarseHolds;
    // The share of a texel that holds scent changes only with the shape, the level or the arena; steps change only
    // the scent, and they leave none in walls or outside the dish (render.wgsl SUM_ONLY).
    const shaped =
      holds?.sim === sim && holds.revision === sim.revision && holds.level === level && holds.boundary === boundary;
    if (view && coarse && level > 0 && !(shaped && holds.step === sim.step)) {
      this.coarseHolds = { sim, step: sim.step, revision: sim.revision, level, boundary };
      const down = enc.beginRenderPass({
        colorAttachments: [{ view: coarse, loadOp: shaped ? 'load' : 'clear', storeOp: 'store' }],
      });
      down.setViewport(0, 0, scentLevelSize(trail.width, level), scentLevelSize(trail.height, level), 0, 1);
      down.setPipeline(shaped ? view.sum : view.down);
      down.setBindGroup(0, cached.down);
      down.draw(3);
      down.end();
    }
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    // The scent view draws no slime (slimeShown()), so a frame has one of the two parts at most.
    pass.setPipeline((view?.render ?? layer ?? this.pipelines)[variant]);
    pass.setBindGroup(0, cached.group);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    return !(f.settings.showScent && this.fixed === undefined && !view) && !(slimy && !layer);
  }

  /**
   * The pipelines of the scent view once they are built, else undefined; the first call starts their build, without
   * blocking. `wait`: resolves when they are built (exports and tests).
   */
  private scentNow(): ScentPipelines | undefined;
  private scentNow(wait: true): Promise<ScentPipelines>;
  private scentNow(wait = false): ScentPipelines | undefined | Promise<ScentPipelines> {
    if (!this.scentBuild) {
      const { device, module, layout, format } = this;
      const render = (env: boolean) =>
        device.createRenderPipelineAsync(renderPipeline(device, module, layout, format, env, 'SCENT'));
      const fill = (sum: boolean) =>
        device.createRenderPipelineAsync({
          layout: device.createPipelineLayout({ bindGroupLayouts: [this.downLayout] }),
          vertex: { module, entryPoint: 'vs' },
          fragment: {
            module,
            entryPoint: 'scentDown',
            constants: { SUM_ONLY: sum ? 1 : 0 },
            // The sum writes the scent alone and keeps the share.
            targets: [
              { format: COARSE_FORMAT, writeMask: sum ? GPUColorWrite.RED | GPUColorWrite.GREEN : GPUColorWrite.ALL },
            ],
          },
        });
      this.scentBuild = Promise.all([render(false), render(true), fill(false), fill(true)]).then(
        ([off, on, down, sum]) => (this.scent = { render: [off, on], down, sum }),
      );
      // A failed build shows in the next frame that asks for the view.
      this.scentBuild.catch((err: unknown) => (this.scentError = err instanceof Error ? err : new Error(String(err))));
    }
    if (this.scentError) throw this.scentError;
    return wait ? this.scentBuild : this.scent;
  }

  private scentError: Error | undefined;

  /**
   * The pipelines of the layer of the slime once they are built, else undefined; the first call starts their build,
   * without blocking, as scentNow() does. `wait`: resolves when they are built (exports and tests).
   */
  private slimeNow(): Variants | undefined;
  private slimeNow(wait: true): Promise<Variants>;
  private slimeNow(wait = false): Variants | undefined | Promise<Variants> {
    if (!this.slimeBuild) {
      const { device, module, layout, format } = this;
      const render = (env: boolean) =>
        device.createRenderPipelineAsync(renderPipeline(device, module, layout, format, env, 'SLIME'));
      this.slimeBuild = Promise.all([render(false), render(true)]).then((built) => (this.slime = built));
      // A failed build shows in the next frame that asks for the layer.
      this.slimeBuild.catch((err: unknown) => (this.slimeError = err instanceof Error ? err : new Error(String(err))));
    }
    if (this.slimeError) throw this.slimeError;
    return wait ? this.slimeBuild : this.slime;
  }

  private slimeError: Error | undefined;

  /** The scent view's coarse map for a trail of this size (half its sides, rounded up), made anew with the size. */
  private coarseFor(trail: GPUTexture): GPUTextureView {
    const [width, height] = [scentLevelSize(trail.width, 1), scentLevelSize(trail.height, 1)];
    if (this.coarse?.texture.width !== width || this.coarse.texture.height !== height) {
      this.coarse?.texture.destroy();
      const texture = this.device.createTexture({
        size: [width, height],
        format: COARSE_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.coarse = { texture, view: texture.createView() };
      this.coarseHolds = undefined;
      this.groups = new WeakMap();
    }
    return this.coarse.view;
  }

  /** The trail's coarse map for a trail of this size (half its sides, rounded up), made anew with the size. */
  private trailCoarseFor(trail: GPUTexture): GPUTextureView {
    const [width, height] = [levelSize(trail.width, 1), levelSize(trail.height, 1)];
    if (this.trailCoarse?.texture.width !== width || this.trailCoarse.texture.height !== height) {
      this.trailCoarse?.texture.destroy();
      const texture = this.device.createTexture({
        size: [width, height],
        format: TRAIL_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.trailCoarse = { texture, view: texture.createView() };
      this.trailHolds = undefined;
      this.groups = new WeakMap();
    }
    return this.trailCoarse.view;
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
      this.groups = new WeakMap();
    }
    return this.heights.view;
  }

  /** Bind groups hold textures of one Simulation; drop them when it is replaced. */
  forget() {
    this.groups = new WeakMap();
    this.coarseHolds = undefined;
    this.trailHolds = undefined;
  }

  destroy() {
    this.uniform.destroy();
    this.heights?.texture.destroy();
    this.coarse?.texture.destroy();
    this.trailCoarse?.texture.destroy();
    this.noCoarse.destroy();
  }
}
