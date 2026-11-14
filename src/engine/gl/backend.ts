import type { Settings } from '../../model/params';
import { at } from '../at';
import { levels, STRAND_BLEND, strandLevel } from '../exposure';
import { GpuUnavailableError, OutOfMemoryError } from '../gpu';
import { packView, trailLevel, VIEW_BYTES } from '../render';
import { levelSize, scentLevel, scentLevelSize } from '../scent';
import {
  BYTES_PER_AGENT_GL,
  BYTES_PER_CELL,
  BYTES_PER_CELL_HALF_FLOAT,
  COVERED_BYTES_PER_CELL_HALF_FLOAT,
  equilibrium,
} from '../sizing';
import type { Backend, Levels, View } from '../types';
import { clear, destroyTarget, readTargetAsync, target, textures, uniformBlock, type GL, type Target } from './gl';
import { compile, VIEW_BINDING, viewPrograms, type Program, type Programs } from './programs';
import { GlSim } from './sim';

const BLOOM_LEVELS = 5;
const SAMPLES = 160; // auto-levels sample grid width
const BINS = 64;

/** Fallback backend for browsers without WebGPU (ADR 0003). */
export class WebGl2Backend implements Backend<GlSim> {
  readonly kind = 'webgl2';
  readonly description: string;
  readonly lost: Promise<string>;
  readonly supportsCollisions: boolean;
  readonly maxAgents: number;
  readonly maxBufferBytes: number;
  readonly maxGridSide: number;
  readonly bytesPerCell: number;
  readonly bytesPerAgent = BYTES_PER_AGENT_GL;
  readonly coveredBytesPerCell: number;
  private readonly prog: Programs;
  /** For tests: the render programs of another version of render.frag that draw every frame (renderFrom()). */
  private fixed: [Program, Program] | undefined;
  private readonly viewUbo: WebGLBuffer;
  private readonly viewData = new ArrayBuffer(VIEW_BYTES);
  private bloomChain: Target[] = [];
  private sampleTarget: Target | undefined;
  /** Gel height field: one texel per cell plus a one-cell border (height.frag). */
  private heights: Target | undefined;
  /** The scent view's coarse map (scent-down.frag): half the grid's sides, rounded up. */
  private coarse: Target | undefined;
  /** What the coarse map holds: it is filled again only when the scent or the shape changed, or the level or arena. */
  private coarseHolds: { sim: GlSim; step: number; revision: number; level: number; boundary: string } | undefined;
  /** The trail's coarse map (trail-down.frag) for a view zoomed out: half the grid's sides, rounded up. */
  private trailCoarse: Target | undefined;
  /** What it holds: it is filled again only when the trail changed, or the level (render.ts `trailHolds`). */
  private trailHolds: { sim: GlSim; trail: WebGLTexture; step: number; revision: number; level: number } | undefined;
  private frame = 0;
  private gain = 0;
  private black = 0;
  /** The trail of a strand (Levels.strand). */
  private strand = 0;
  /** The auto-levels measurement whose readback is still on its way. */
  private measuring: Promise<void> | undefined;
  /** Counts forget() calls: a readback of a replaced simulation must not change the new levels. */
  private generation = 0;

  private constructor(
    private readonly gl: GL,
    private readonly floatBlend: boolean,
    canvas: HTMLCanvasElement,
  ) {
    this.prog = compile(gl);
    this.viewUbo = uniformBlock(gl, VIEW_BYTES, VIEW_BINDING);
    this.supportsCollisions = floatBlend;
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    // Claim keys must stay below 2^24 (exact in float32); memory stays moderate on weaker GPUs.
    this.maxAgents = Math.min(2 ** 22, 2048 * maxTex);
    // The gel height field has a one-cell border (heightsFor()), two texels more than the grid. Without
    // float blending the counting panels (gl/sim.ts deposit()) are twice the grid on each side.
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    const side = Math.min(
      maxTex,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      viewport[0] ?? 0,
      viewport[1] ?? 0,
    );
    this.maxGridSide = Math.min(maxTex - 2, floatBlend ? maxTex : Math.floor(side / 2));
    this.bytesPerCell = floatBlend ? BYTES_PER_CELL : BYTES_PER_CELL_HALF_FLOAT;
    this.coveredBytesPerCell = floatBlend ? 0 : COVERED_BYTES_PER_CELL_HALF_FLOAT;
    this.maxBufferBytes = maxTex * maxTex * 16;
    this.description = `WebGL2 · ${String(gl.getParameter(gl.RENDERER))}`;
    this.lost = new Promise((resolve) => {
      canvas.addEventListener('webglcontextlost', () => {
        resolve('WebGL context lost');
      });
    });
  }

