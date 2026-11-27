import { hexToLinear } from '../model/color';
import { BOUNDARIES, MAX_STRAINS, STYLES, type GelColor, type Settings } from '../model/params';
import { readPixels } from './readback';
import { levelSize, scentLevel, scentLevelSize, scentSensors } from './scent';
import renderWgsl from './shaders/render.wgsl?raw';
import type { Simulation } from './sim';
import { frontShown, slimeShown, slimeSteps } from './slime';
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
 * The film of the slime in each style (ADR 0057; `slimed` in render.wgsl, slimeColour() in slime-reference.ts). One
 * pale colour for all strains.
 * - `color`: the colour of the body of the film: lighter than the ground of the dark styles, and darker than paper.
 * - `body`: how much of that colour slime of the full thickness shows. On the dark grounds the film adds this share
 *   of the colour to the ground; on paper it is a wet stain, and mixes this share of the colour into the paper.
 *   Thinner slime shows less than its share of the thickness: thin slime is clear, and thick slime is milky.
 * - `gloss`: the strength of the small highlight of the lamp on the film.
 * - `wide`: the strength of the wide weak light on its slopes.
 */
export const SLIME_LOOK: Record<Settings['style'], { color: string; body: number; gloss: number; wide: number }> = {
  glow: { color: '#c4d7ce', body: 0.075, gloss: 0.5, wide: 0.14 },
  gel: { color: '#d7e1c8', body: 0.1, gloss: 0.65, wide: 0.14 },
  paper: { color: '#8f8a78', body: 0.22, gloss: 0.7, wide: 0.35 },
  agents: { color: '#c4d7ce', body: 0.075, gloss: 0.5, wide: 0.14 },
};

/** The height of the relief of the film: cells of height for slime of the full thickness (render.wgsl `slimed`). */
export const SLIME_RELIEF = 2.5;
/** The height of a bead on the film, as a share of the full thickness (render.wgsl `slimeBeads`). */
export const SLIME_BEAD = 0.11;

export const VIEW_BYTES = 272;
/** Filterable everywhere, unlike 32-bit floats. */
const HEIGHT_FORMAT: GPUTextureFormat = 'r16float';
/** The scent view's coarse map: the scent of both layers times the share that holds scent, and that share. */
const COARSE_FORMAT: GPUTextureFormat = 'rgba32float';
/** The trail's coarse map: the trail of 4 strains, as the trail texture holds it. */
const TRAIL_FORMAT: GPUTextureFormat = 'rgba32float';
/** The map of the film of the slime and its coarse map (ADR 0057): one thickness per texel, 2 B. */
const FILM_FORMAT: GPUTextureFormat = 'r16float';
/**
 * The map of the growth front (ADR 0060): for each strain, the share of a texel that is young ground, 0 to 1. One
 * byte each is enough: the render pass takes the mean of the texels around a pixel.
 */