  static create(canvas: HTMLCanvasElement): WebGl2Backend {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new GpuUnavailableError('This browser supports neither WebGPU nor WebGL2.');
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new GpuUnavailableError('This browser cannot render to float textures (EXT_color_buffer_float).');
    }
    return new WebGl2Backend(gl, gl.getExtension('EXT_float_blend') !== null, canvas);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async to reject instead of throwing synchronously
  async createSim(settings: Settings, width: number, height: number, agents: number, start = agents): Promise<GlSim> {
    const gl = this.gl;
    while (gl.getError() !== gl.NO_ERROR); // clear stale errors
    let sim: GlSim;
    try {
      sim = new GlSim(gl, this.prog, settings, width, height, agents, this.floatBlend, Math.min(start, agents));
    } catch (err) {
      // GlSim frees what it allocated; only a real out-of-memory may trigger the step-down.
      if (gl.getError() === gl.OUT_OF_MEMORY) throw new OutOfMemoryError(String(err));
      throw err;
    }
    if (gl.getError() === gl.OUT_OF_MEMORY) {
      sim.destroy();
      throw new OutOfMemoryError('WebGL out of memory');
    }
    return sim;
  }

  draw(sim: GlSim, settings: Settings, view: View, measure: boolean) {
    const gl = this.gl;
    if (measure && this.frame % 15 === 0 && !this.measuring) void this.measure(sim, this.gain === 0 ? 1 : 0.25);
    const ready = this.encode(sim, settings, view, gl.drawingBufferWidth, gl.drawingBufferHeight);
    this.frame++;
    return ready;
  }