const FRONT_FORMAT: GPUTextureFormat = 'rgba8unorm';
/** The map of the growth front has texels of 2^FRONT_LEVEL cells per side (render.wgsl FRONT_LEVEL). */
export const FRONT_LEVEL = 2;

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
 * be painted (Sim.hasElectrodes). `slime`: the steps that ran so far (Sim.step), while the frame draws the film of
 * the slime (ADR 0055, decision 8). `veins`: the frame draws the picture of the tubes, and with it the veins (ADR 0099).
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
  veins = false,
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
  fl.set([...GEL_FX[settings.gelColor], veins ? 1 : 0, 0], 40);
  // The scent view: the map it reads (scentLevel()), and the sensors of its line, their half spread and the hold of a
  // strand (scentSensors()). It draws the repellent in both models: both read it (ADR 0044).
  const level = settings.showScent ? scentLevel(view.scale) : 0;
  fl.set([level, 0, 0, 0], 44);
  const sensors = scentSensors(settings, strand);
  fl.set(sensors.half, 48);
  fl.set(sensors.holds, 52);
  // The film of the slime: the steps that ran so far and the life time in steps, both as unsigned integers, so that
  // the pass takes the age of a stamp as the passes of the simulation do. Then the numbers of the style: the colour
  // and the share of its body, its highlight, its wide light, the height of its relief and of its beads. A frame
  // without the film reads none of them.
  // What the frame draws of the slime field: 1 the film of the slime, 2 the skirt of the growth front (ADR 0060).
  const parts = (slimeShown(settings) ? 1 : 0) | (frontShown(settings) ? 2 : 0);
  u.set(slime === undefined ? [0, 0, 0, 0] : [slime, slimeSteps(settings), parts, 0], 56);
  const look = SLIME_LOOK[settings.style];
  fl.set([...hexToLinear(look.color), look.body], 60);
  fl.set([look.gloss, look.wide, SLIME_RELIEF, SLIME_BEAD], 64);
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
  /**
   * The pass that fills the map of the film (`slimeFilm` in render.wgsl) with the slime field that it reads, made at
   * the first frame that draws the film of a simulation with a field.
   */
  film?: { group: GPUBindGroup; stamps: GPUBuffer };
  /**
   * The pass that fills the coarse map of the film (`slimeDown` in render.wgsl), made at the first frame that needs
   * it. It holds the trail for the size of the grid, so it lies with the groups of that trail: a simulation frees the
   * picture of the tubes while it lives, and a pass with a freed texture is an error of the device.
   */
  filmDown?: GPUBindGroup;
  /** The pass that fills the map of the growth front (`frontMap` in render.wgsl) with the slime field that it reads. */
  front?: { group: GPUBindGroup; stamps: GPUBuffer };
  /** The buffer at the binding of the outline distances of the electrodes (encode()). */
  poles: GPUBuffer;
  /**
   * The stream of the grains in `group`, or none. The grains show with the picture of the tubes or without it
   * (ADR 0095), so the trail does not say which stream a frame reads, and a simulation frees the stream while it lives.
   */
  stream: GPUTexture | undefined;
  /** The factors of the radius of the tubes in `group`, for the veins (ADR 0099), or none. */
  veins: GPUTexture | undefined;
}

/** The maps of the scent view: `scentDown`. The render passes with the view are apart (Renderer.viewNow()). */
interface ScentPipelines {
  /** Fills the coarse map: the scent of its texels and the share of them that holds scent. */
  down: GPURenderPipeline;
  /** Refreshes the scent of its texels after steps and keeps their share (SUM_ONLY in render.wgsl). */
  sum: GPURenderPipeline;
}

/** A render pass and the gel height pass, without (index 0) or with (1) the food, light and walls. */
type Variants = [GPURenderPipeline, GPURenderPipeline];

/** The film of the slime (ADR 0057): the render pass with it, the pass of its map, and `slimeDown`. */
interface SlimePipelines {
  render: Variants;
  /** Fills the map of the film, without (index 0) or with (1) the walls. */
  film: Variants;
  /** Fills the coarse map of the film. */
  down: GPURenderPipeline;
}

/**
 * The skirt of the growth front (ADR 0060): the render pass with the skirt and the film (`FRONT` and `SLIME`), and the
 * pass of the map of the front. A frame without the skirt runs the pipelines without its code.
 */
interface FrontPipelines {
  render: Variants;
  map: GPURenderPipeline;
}

/**
 * What lies below the scent view in a frame: 0 the picture alone, 1 the film of the slime, 2 the skirt of the growth
 * front with the film.
 */
type Below = 0 | 1 | 2;
const VIEW_PARTS = ['SCENT', 'SCENT+SLIME', 'SCENT+FRONT'] as const;

/** The render passes with the scent view over one kind of picture: built at their first use (Renderer.viewNow()). */
interface Viewed {
  ready?: Variants;
  build?: Promise<Variants>;
  error?: Error;
}

/** What a map of the film holds: it is filled again only when one of these changed. */
interface FilmState {
  sim: Simulation;
  stamps: GPUBuffer;
  step: number;
  revision: number;
  life: number;
  boundary: number;
  variant: number;
  overlays: boolean;
}

/**
 * The descriptor of the render pass from `module` without or with the food, light and walls (`env`), and with one
 * part more or none (`part`): the scent view (`SCENT`), the film of the slime (`SLIME`), the skirt of the growth
 * front with the film (`FRONT`, which also sets `SLIME`), or the scent view over one of the two. Without a part the
 * pipeline sets only `ENV`, as before the parts existed.
 */
function renderPipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  format: GPUTextureFormat,
  env: boolean,
  part?: 'SCENT' | 'SLIME' | 'FRONT' | 'SCENT+SLIME' | 'SCENT+FRONT',
): GPURenderPipelineDescriptor {
  // The skirt of the growth front needs the code of the film (`FRONT` sets `SLIME`), and the scent view can lie over
  // both.
  const parts: Record<string, number> = {};
  if (part?.includes('SCENT')) parts.SCENT = 1;
  if (part?.includes('SLIME') || part?.includes('FRONT')) parts.SLIME = 1;
  if (part?.includes('FRONT')) parts.FRONT = 1;
  return {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vs' },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [{ format }],
      constants: { ENV: Number(env), ...parts },
    },
  };
}

export class Renderer {
  private readonly layout: GPUBindGroupLayout;
  private readonly heightLayout: GPUBindGroupLayout;
  private readonly pipelines: Variants;
  /**
   * The passes of the maps of the scent view, built without blocking from the first frame that asks for the view
   * (scentNow()): most frames never draw it. Until they and its render pass (`viewed`) are built, frames draw without
   * it.
   */
  private scent: ScentPipelines | undefined;
  private scentBuild: Promise<ScentPipelines> | undefined;
  /**
   * The passes of the film of the slime (SLIME in render.wgsl, ADR 0055 and 0057), built without blocking from the
   * first frame that draws the film (slimeNow()): a scene of the Jones model never does. Until they are built, frames
   * draw without the film.
   */
  private slime: SlimePipelines | undefined;
  private slimeBuild: Promise<SlimePipelines> | undefined;
  /**
   * The passes of the skirt of the growth front (FRONT in render.wgsl, ADR 0060), built without blocking from the first
   * frame that draws the skirt (frontNow()): a scene without growth never does.
   */
  private frontPasses: FrontPipelines | undefined;
  private frontBuild: Promise<FrontPipelines> | undefined;
  /**
   * The render passes with the scent view, by what lies below the view (`Below`). Each is built without blocking from
   * the first frame that draws it (viewNow()), and no other: a frame with the film never builds the pass without it.
   * The scent view lies over the picture and hides nothing of it (ADR 0060, decision 11).
   */
  private readonly viewed: [Viewed, Viewed, Viewed] = [{}, {}, {}];
  private readonly filmLayout: GPUBindGroupLayout;
  private readonly filmDownLayout: GPUBindGroupLayout;
  private readonly frontLayout: GPUBindGroupLayout;
  /** The map of the growth front (frontMap), made at the first frame that draws the skirt. */
  private young: { texture: GPUTexture; view: GPUTextureView } | undefined;
  private youngHolds: Omit<FilmState, 'variant' | 'overlays' | 'boundary'> | undefined;
  /** The map of the film of the slime (slimeFilm), one texel per cell, made at the first frame that draws the film. */
  private film: { texture: GPUTexture; view: GPUTextureView } | undefined;
  private filmHolds: FilmState | undefined;
  /** The coarse map of the film (slimeDown), made at the first frame with the film above 2 cells per pixel. */
  private filmCoarse: { texture: GPUTexture; view: GPUTextureView } | undefined;
  private filmCoarseHolds: (FilmState & { level: number }) | undefined;
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
   * A group is made anew when the bloom, its sampler or the outline distances of the electrodes are another one
   * (encode()), and its pass of the film when the slime field is another one.
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
        { binding: 13, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        storage(16),
        { binding: 15, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        { binding: 17, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        { binding: 20, visibility: F, texture: { sampleType: 'unfilterable-float' } },
      ],
    });
    // The pass of the map of the growth front: the view, the trail, the stamps and the front field.
    this.frontLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: F, buffer: { type: 'uniform' } },
        { binding: 1, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        storage(14),
        storage(19),
      ],
    });
    // The pass of the map of the film: the view, the trail for the size of the grid, the walls and the slime field.
    this.filmLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: F, buffer: { type: 'uniform' } },
        { binding: 1, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        storage(2),
        storage(14),
        storage(18),
      ],
    });
    this.filmDownLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: F, buffer: { type: 'uniform' } },
        { binding: 1, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        { binding: 15, visibility: F, texture: { sampleType: 'unfilterable-float' } },
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
   * Waits until a frame of `sim` with these settings shows the view as asked: the pipelines of the film of the slime,
   * of the skirt and of the scent view that the frame draws are built.
   */
  async ready(sim: Simulation, settings: Settings): Promise<void> {
    if (this.fixed !== undefined) return;
    const { filmy, fanned } = this.slimeParts(sim, settings);
    if (filmy) await this.slimeNow(true);
    if (fanned) await this.frontNow(true);
    if (settings.showScent) {
      await this.scentNow(true);
      await this.viewNow(fanned ? 2 : filmy ? 1 : 0, true);
    }
  }

  /**
   * What a frame of `sim` draws of the slime with these settings: the film (ADR 0055, decision 8; ADR 0057) and the
   * skirt of the growth front (ADR 0060), each while the settings show it and the simulation holds the field. Without a
   * field no cell has a stamp, and the picture is the one without them.
   */
  private slimeParts(sim: Simulation, settings: Settings): { filmy: boolean; fanned: boolean } {
    const held = this.fixed === undefined && sim.slimeField !== undefined && sim.slimeAmount !== undefined;
    return {
      filmy: held && slimeShown(settings),
      fanned: held && sim.slimeFront !== undefined && frontShown(settings),
    };
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
   * False while the frame draws without the scent view or without the film of the slime that it asks for: their
   * pipelines are still being built.
   */
  private encode(target: GPUTexture, width: number, height: number, f: Frame): boolean {
    const { sim } = f;
    sim.syncShape();
    // Collision mode keeps the occupancy up to date (WebGPU allocates it with every simulation).
    const occupancy = f.settings.collisions;
    const { exposure, black, strand } = f;
    // The stream of the plasm, while the view draws the grains: with the picture of the tubes or without it (ADR 0095).
    const stream = sim.streamTexture;
    // The film of the slime and the skirt of the growth front, while the settings show them and the simulation holds
    // the field (slimeParts()).
    const [stamps, amounts, fronts] = [sim.slimeField, sim.slimeAmount, sim.slimeFront];
    const { filmy, fanned } = this.slimeParts(sim, f.settings);
    // The skirt of the growth front (ADR 0060) has pipelines of its own, with the code of the film in them: a frame
    // without the skirt pays nothing for it. With the film it waits for the passes of the maps of the film.
    const wet = filmy ? this.slimeNow() : undefined;
    const frontReady = fanned ? this.frontNow() : undefined;
    const grown = frontReady && (!filmy || wet) ? frontReady : undefined;
    // The trail that the frame draws: the picture of the tubes while the settings show it (ADR 0034), and with it the
    // factors of the radius of its tubes, for the veins (ADR 0099).
    const trail = sim.pictureTexture;
    const veins = sim.veinTexture;
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
      (wet ?? grown) ? sim.step : undefined,
      veins !== undefined,
    );
    this.device.queue.writeBuffer(this.uniform, 0, this.data);

    // The map after the step's diffusion in either order of a step, trail and scent alike (ADR 0027). The trail is the
    // picture of the tubes while the settings show it (ADR 0034): every map below is made from the trail that is drawn.
    const { scent } = sim.viewTextures;
    const occ = sim.occupancy;
    const heights = this.heightsFor(trail);
    const scented = f.settings.showScent && this.fixed === undefined;
    const view = scented ? this.scentNow() : undefined;
    // The render pass with the scent view is built for what lies below the view in this frame (ADR 0060, decision
    // 11): the skirt with the film, the film, or the picture alone.
    const below: Below = fanned ? 2 : filmy ? 1 : 0;
    const over = scented ? this.viewNow(below) : undefined;
    const coarse = view ? this.coarseFor(trail) : undefined;
    // Zoomed out, a pixel reads the trail from a coarser map, filled below (trailDown in render.wgsl).
    const trailMap = trailLevel(f.view.scale);
    const trailCoarse = trailMap > 0 ? this.trailCoarseFor(trail) : undefined;
    // The maps of the film, made before the bind group that holds them.
    const film = wet ? this.filmFor(trail) : undefined;
    const filmCoarse = wet && trailMap > 0 ? this.filmCoarseFor(trail) : undefined;
    const young = grown ? this.youngFor(trail) : undefined;
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
    // Without a pole the simulation holds no outline distances of the electrodes (ADR 0058), and no pass reads their
    // binding then: those of walls and food stand in.
    const poles = sim.poleField ?? sim.shape;
    if (
      cached?.bloom !== f.bloom ||
      cached.sampler !== f.sampler ||
      cached.poles !== poles ||
      cached.stream !== stream ||
      cached.veins !== veins
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
          // The stream of the grains, with the picture of the tubes or without it (Groups.stream).
          { binding: 12, resource: (stream ?? this.noCoarse).createView() },
          // The factors of the radius of the tubes, for the veins (ADR 0099). A frame without the veins reads none.
          { binding: 13, resource: (veins ?? this.noCoarse).createView() },
          // The outline distances of the electrodes (ADR 0058).
          { binding: 16, resource: { buffer: poles } },
          // The maps of the film of the slime (ADR 0057). A frame without the film reads none of them.
          { binding: 15, resource: this.film?.view ?? this.noCoarse.createView() },
          { binding: 17, resource: this.filmCoarse?.view ?? this.noCoarse.createView() },
          // The map of the growth front (ADR 0060).
          { binding: 20, resource: this.young?.view ?? this.noCoarse.createView() },
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
      cached = { group, heights: heightGroup, down, bloom: f.bloom, sampler: f.sampler, poles, stream, veins };
      byOcc.set(occ, cached);
    }
    if (wet && stamps && amounts && cached.film?.stamps !== stamps) {
      const group = this.device.createBindGroup({
        layout: this.filmLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: trail.createView() },
          { binding: 2, resource: { buffer: sim.shape } },
          { binding: 14, resource: { buffer: stamps } },
          { binding: 18, resource: { buffer: amounts } },
        ],
      });
      cached.film = { group, stamps };
    }
    if (grown && young && stamps && fronts && cached.front?.stamps !== stamps) {
      const group = this.device.createBindGroup({
        layout: this.frontLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: trail.createView() },
          { binding: 14, resource: { buffer: stamps } },
          { binding: 19, resource: { buffer: fronts } },
        ],
      });
      cached.front = { group, stamps };
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
    const boundary = BOUNDARIES.indexOf(f.settings.boundary);
    // The map of the film of the slime, filled once for each state of the slime that a frame draws (slimeFilm in
    // render.wgsl): after a step or a stroke, and when the life time, the arena or the walls in the picture are
    // others. Zoomed out, the frame reads a coarser map of it, filled from it (slimeDown).
    if (wet && film && stamps && cached.film) {
      const now: FilmState = {
        sim,
        stamps,
        step: sim.step,
        revision: sim.revision,
        life: slimeSteps(f.settings),
        boundary,
        variant,
        overlays: this.overlays,
      };
      const same = (held: FilmState | undefined) =>
        held !== undefined && (Object.keys(now) as (keyof FilmState)[]).every((k) => held[k] === now[k]);
      if (!same(this.filmHolds)) {
        this.filmHolds = now;
        const fill = enc.beginRenderPass({ colorAttachments: [{ view: film, loadOp: 'clear', storeOp: 'store' }] });
        fill.setPipeline(wet.film[variant]);
        fill.setBindGroup(0, cached.film.group);
        fill.draw(3);
        fill.end();
      }
      if (filmCoarse && !(same(this.filmCoarseHolds) && this.filmCoarseHolds?.level === trailMap)) {
        this.filmCoarseHolds = { ...now, level: trailMap };
        cached.filmDown ??= this.device.createBindGroup({
          layout: this.filmDownLayout,
          entries: [
            { binding: 0, resource: { buffer: this.uniform } },
            { binding: 1, resource: trail.createView() },
            { binding: 15, resource: film },
          ],
        });
        const down = enc.beginRenderPass({
          colorAttachments: [{ view: filmCoarse, loadOp: 'clear', storeOp: 'store' }],
        });
        down.setViewport(0, 0, levelSize(trail.width, trailMap), levelSize(trail.height, trailMap), 0, 1);
        down.setPipeline(wet.down);
        down.setBindGroup(0, cached.filmDown);
        down.draw(3);
        down.end();
      }
    }
    // The map of the growth front, filled once for each state that a frame draws (frontMap in render.wgsl).
    if (grown && young && stamps && cached.front) {
      const now = { sim, stamps, step: sim.step, revision: sim.revision, life: slimeSteps(f.settings) };
      const held = this.youngHolds;
      if (!(held && (Object.keys(now) as (keyof typeof now)[]).every((k) => held[k] === now[k]))) {
        this.youngHolds = now;
        const fill = enc.beginRenderPass({ colorAttachments: [{ view: young, loadOp: 'clear', storeOp: 'store' }] });
        fill.setPipeline(grown.map);
        fill.setBindGroup(0, cached.front.group);
        fill.draw(3);
        fill.end();
      }
    }
    // Zoomed out, the scent view reads a coarser map of the scent, filled here (scentDown in render.wgsl).
    const level = scentLevel(f.view.scale);
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
    // The scent view lies over the film and the skirt. The frame draws the view once its maps, its render pass and the
    // passes of what lies below it are built. Until then the frame draws without the view, and nothing below it goes.
    const lies = below === 2 ? grown !== undefined : below === 1 ? wet !== undefined : true;
    const top = view && lies ? over : undefined;
    pass.setPipeline((top ?? grown?.render ?? wet?.render ?? this.pipelines)[variant]);
    pass.setBindGroup(0, cached.group);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    return !(scented && !top) && !(filmy && !wet) && !(fanned && !grown);
  }

  /**
   * The pipelines of the scent view once they are built, else undefined; the first call starts their build, without
   * blocking. `wait`: resolves when they are built (exports and tests).
   */
  private scentNow(): ScentPipelines | undefined;
  private scentNow(wait: true): Promise<ScentPipelines>;
  private scentNow(wait = false): ScentPipelines | undefined | Promise<ScentPipelines> {
    if (!this.scentBuild) {
      const { device, module } = this;
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
      this.scentBuild = Promise.all([fill(false), fill(true)]).then(([down, sum]) => (this.scent = { down, sum }));
      // A failed build shows in the next frame that asks for the view.
      this.scentBuild.catch((err: unknown) => (this.scentError = err instanceof Error ? err : new Error(String(err))));
    }
    if (this.scentError) throw this.scentError;
    return wait ? this.scentBuild : this.scent;
  }

  private scentError: Error | undefined;

  /**
   * The pipelines of the film of the slime once they are built, else undefined; the first call starts their build,
   * without blocking, as scentNow() does. `wait`: resolves when they are built (exports and tests).
   */
  private slimeNow(): SlimePipelines | undefined;
  private slimeNow(wait: true): Promise<SlimePipelines>;
  private slimeNow(wait = false): SlimePipelines | undefined | Promise<SlimePipelines> {
    if (!this.slimeBuild) {
      const { device, module, layout, format } = this;
      const render = (env: boolean) =>
        device.createRenderPipelineAsync(renderPipeline(device, module, layout, format, env, 'SLIME'));
      const map = (entryPoint: string, uses: GPUBindGroupLayout, env?: boolean) =>
        device.createRenderPipelineAsync({
          layout: device.createPipelineLayout({ bindGroupLayouts: [uses] }),
          vertex: { module, entryPoint: 'vs' },
          fragment: {
            module,
            entryPoint,
            targets: [{ format: FILM_FORMAT }],
            ...(env === undefined ? {} : { constants: { ENV: Number(env) } }),
          },
        });
      this.slimeBuild = Promise.all([
        render(false),
        render(true),
        map('slimeFilm', this.filmLayout, false),
        map('slimeFilm', this.filmLayout, true),
        map('slimeDown', this.filmDownLayout),
      ]).then(([off, on, bare, walled, down]) => (this.slime = { render: [off, on], film: [bare, walled], down }));
      // A failed build shows in the next frame that asks for the film.
      this.slimeBuild.catch((err: unknown) => (this.slimeError = err instanceof Error ? err : new Error(String(err))));
    }
    if (this.slimeError) throw this.slimeError;
    return wait ? this.slimeBuild : this.slime;
  }

  private slimeError: Error | undefined;

  /**
   * The pipelines of the skirt of the growth front once they are built, else undefined; the first call starts their
   * build, without blocking, as slimeNow() does. `wait`: resolves when they are built (exports and tests).
   */
  private frontNow(): FrontPipelines | undefined;
  private frontNow(wait: true): Promise<FrontPipelines>;
  private frontNow(wait = false): FrontPipelines | undefined | Promise<FrontPipelines> {
    if (!this.frontBuild) {
      const { device, module, layout, format } = this;
      const render = (env: boolean) =>
        device.createRenderPipelineAsync(renderPipeline(device, module, layout, format, env, 'FRONT'));
      const map = device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.frontLayout] }),
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'frontMap', targets: [{ format: FRONT_FORMAT }] },
      });
      this.frontBuild = Promise.all([render(false), render(true), map]).then(
        ([off, on, filled]) => (this.frontPasses = { render: [off, on], map: filled }),
      );
      // A failed build shows in the next frame that asks for the skirt.
      this.frontBuild.catch((err: unknown) => (this.fanError = err instanceof Error ? err : new Error(String(err))));
    }
    if (this.fanError) throw this.fanError;
    return wait ? this.frontBuild : this.frontPasses;
  }

  private fanError: Error | undefined;

  /**
   * The render passes with the scent view over what lies below it (`below`), once they are built, else undefined; the
   * first call starts their build, without blocking. `wait`: resolves when they are built.
   */
  private viewNow(below: Below): Variants | undefined;
  private viewNow(below: Below, wait: true): Promise<Variants>;
  private viewNow(below: Below, wait = false): Variants | undefined | Promise<Variants> {
    const set = this.viewed[below];
    if (!set.build) {
      const { device, module, layout, format } = this;
      const part = VIEW_PARTS[below];
      const render = (env: boolean) =>
        device.createRenderPipelineAsync(renderPipeline(device, module, layout, format, env, part));
      set.build = Promise.all([render(false), render(true)]).then(([off, on]) => (set.ready = [off, on]));
      set.build.catch((err: unknown) => (set.error = err instanceof Error ? err : new Error(String(err))));
    }
    if (set.error) throw set.error;
    return wait ? set.build : set.ready;
  }

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

  /** The map of the film of the slime for a trail of this size (one texel per cell), made anew with the size. */
  private filmFor(trail: GPUTexture): GPUTextureView {
    if (this.film?.texture.width !== trail.width || this.film.texture.height !== trail.height) {
      this.film?.texture.destroy();
      const texture = this.device.createTexture({
        size: [trail.width, trail.height],
        format: FILM_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.film = { texture, view: texture.createView() };
      [this.filmHolds, this.filmCoarseHolds] = [undefined, undefined];
      this.groups = new WeakMap();
    }
    return this.film.view;
  }

  /** The map of the growth front for a trail of this size (texels of 2^FRONT_LEVEL cells), made anew with the size. */
  private youngFor(trail: GPUTexture): GPUTextureView {
    const [width, height] = [levelSize(trail.width, FRONT_LEVEL), levelSize(trail.height, FRONT_LEVEL)];
    if (this.young?.texture.width !== width || this.young.texture.height !== height) {
      this.young?.texture.destroy();
      const texture = this.device.createTexture({
        size: [width, height],
        format: FRONT_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.young = { texture, view: texture.createView() };
      this.youngHolds = undefined;
      this.groups = new WeakMap();
    }
    return this.young.view;
  }

  /** The coarse map of the film for a trail of this size (half its sides, rounded up), made anew with the size. */
  private filmCoarseFor(trail: GPUTexture): GPUTextureView {
    const [width, height] = [levelSize(trail.width, 1), levelSize(trail.height, 1)];
    if (this.filmCoarse?.texture.width !== width || this.filmCoarse.texture.height !== height) {
      this.filmCoarse?.texture.destroy();
      const texture = this.device.createTexture({
        size: [width, height],
        format: FILM_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.filmCoarse = { texture, view: texture.createView() };
      this.filmCoarseHolds = undefined;
      this.groups = new WeakMap();
    }
    return this.filmCoarse.view;
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
    [this.filmHolds, this.filmCoarseHolds] = [undefined, undefined];
    this.youngHolds = undefined;
  }

  destroy() {
    this.uniform.destroy();
    this.heights?.texture.destroy();
    this.coarse?.texture.destroy();
    this.trailCoarse?.texture.destroy();
    this.film?.texture.destroy();
    this.filmCoarse?.texture.destroy();
    this.young?.texture.destroy();
    this.noCoarse.destroy();
  }
}