  async capture(
    sim: GlSim,
    settings: Settings,
    view: View,
    width: number,
    height: number,
    levels?: Levels,
  ): Promise<ImageData> {
    const gl = this.gl;
    // An export shows the scent view as asked: wait for its programs, unless the context is lost.
    while (settings.showScent && !this.fixed && !this.prog.scent() && !gl.isContextLost())
      await new Promise((r) => setTimeout(r, 2));
    // A rebuild can destroy the simulation during that wait. Then nothing is left to draw, and the engine asks
    // again for the new one (Engine.ofRun()).
    if (sim.destroyed) return new ImageData(width, height);
    const t = target(gl, width, height, gl.RGBA8);
    this.encode(sim, settings, view, width, height, t, levels);
    const pixels = new Uint8ClampedArray(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    destroyTarget(gl, t);
    // GL rows run bottom-up; ImageData rows top-down.
    const out = new Uint8ClampedArray(pixels.length);
    const row = width * 4;
    for (let y = 0; y < height; y++) out.set(pixels.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
    return new ImageData(out, width, height);
  }

  async settle(sim: GlSim): Promise<Levels> {
    await this.measure(sim, 1);
    return this.levels();
  }

  levels(): Levels {
    return { gain: this.gain, black: this.black, strand: this.strand };
  }

  async measured(sim: GlSim): Promise<Levels> {
    return (await this.read(sim)) ?? this.levels();
  }

  /**
   * For tests: draws every frame with another version of render.frag from now on, as the code before the scent view
   * did, or as shipped again when `frag` is undefined.
   */
  renderFrom(frag?: string) {
    this.fixed = frag === undefined ? undefined : viewPrograms(this.gl, frag);
  }

  forget() {
    this.coarseHolds = undefined;
    this.trailHolds = undefined;
    this.gain = 0;
    this.black = 0;
    this.strand = 0;
    this.generation++;
  }

  destroy() {
    for (const t of this.bloomChain) destroyTarget(this.gl, t);
    if (this.sampleTarget) destroyTarget(this.gl, this.sampleTarget);
    if (this.heights) destroyTarget(this.gl, this.heights);
    if (this.coarse) destroyTarget(this.gl, this.coarse);
    if (this.trailCoarse) destroyTarget(this.gl, this.trailCoarse);
    this.gl.deleteBuffer(this.viewUbo);
  }

  /**
   * Auto levels from a grid of trail samples (no compute shaders in WebGL2), read back without blocking.
   * Waits for a measurement that is still running, so `blend` 1 (settle) always gets its own.
   */
  private async measure(sim: GlSim, blend: number): Promise<void> {
    const l = await this.read(sim);
    if (!l) return;
    this.gain += (l.gain - this.gain) * blend;
    this.black += (l.black - this.black) * blend;
    this.strand += (l.strand - this.strand) * (blend === 1 || this.strand === 0 ? 1 : STRAND_BLEND);
  }

  /**
   * The levels measured now, without changing the levels that frames use: an export draws with them, and the line of
   * the scent view goes on from its smoothed strand (ADR 0009). Undefined for an (almost) empty field, a replaced
   * simulation or a lost context.
   */
  private async read(sim: GlSim): Promise<Levels | undefined> {
    while (this.measuring) await this.measuring;
    // A rebuild can destroy the simulation while this waits: then nothing asks it for its targets.
    if (sim.destroyed) return undefined;
    const run = this.sample(sim);
    this.measuring = run
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => (this.measuring = undefined));
    return run;
  }

  /**
   * The black level and the gain from the trail that the frame draws, and the strand from the trail of the model:
   * the frame draws another trail while it shows the picture of the tubes (ADR 0034). Both sets of samples are
   * drawn before any wait: a target may be freed while the readback is on its way.
   */
  private async sample(sim: GlSim): Promise<Levels | undefined> {
    const gl = this.gl;
    const generation = this.generation;
    const h = Math.max(1, Math.round((SAMPLES * sim.height) / sim.width));
    if (this.sampleTarget?.height !== h) {
      if (this.sampleTarget) destroyTarget(gl, this.sampleTarget);
      this.sampleTarget = target(gl, SAMPLES, h, gl.RGBA32F);
    }
    const t = this.sampleTarget;
    // Before the target is bound: the passes of the view and of the picture (gl/sim.ts) bind their own.
    const [drawn, model] = [sim.pictureTarget().texture, sim.viewTargets().trail.texture];
    const p = this.prog.sample;
    const read = (trail: WebGLTexture) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, t.width, t.height);
      gl.useProgram(p.program);
      textures(gl, p.program, { trail });
      gl.uniform2f(p.loc('outSize'), t.width, t.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // The pixels go to a buffer of their own now, so the next draw into the target does not change them.
      return readTargetAsync(gl, t);
    };
    const reads = drawn === model ? [read(drawn)] : [read(drawn), read(model)];
    let px: Float32Array[];
    try {
      px = await Promise.all(reads);
    } catch {
      return undefined; // context lost: nothing to measure
    }
    if (generation !== this.generation) return undefined;
    const binsOf = (samples: Float32Array) => {
      const bins = new Array<number>(BINS).fill(0);
      for (let i = 0; i < samples.length; i += 4) {
        const v = samples[i] ?? 0;
        if (v <= 0) continue;
        const b = Math.min(BINS - 1, Math.max(0, Math.floor((Math.log2(v) + 10) * 2)));
        bins[b] = (bins[b] ?? 0) + 1;
      }
      return bins;
    };
    const bins = binsOf(at(px, 0));
    const l = levels(bins, t.width * t.height);
    return l && { ...l, strand: strandLevel(px[1] ? binsOf(px[1]) : bins, t.width * t.height) };
  }

  /**
   * `given`: levels measured for this frame alone (an export), in place of those of the frames. False while the frame
   * draws without the scent view that it asks for: its programs are still being built.
   */
  private encode(
    sim: GlSim,
    s: Settings,
    view: View,
    width: number,
    height: number,
    dst?: Target,
    given?: Levels,
  ): boolean {
    const gl = this.gl;
    sim.syncShape();
    // The map after the step's diffusion in either order of a step, trail and scent alike (ADR 0027), made before any
    // target is bound: the view's passes (gl/sim.ts viewTargets()) bind their own. The trail is the picture of the tubes
    // while the settings show it (ADR 0034): every map below is made from the trail that is drawn.
    const viewScent = sim.viewTargets().scent.texture;
    const trail = sim.pictureTarget().texture;
    const agents = s.style === 'agents';
    const fallback = 0.4 / equilibrium(s);
    const l = given ?? this.levels();
    const exposure = (agents ? 0.4 / s.density : l.gain || fallback) * 2 ** s.exposure;
    const black = agents ? 0 : l.black;
    const bloom = this.runBloom(sim, s, exposure, black, trail);
    // Collision mode keeps the occupancy up to date; without float blending there is none (and no collisions).
    const occ = s.collisions ? sim.occupancyTexture : undefined;
    // The stream of the plasm, while the view draws the picture of the tubes (ADR 0034).
    const stream = sim.streamTarget()?.texture;
    const streamStep = stream ? sim.step : undefined;
    packView(
      this.viewData,
      width,
      height,
      view,
      exposure,
      black,
      s,
      this.frame,
      true,
      occ !== undefined,
      l.strand,
      streamStep,
    );
    gl.bindBufferBase(gl.UNIFORM_BUFFER, VIEW_BINDING, this.viewUbo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Uint8Array(this.viewData));
    const heights = this.heightsFor(sim);
    // Without food, light or walls the environment code would only cost time: the variant without it
    // draws the same pixels.
    const variant = sim.hasEnvironment ? 1 : 0;
    // A sampler that the program never reads still needs a texture: the counts stand in for the occupancy.
    const cells = { trail, shape: sim.shapeTexture, occ: occ ?? sim.countsTexture };
    // The gel style samples its height field nine times per pixel: once per frame at grid
    // resolution here, instead of nine full trail filters per pixel.
    if (s.style === 'gel') {
      const h = this.prog.height[variant];
      gl.bindFramebuffer(gl.FRAMEBUFFER, heights.fbo);
      gl.viewport(0, 0, heights.width, heights.height);
      gl.useProgram(h.program);
      textures(gl, h.program, cells);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // Zoomed out, a pixel reads the trail from a coarser map (trail-down.frag), filled when the trail or the level
    // changed.
    const trailMap = trailLevel(view.scale);
    const trailCoarse = trailMap > 0 ? this.trailCoarseFor(sim) : undefined;
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
      const fill = this.prog.trailDown();
      gl.bindFramebuffer(gl.FRAMEBUFFER, trailCoarse.fbo);
      gl.viewport(0, 0, levelSize(sim.width, trailMap), levelSize(sim.height, trailMap));
      gl.useProgram(fill.program);
      textures(gl, fill.program, { trail });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // The scent view once its programs are built; zoomed out it reads a coarser map, filled here.
    const scent = s.showScent && !this.fixed ? this.prog.scent() : undefined;
    const level = scentLevel(view.scale);
    const coarse = scent ? this.coarseFor(sim) : undefined;
    const holds = this.coarseHolds;
    // The share of a texel that holds scent changes only with the shape, the level or the arena; steps change only
    // the scent, and they leave none in walls or outside the dish (SUM_ONLY in scent-down.frag).
    const shaped =
      holds?.sim === sim && holds.revision === sim.revision && holds.level === level && holds.boundary === s.boundary;
    if (scent && coarse && level > 0 && !(shaped && holds.step === sim.step)) {
      this.coarseHolds = { sim, step: sim.step, revision: sim.revision, level, boundary: s.boundary };
      const fill = shaped ? scent.sum : scent.down;
      gl.bindFramebuffer(gl.FRAMEBUFFER, coarse.fbo);
      gl.viewport(0, 0, scentLevelSize(sim.width, level), scentLevelSize(sim.height, level));
      gl.useProgram(fill.program);
      textures(gl, fill.program, { trail, shape: sim.shapeTexture, scent: viewScent });
      if (shaped) gl.colorMask(true, true, false, false); // the share stays
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.colorMask(true, true, true, true);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst?.fbo ?? null);
    gl.viewport(0, 0, width, height);
    const p = (this.fixed ?? scent?.render ?? this.prog.render)[variant];
    gl.useProgram(p.program);
    // A sampler that the frame does not read still needs a texture: the trail stands in for its coarse map.
    const trailLevels = trailCoarse?.texture ?? trail;
    const all = {
      ...cells,
      counts: sim.countsTexture,
      bloom: bloom.texture,
      heights: heights.texture,
      trailLevels,
      // Without the picture of the tubes no frame reads the stream: the trail stands in.
      stream: stream ?? trail,
    };
    const scentLevels = coarse?.texture ?? viewScent;
    textures(gl, p.program, scent ? { ...all, scent: viewScent, scentLevels } : all);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return !(s.showScent && !this.fixed && !scent);
  }

  /** The scent view's coarse map for this grid size, made anew when the size changes. */
  private coarseFor(sim: GlSim): Target {
    const [w, h] = [scentLevelSize(sim.width, 1), scentLevelSize(sim.height, 1)];
    if (this.coarse?.width !== w || this.coarse.height !== h) {
      if (this.coarse) destroyTarget(this.gl, this.coarse);
      this.coarse = target(this.gl, w, h, this.gl.RGBA32F);
      this.coarseHolds = undefined;
    }
    return this.coarse;
  }

  /** The trail's coarse map for this grid size, made anew when the size changes. */
  private trailCoarseFor(sim: GlSim): Target {
    const [w, h] = [levelSize(sim.width, 1), levelSize(sim.height, 1)];
    if (this.trailCoarse?.width !== w || this.trailCoarse.height !== h) {
      if (this.trailCoarse) destroyTarget(this.gl, this.trailCoarse);
      this.trailCoarse = target(this.gl, w, h, this.gl.RGBA32F);
      this.trailHolds = undefined;
    }
    return this.trailCoarse;
  }

  /** The gel height field for this grid size, made anew when the size changes. */
  private heightsFor(sim: GlSim): Target {
    const [w, h] = [sim.width + 2, sim.height + 2];
    if (this.heights?.width !== w || this.heights.height !== h) {
      if (this.heights) destroyTarget(this.gl, this.heights);
      this.heights = target(this.gl, w, h, this.gl.R16F, true);
    }
    return this.heights;
  }

  /** Glow chain (bloom.frag); returns level 0, or an empty one when the glow is off. */
  private runBloom(sim: GlSim, s: Settings, gain: number, black: number, trail: WebGLTexture): Target {
    const gl = this.gl;
    const w = Math.ceil(sim.width / 2);
    const h = Math.ceil(sim.height / 2);
    if (this.bloomChain[0]?.width !== w || this.bloomChain[0].height !== h) {
      for (const t of this.bloomChain) destroyTarget(gl, t);
      this.bloomChain = Array.from({ length: BLOOM_LEVELS }, (_, i) =>
        target(gl, Math.max(1, Math.ceil(w / 2 ** i)), Math.max(1, Math.ceil(h / 2 ** i)), gl.RGBA16F, true),
      );
    }
    const chain = this.bloomChain;
    const first = at(chain, 0);
    if (!(s.bloom > 0 && s.style === 'glow')) {
      clear(gl, first);
      return first;
    }
    const wrapMode = s.boundary === 'wrap' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    const p = this.prog.bloom;
    gl.useProgram(p.program);
    const draw = (mode: number, dst: Target, src: Target | undefined, add: boolean) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.width, dst.height);
      if (src) {
        gl.bindTexture(gl.TEXTURE_2D, src.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode);
        gl.uniform2f(p.loc('texel'), 1 / src.width, 1 / src.height);
      }
      // A sampler may never read the texture being drawn into, even unused: give prefilter level 1.
      textures(gl, p.program, { src: (src ?? at(chain, 1)).texture, trail });
      gl.uniform2f(p.loc('outSize'), dst.width, dst.height);
      gl.uniform1i(p.loc('mode'), mode);
      if (add) {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE, gl.ONE);
      } else {
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    gl.uniform1f(p.loc('gain'), gain);
    gl.uniform1f(p.loc('black'), black);
    draw(0, first, undefined, false);
    for (let i = 1; i < BLOOM_LEVELS; i++) draw(1, at(chain, i), at(chain, i - 1), false);
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) draw(2, at(chain, i), at(chain, i + 1), true);
    gl.disable(gl.BLEND);
    return first;
  }
}
