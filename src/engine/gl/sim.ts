import type { Boundary, Settings } from '../../model/params';
import { outlineRects, paintSegments, PendingOutlines, scissorRects, unionRects, type Rect } from '../brush';
import { CLEAR_TILE, packParams, PARAMS_BYTES, startRounds, trailSaturation, type AgentTool } from '../pack';
import { diffusePlan } from '../sizing';
import { EnvKind, SHAPE_RANGE, type AgentState, type EnvTool, type Sim, type Stroke } from '../types';
import {
  clear,
  destroyTarget,
  fence,
  readTarget,
  readTargetAsync,
  stencilTarget,
  target,
  textures,
  uniformBlock,
  writeTarget,
  type GL,
  type Target,
} from './gl';
import { PARAMS_BINDING, type Program, type Programs } from './programs';

type Pair<T> = [T, T];
type Bit = 0 | 1;
const flip = (b: Bit): Bit => (b === 0 ? 1 : 0);
const AGENT_ROW = 2048;
/** Side of the alive tally target (points.vert kind 3): 128² pixels keep every pixel sum exact. */
const TALLY_SIDE = 128;
/** Channels a brush writes: erase and walls all, food only green, light only blue (the maximum of old and new). */
const MASKS: Record<number, [boolean, boolean, boolean, boolean]> = {
  [EnvKind.erase]: [true, true, true, true],
  [EnvKind.wall]: [true, true, true, true],
  [EnvKind.food]: [false, true, false, false],
  [EnvKind.light]: [false, false, true, false],
};
/** Side of the tiles syncShape() copies the outline target in: 1 MiB at a time. */
const REFRESH_TILE = 512;

/** Cells of some rectangles. */
const area = (rects: readonly Rect[]) => rects.reduce((sum, [, , w, h]) => sum + w * h, 0);

/** About the cells deep in a segment, where its subtraction writes 0 (SHAPE_RANGE cells inside its brush). */
function core({ from: a, to: b, radius }: Stroke) {
  const rho = Math.max(radius - SHAPE_RANGE, 0);
  return 2 * rho * Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.PI * rho * rho;
}

/** A draw of shape.frag: its `op`, the channels it writes (R wall, G food, B light, A shadow), its blend equation. */
type OutlineDraw = [number, [boolean, boolean, boolean, boolean], 'MAX' | 'MIN' | null];
/**
 * How shape.frag applies a run's segments of a kind to the outline target: per segment over its outline box the
 * union (op 0, MAX blending) or the subtraction (op 1, MIN blending); then, once per cell of the union of the
 * segments' boxes, the hold of the subtracted layers (op 4, MIN blending) and the light and the shadow (op 2). The
 * hold, the light and the shadow depend only on `env` after the run, so overlapping boxes need them once.
 */
const OUTLINE_DRAWS: Record<EnvTool, { segment: OutlineDraw[]; hold?: OutlineDraw; run: OutlineDraw[] }> = {
  erase: {
    segment: [[1, [true, true, false, false], 'MIN']],
    hold: [4, [true, true, false, false], 'MIN'],
    run: [[2, [false, false, true, true], null]],
  },
  wall: {
    segment: [
      [0, [true, false, false, false], 'MAX'],
      [1, [false, true, false, false], 'MIN'],
    ],
    hold: [4, [false, true, false, false], 'MIN'],
    run: [[2, [false, false, true, true], null]],
  },
  food: { segment: [[0, [false, true, false, false], 'MAX']], run: [] },
  light: { segment: [], run: [[2, [false, false, true, false], null]] },
};

/** The simulation with WebGL2 fragment passes (ADR 0003); same model and parameters as sim.ts. */
export class GlSim implements Sim {
  step = 0;
  readonly agentWidth: number;
  private settings: Settings;
  private readonly ubo: WebGLBuffer;
  private readonly paramData = new ArrayBuffer(PARAMS_BYTES);
  private readonly agentsTex: Pair<Target>;
  readonly trail: Pair<Target>;
  private readonly scent: Pair<Target>;
  private readonly counts: Target;
  /** Without float blending: one panel per strain with a stencil, for exact counts (deposit()). */
  private readonly panels: Target | undefined;
  private readonly env: Target;
  /** Distances to the painted outlines, the light and the walls' drop shadow, for the renderer only (shape.frag). */
  private readonly shape: Target;
  /**
   * False until something other than the eraser is painted after the last clear; the renderer then skips the
   * environment.
   */
  hasEnvironment = false;
  /**
   * The boundary under which every byte of the outline target is held to `env`. After a change of boundary, or after
   * strokes painted under another boundary (then undefined), syncShape() holds it again before its next use.
   */
  private shapeHeld: Boundary | undefined;
  /** Where the outlines of the run that paint() draws next lie (brush.ts). */
  private readonly pending: PendingOutlines;
  /**
   * Whether walls, food and light were painted since the last clear: without them their bytes are all 0 (the
   * shadow too, without walls). A pass cannot read the bytes it changes, so it would compute them all anew.
   */
  private readonly layers = [false, false, false];
  private readonly tally: Target;
  private readonly mrt: Pair<WebGLFramebuffer>;
  private collision?: { occ: Pair<Target>; claims: Target };
  /**
   * Without float blending (no collision targets): 1 where a cell holds an agent after the moves, for covered food
   * (diffuse.frag COVERED). Allocated at its first use.
   */
  private presence: Target | undefined;
  /**
   * A wall was painted since the last clear: moves and sensors then check every cell they cross (agents.frag
   * clearPath, ADR 0020).
   */
  private walls = false;
  /** Per clearance tile: whether it holds a wall cell, and how far the nearest wall lies at least (walls.frag). */
  private readonly walled: Target;
  private readonly clearance: Target;
  private a: Bit = 0;
  private p: Bit = 0;
  private q: Bit = 0;

  constructor(
    private readonly gl: GL,
    private readonly prog: Programs,
    settings: Settings,
    readonly width: number,
    readonly height: number,
    readonly agents: number,
    private readonly floatBlend: boolean,
  ) {
    this.settings = settings;
    this.shapeHeld = settings.boundary;
    this.pending = new PendingOutlines(width, height);
    this.agentWidth = Math.min(agents, AGENT_ROW);
    const agentHeight = Math.ceil(agents / this.agentWidth);
    const made: Target[] = [];
    const t = (w: number, h: number, f: number) => {
      const x = target(gl, w, h, f);
      made.push(x);
      return x;
    };
    this.ubo = uniformBlock(gl, PARAMS_BYTES, PARAMS_BINDING);
    try {
      this.agentsTex = [t(this.agentWidth, agentHeight, gl.RGBA32F), t(this.agentWidth, agentHeight, gl.RGBA32F)];
      this.trail = [t(width, height, gl.RGBA32F), t(width, height, gl.RGBA32F)];
      this.scent = [t(width, height, gl.RG32F), t(width, height, gl.RG32F)];
      // Float blending sums the counts directly. Without it, deposit() counts in half floats with a
      // stencil and writes the sums here.
      this.counts = t(width, height, gl.RGBA32F);
      if (!floatBlend) {
        const p = stencilTarget(gl, 2 * width, 2 * height, gl.RG16F);
        made.push(p);
        this.panels = p;
      }
      this.env = t(width, height, gl.RGBA8);
      this.shape = t(width, height, gl.RGBA8);
      const [tx, ty] = [Math.ceil(width / CLEAR_TILE), Math.ceil(height / CLEAR_TILE)];
      this.walled = t(tx, ty, gl.R32F);
      this.clearance = t(tx, ty, gl.R32F);
      this.tally = t(TALLY_SIDE, TALLY_SIDE, floatBlend ? gl.RGBA32F : gl.RGBA16F);
      // Collisions need float blending. Allocated now, so a failure is freed below; the budget counts them.
      if (floatBlend) {
        const r = () => t(width, height, gl.R32F);
        this.collision = { occ: [r(), r()], claims: r() };
      }
    } catch (err) {
      // The engine retries with a smaller grid: a half-built simulation must not keep its memory.
      for (const x of made) destroyTarget(gl, x);
      gl.deleteBuffer(this.ubo);
      throw err;
    }
    this.mrt = [0, 1].map((i) => {
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.trail[i as Bit].texture, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.scent[i as Bit].texture, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      return fbo;
    }) as Pair<WebGLFramebuffer>;
    this.reset();
  }

  get currentTrail(): Target {
    return this.trail[this.p];
  }

  /** The scent of the same state as currentTrail: both alternate together. */
  get currentScent(): Target {
    return this.scent[this.p];
  }

  get countsTexture(): WebGLTexture {
    return this.counts.texture;
  }

  get shapeTexture(): WebGLTexture {
    return this.shape.texture;
  }

  /** Agents per cell after the last step, kept in collision mode only; none without float blending. */
  get occupancyTexture(): WebGLTexture | undefined {
    return this.collision?.occ[this.q].texture;
  }

  update(settings: Settings) {
    const switchedOn = settings.collisions && !this.settings.collisions;
    this.settings = settings;
    if (switchedOn) this.rebuildOccupancy();
    // The memory fit counts `presence` only while covered food is on (sizing.ts).
    if (!settings.coveredFood && this.presence) {
      destroyTarget(this.gl, this.presence);
      this.presence = undefined;
    }
  }

  reset() {
    const gl = this.gl;
    this.step = 0;
    this.a = 0;
    this.p = 0;
    this.writeParams();
    for (const t of [...this.trail, ...this.scent, this.counts]) clear(gl, t);
    // Every sampler gets a texture that is not the target: an active sampler on the target is a feedback loop.
    const env = this.env.texture;
    const init = { env, agentsIn: env, occ: env, claims: env };
    this.pass(this.prog.init, this.agentsTex[0], init, { agentWidth: this.agentWidth, mode: 0 });
    if (this.settings.collisions) {
      this.placeOnFreeCells();
      this.rebuildOccupancy();
    }
  }

  /**
   * One agent per cell from the first step (ADR 0008), as in sim.ts: claim rounds after init (startRounds()). A round
   * counts the cells taken so far, lets every waiting agent claim its cell (points.vert kind 5, MAX blending) and
   * settles the claims (init.frag).
   */
  private placeOnFreeCells() {
    const gl = this.gl;
    const col = this.ensureCollision();
    const occ = col.occ[flip(this.q)];
    const rounds = startRounds(this.settings, this.walls);
    for (let round = 0; round < rounds; round++) {
      this.writeParams(undefined, round);
      clear(gl, occ);
      this.points(2, occ, gl.FUNC_ADD);
      clear(gl, col.claims);
      this.points(5, col.claims, gl.MAX, this.agentsTex[this.a], [0, 0, 0, 0], { occ: occ.texture });
      const textures = {
        env: this.env.texture,
        agentsIn: this.agentsTex[this.a].texture,
        occ: occ.texture,
        claims: col.claims.texture,
      };
      const mode = round === rounds - 1 ? 2 : 1;
      this.pass(this.prog.init, this.agentsTex[flip(this.a)], textures, { agentWidth: this.agentWidth, mode });
      this.a = flip(this.a);
    }
  }

  /** Runs `steps` simulation steps. The agent tool acts on every one of them (ADR 0023). */
  run(steps: number, tool?: AgentTool) {
    for (let k = 0; k < steps; k++) {
      this.writeParams(tool);
      this.encodeStep();
      this.step++;
    }
  }

  /**
   * Paints brush strokes in order, as segments that the pass paints exactly (brush.ts paintSegments). Every draw is
   * scissored to the cells its segment can reach (scissorRects), and the parameters, color mask and blending change
   * only where the boundary or the kind of brush changes. The outlines (shape.frag) follow in runs: the paint draws
   * of a run of segments, then their outline draws, so the render target changes twice per run and not twice per
   * segment. A run ends where the boundary changes or a segment of another kind meets it (brush.ts
   * PendingOutlines). Within a run the outlines give the bytes of one segment after another (ADR 0009), so one call
   * paints what one call per stroke paints.
   */
  paint(strokes: readonly Stroke[]) {
    if (strokes.length === 0) return;
    // After a change of boundary the outline target is held to `env` under the new one first. Strokes under another
    // boundary leave that to the next readback or frame (below), so one call paints what one call per stroke paints.
    if (this.shapeHeld !== undefined) this.syncShape();
    const gl = this.gl;
    const p = this.prog.paint;
    const run: { segment: Stroke; kind: EnvTool; rects: Rect[] }[] = [];
    let boundary: Boundary | undefined;
    let kind = -1; // the kind the paint state is set for; -1: the env target is not bound
    let foreign = false;
    const drawRun = () => {
      if (run.length === 0) return;
      this.drawOutlines(run);
      run.length = 0;
      this.pending.clear();
      kind = -1;
    };
    for (const stroke of strokes) {
      const b = stroke.boundary ?? this.settings.boundary;
      const wrap = b === 'wrap';
      const k = EnvKind[stroke.kind];
      if (b !== this.settings.boundary) foreign = true;
      if (k === EnvKind.wall) this.walls = true;
      if (k !== EnvKind.erase) {
        this.hasEnvironment = true;
        this.layers[k - 1] = true;
      }
      for (const segment of paintSegments(stroke, this.width, this.height, wrap)) {
        const rects = scissorRects(segment, this.width, this.height, wrap);
        if (rects.length === 0) continue; // outside a closed arena: no cell to paint or outline
        const reach = outlineRects(segment, this.width, this.height, wrap);
        if (b !== boundary || this.pending.meets(reach, k, wrap)) {
          drawRun(); // with the parameters of its own boundary
          if (b !== boundary) {
            this.writeParams(undefined, 0, b);
            boundary = b;
          }
        }
        if (kind === -1) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.env.fbo);
          gl.viewport(0, 0, this.width, this.height);
          gl.useProgram(p.program);
          gl.enable(gl.SCISSOR_TEST);
        }
        if (k !== kind) {
          gl.colorMask(...(MASKS[k] ?? [true, true, true, true]));
          if (k === EnvKind.light) this.blend(gl.MAX);
          else gl.disable(gl.BLEND);
          gl.uniform1i(p.loc('kind'), k);
          kind = k;
        }
        gl.uniform1f(p.loc('radius'), segment.radius);
        gl.uniform2f(p.loc('from'), ...segment.from);
        gl.uniform2f(p.loc('to'), ...segment.to);
        for (const r of rects) {
          gl.scissor(...r);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        run.push({ segment, kind: stroke.kind, rects: reach });
        this.pending.add(reach, k, wrap);
      }
    }
    drawRun();
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.BLEND);
    if (foreign) this.shapeHeld = undefined;
    // Without walls no pass reads the clearance: an erase then needs none, and compiles no program for walls.
    if (this.walls && strokes.some((s) => s.kind === 'wall' || s.kind === 'erase')) this.updateClearance();
  }

  /**
   * The clearance of every tile from the walls in `env` (walls.frag), which the agent pass reads to skip walks that
   * cannot meet a wall; needed again after every change of the walls (Simulation.updateClearance in sim.ts). The
   * first pass marks the tiles with a wall cell; its unused sampler `walled` gets another texture than the target.
   */
  private updateClearance() {
    const env = this.env.texture;
    const { walls } = this.prog.walled();
    this.pass(walls, this.walled, { env, walled: this.clearance.texture }, { mode: 0 });
    this.pass(walls, this.clearance, { env, walled: this.walled.texture }, { mode: 1 });
  }

  clearEnvironment() {
    clear(this.gl, this.env);
    clear(this.gl, this.shape);
    this.walls = false;
    this.hasEnvironment = false;
    this.shapeHeld = this.settings.boundary;
    this.layers.fill(false);
  }

  /**
   * Holds the outline target to `env` under the current boundary (shape.frag op 3, see Simulation.syncShape()), once
   * after the boundary changed or after strokes under another boundary. Op 3 reads the bytes before from a copy,
   * made one tile at a time so the copy stays small.
   */
  syncShape() {
    if (this.shapeHeld === this.settings.boundary) return;
    this.shapeHeld = this.settings.boundary;
    if (!this.hasEnvironment) return; // nothing painted: the target holds only zeros, under every boundary
    const gl = this.gl;
    this.writeParams();
    const [tw, th] = [Math.min(this.width, REFRESH_TILE), Math.min(this.height, REFRESH_TILE)];
    const copy = target(gl, tw, th, gl.RGBA8);
    gl.enable(gl.SCISSOR_TEST);
    for (let y = 0; y < this.height; y += th)
      for (let x = 0; x < this.width; x += tw) {
        const [w, h] = [Math.min(tw, this.width - x), Math.min(th, this.height - y)];
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.shape.fbo);
        gl.bindTexture(gl.TEXTURE_2D, copy.texture);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, x, y, w, h);
        gl.scissor(x, y, w, h);
        this.pass(this.prog.shape, this.shape, { env: this.env.texture, old: copy.texture }, { op: 3 }, (p) => {
          gl.uniform2i(p.loc('tile'), x, y);
        });
      }
    gl.disable(gl.SCISSOR_TEST);
    destroyTarget(gl, copy);
  }

  /** Resolves when the GPU has finished all work issued so far (a fence, polled without blocking). */
  async finish(): Promise<void> {
    await fence(this.gl);
  }

  /**
   * Alive agents per strain. The GPU sums them into a 128² target, which is read back asynchronously
   * and summed on the CPU, so the main thread never waits for the GPU. Exact up to 2^24 agents with
   * 32- or 16-bit float blending (points.vert kind 3).
   */
  async alive(): Promise<number[]> {
    const gl = this.gl;
    const strains = this.settings.strains.length;
    this.writeParams();
    clear(gl, this.tally);
    this.points(3, this.tally, gl.FUNC_ADD);
    const px = await readTargetAsync(gl, this.tally);
    const sums = [0, 0, 0, 0];
    for (let i = 0; i < px.length; i += 4) for (let s = 0; s < 4; s++) sums[s] = (sums[s] ?? 0) + (px[i + s] ?? 0);
    return sums.slice(0, strains).map(Math.round);
  }

  readAgents(): Promise<AgentState[]> {
    const data = readTarget(this.gl, this.agentsTex[this.a]);
    return Promise.resolve(
      Array.from({ length: this.agents }, (_, i) => ({
        x: data[i * 4] ?? 0,
        y: data[i * 4 + 1] ?? 0,
        heading: data[i * 4 + 2] ?? 0,
        bits: Math.round(data[i * 4 + 3] ?? 0) & 7, // strain and alive; GL-only markers dropped
      })),
    );
  }

  readTrail(): Promise<Float32Array> {
    return Promise.resolve(readTarget(this.gl, this.currentTrail) as Float32Array);
  }

  readScent(): Promise<Float32Array> {
    // readTarget() reads 4 channels per cell; the scent target holds 2.
    const rgba = readTarget(this.gl, this.scent[this.p]);
    return Promise.resolve(
      Float32Array.from({ length: (rgba.length / 4) * 2 }, (_, i) => rgba[(i >> 1) * 4 + (i & 1)] ?? 0),
    );
  }

  readCounts(): Promise<Float32Array> {
    return Promise.resolve(readTarget(this.gl, this.counts) as Float32Array);
  }

  readEnv(): Promise<Uint8Array> {
    return Promise.resolve(readTarget(this.gl, this.env) as Uint8Array);
  }

  readShape(): Promise<Uint8Array> {
    this.syncShape();
    return Promise.resolve(readTarget(this.gl, this.shape) as Uint8Array);
  }

  /** Agent `index` is its texel: WebGL2 never reorders agents, so the slot is the id (ADR 0005). */
  writeAgent(index: number, a: AgentState) {
    if (!Number.isInteger(index) || index < 0 || index >= this.agents) throw new RangeError(`No agent ${index}.`);
    const x = index % this.agentWidth;
    const y = Math.floor(index / this.agentWidth);
    writeTarget(this.gl, this.agentsTex[this.a], x, y, 1, 1, new Float32Array([a.x, a.y, a.heading, a.bits & 7]));
  }

  writeTrail(data: Float32Array) {
    writeTarget(this.gl, this.currentTrail, 0, 0, this.width, this.height, data);
  }

  /**
   * For tests. The outline target cannot know the distances of an environment written as bytes: it is cleared, and
   * its next use holds it to `env` (syncShape()), so the sign of every outline byte, the light and the shadow follow
   * `env`.
   */
  writeEnv(data: Uint8Array) {
    writeTarget(this.gl, this.env, 0, 0, this.width, this.height, data);
    clear(this.gl, this.shape);
    const any = (channel: number) => data.some((v, i) => i % 4 === channel && v > 0);
    this.walls = any(0);
    [0, 1, 2].forEach((c) => (this.layers[c] = any(c)));
    this.hasEnvironment = this.layers.some(Boolean);
    this.shapeHeld = undefined;
    if (this.walls) {
      this.writeParams(); // binds this simulation's parameters for the passes
      this.updateClearance();
    }
  }

  destroy() {
    const gl = this.gl;
    const all = [...this.agentsTex, ...this.trail, ...this.scent, this.counts, this.env, this.shape, this.tally];
    all.push(this.walled, this.clearance);
    if (this.panels) all.push(this.panels);
    if (this.presence) all.push(this.presence);
    if (this.collision) all.push(...this.collision.occ, this.collision.claims);
    for (const t of all) destroyTarget(gl, t);
    for (const f of this.mrt) gl.deleteFramebuffer(f);
    gl.deleteBuffer(this.ubo);
  }

  /**
   * Draws the outlines of a run of segments that paint() has applied to `env` (shape.frag), kind by kind
   * (OUTLINE_DRAWS): in a run, segments of different kinds have boxes that do not meet (PendingOutlines), so their
   * draws touch other cells. Scissors cut every draw to the grid in a closed arena and split it where it crosses the
   * edge of the periodic grid. The Params block holds the run's boundary.
   */
  private drawOutlines(run: readonly { segment: Stroke; kind: EnvTool; rects: readonly Rect[] }[]) {
    const gl = this.gl;
    const sp = this.prog.shape;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shape.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(sp.program);
    // `old` (op 3) is never read here, but its unit must not hold the target: a frame binds it there.
    textures(gl, sp.program, { env: this.env.texture, old: this.env.texture });
    gl.enable(gl.SCISSOR_TEST);
    const [walls, food, light] = this.layers;
    const draw = ([op, all, equation]: OutlineDraw, rects: readonly Rect[], hold = false, core = false) => {
      // Only the layers that hold anything: a subtraction of food or walls, the light and the shadow.
      const mask: [boolean, boolean, boolean, boolean] =
        op === 1 || op === 4
          ? [all[0] && !!walls, all[1] && !!food, false, false]
          : [all[0], all[1], all[2] && !!light, all[3] && !!walls];
      if (!mask.some(Boolean)) return;
      gl.colorMask(...mask);
      if (equation) this.blend(gl[equation]);
      else gl.disable(gl.BLEND);
      gl.uniform1i(sp.loc('op'), op);
      gl.uniform1i(sp.loc('hold'), Number(hold));
      gl.uniform1i(sp.loc('core'), Number(core));
      gl.uniform2i(sp.loc('layers'), Number(mask[0]), Number(mask[1]));
      for (const r of rects) {
        gl.scissor(...r);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
    const byKind: Partial<Record<EnvTool, (typeof run)[number][]>> = {};
    for (const item of run) (byKind[item.kind] ??= []).push(item);
    for (const [kind, items] of Object.entries(byKind) as [EnvTool, (typeof run)[number][]][]) {
      const { segment, hold, run: after } = OUTLINE_DRAWS[kind];
      // The rectangles of one segment do not overlap (outlineRects): they are their own union.
      const union = () => (items.length === 1 ? (items[0]?.rects ?? []) : unionRects(items.flatMap((i) => i.rects)));
      const cells = hold || after.length > 0 ? union() : [];
      // The hold once per cell of the union, or with each segment's subtraction, without the cells it set to 0,
      // whichever searches fewer cells: a drag's boxes overlap, a single large eraser is mostly such cells. Then an
      // eraser's light and shadow per segment too, where its deep cells cost nothing.
      const each = !!hold && items.reduce((sum, i) => sum + area(i.rects) - core(i.segment), 0) < area(cells);
      const late = each && kind === 'erase';
      for (const { segment: s, rects } of items) {
        gl.uniform2f(sp.loc('from'), ...s.from);
        gl.uniform2f(sp.loc('to'), ...s.to);
        gl.uniform1f(sp.loc('radius'), s.radius);
        for (const d of segment) draw(d, rects, each && d[0] === 1);
        if (late) for (const d of after) draw(d, rects, false, true);
      }
      if (hold && !each) draw(hold, cells);
      if (!late) for (const d of after) draw(d, cells);
    }
  }

  /** `boundary` replaces the current one for a brush stroke (Stroke.boundary); the next step writes it back. */
  private writeParams(tool?: AgentTool, round = 0, boundary = this.settings.boundary) {
    const gl = this.gl;
    const s = boundary === this.settings.boundary ? this.settings : { ...this.settings, boundary };
    const rt = {
      width: this.width,
      height: this.height,
      agents: this.agents,
      step: this.step,
      tool,
      walls: this.walls,
      round,
    };
    gl.bindBufferBase(gl.UNIFORM_BUFFER, PARAMS_BINDING, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Uint8Array(packParams(s, rt, this.paramData)));
  }

  /**
   * The agent pass for the walls and the trail saturation of the current settings. Only the extended model's sensors
   * check for walls on the way (SENSE_WALLS, ADR 0020 and 0022).
   */
  private agentProgram(): Program {
    const senseWalls = this.walls && this.settings.model === 'extended';
    if (trailSaturation(this.settings) > 0) {
      const p = this.prog.saturated();
      return senseWalls ? p.walled : p.agents;
    }
    return senseWalls ? this.prog.walled().agents : this.prog.agents;
  }

  /**
   * The agents per cell after this step's moves, for covered food (diffuse.frag COVERED): collision mode counts them
   * anyway. Without it they are counted here, into the collision target that is not current (additive, which needs
   * float blending), or else into `presence` (1 per cell with an agent, in 8 bits).
   */
  private occupancyAfterMoves(): WebGLTexture {
    const gl = this.gl;
    if (this.settings.collisions) return this.ensureCollision().occ[this.q].texture;
    if (this.floatBlend && this.collision) {
      const next = this.collision.occ[flip(this.q)];
      clear(gl, next);
      this.points(2, next, gl.FUNC_ADD);
      this.q = flip(this.q);
      return next.texture;
    }
    this.presence ??= target(gl, this.width, this.height, gl.R8);
    clear(gl, this.presence);
    this.points(2, this.presence, gl.FUNC_ADD);
    return this.presence.texture;
  }

  private encodeStep() {
    const gl = this.gl;
    const dummy = this.counts.texture; // for the unused samplers of the agent passes, which never draw into it
    const agentProgram = this.agentProgram();
    const agentPass = (mode: number, src: Target, dst: Target, occ: WebGLTexture, claims: WebGLTexture) => {
      this.pass(
        agentProgram,
        dst,
        {
          agentsIn: src.texture,
          trail: this.trail[this.p].texture,
          scent: this.scent[this.p].texture,
          env: this.env.texture,
          occ,
          claims,
          clearance: this.clearance.texture,
        },
        { agentWidth: this.agentWidth, mode },
      );
    };
    const col = this.settings.collisions ? this.ensureCollision() : undefined;
    if (!col) {
      agentPass(0, this.agentsTex[this.a], this.agentsTex[flip(this.a)], dummy, dummy);
      this.a = flip(this.a);
    } else {
      const [A, B] = [this.agentsTex[this.a], this.agentsTex[flip(this.a)]];
      const occ = col.occ[this.q];
      agentPass(1, A, B, occ.texture, dummy);
      clear(gl, col.claims);
      // A tool's spot needs the occupancy (tools.glsl placement).
      this.points(1, col.claims, gl.MAX, B, [0, 0, 0, 0], { occ: occ.texture });
      agentPass(2, B, A, occ.texture, col.claims.texture);
      const next = col.occ[flip(this.q)];
      clear(gl, next);
      this.points(2, next, gl.FUNC_ADD);
      this.q = flip(this.q);
    }
    this.deposit();
    const covered = this.settings.coveredFood;
    // The unused sampler `occ` gets a texture that is no target of the diffusion pass.
    const occ = covered ? this.occupancyAfterMoves() : this.env.texture;
    for (const v of diffusePlan(this.settings.diffusion)) {
      const out = flip(this.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mrt[out]);
      gl.viewport(0, 0, this.width, this.height);
      const d = covered && v.first ? this.prog.covered() : this.prog.diffuse;
      gl.useProgram(d.program);
      textures(gl, d.program, {
        trailIn: this.trail[this.p].texture,
        scentIn: this.scent[this.p].texture,
        counts: this.counts.texture,
        env: this.env.texture,
        occ,
      });
      gl.uniform1i(d.loc('first'), Number(v.first));
      gl.uniform1i(d.loc('last'), Number(v.last));
      gl.uniform1i(d.loc('blur'), Number(v.blur));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.p = out;
    }
  }

  /**
   * Agents that moved into each cell this step, per strain, into `counts`. With float blending, one
   * additive point per agent. Half floats count exactly only to 2048, and condensed networks gather
   * thousands of agents in a cell, so without float blending each (cell, strain) gets its own pixel in
   * a 2 × 2 panel layout, with an 8-bit stencil. One point pass: every agent increments the stencil
   * (mod 256), and the agent that finds it at 255 adds a carry (red). Then eight full-screen passes,
   * one per stencil bit, add 2^b to green where bit b is set, which copies the remainder into green.
   * The merge pass writes 256 · carry + remainder: exact up to 2048 · 256 = 524 288 agents per cell
   * and strain.
   */
  private deposit() {
    const gl = this.gl;
    const t = this.panels;
    if (!t) {
      clear(gl, this.counts);
      this.points(0, this.counts, gl.FUNC_ADD);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.width, t.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.stencilMask(0xff);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.EQUAL, 255, 0xff);
    gl.stencilOp(gl.INCR_WRAP, gl.INCR_WRAP, gl.INCR_WRAP);
    this.points(4, t, gl.FUNC_ADD, this.agentsTex[this.a], [1, 0, 0, 0]);
    const fill = this.prog.fill;
    gl.useProgram(fill.program);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    this.blend(gl.FUNC_ADD);
    for (let b = 0; b < 8; b++) {
      gl.stencilFunc(gl.EQUAL, 0xff, 1 << b);
      gl.uniform4f(fill.loc('value'), 0, 2 ** b, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    this.pass(this.prog.counts, this.counts, { panels: t.texture }, {});
  }

  /** One point per agent into a per-cell target (see points.vert), combined by `equation` blending. */
  private points(
    kind: number,
    dst: Target,
    equation: number,
    agents = this.agentsTex[this.a],
    unit: [number, number, number, number] = [0, 0, 0, 0],
    more: Record<string, WebGLTexture> = {},
  ) {
    const gl = this.gl;
    const p = this.prog.points;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    gl.useProgram(p.program);
    // Kinds 1 and 5 read env and occ. Both are bound always: an active sampler on the target is a feedback loop.
    textures(gl, p.program, { agents: agents.texture, env: this.env.texture, occ: this.env.texture, ...more });
    gl.uniform1i(p.loc('agentWidth'), this.agentWidth);
    gl.uniform1i(p.loc('kind'), kind);
    gl.uniform1i(p.loc('tallySide'), TALLY_SIDE);
    gl.uniform4f(p.loc('unit'), ...unit);
    this.blend(equation);
    gl.drawArrays(gl.POINTS, 0, this.agents);
    gl.disable(gl.BLEND);
  }

  private blend(equation: number) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendEquation(equation);
    gl.blendFunc(gl.ONE, gl.ONE);
  }

  /** Full-screen fragment pass into `dst` with textures and integer uniforms. */
  private pass(
    p: Program,
    dst: Target,
    tex: Record<string, WebGLTexture>,
    ints: Record<string, number>,
    extra?: (p: Program) => void,
  ) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    gl.useProgram(p.program);
    textures(gl, p.program, tex);
    for (const [name, v] of Object.entries(ints)) gl.uniform1i(p.loc(name), v);
    extra?.(p);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private ensureCollision() {
    if (!this.collision) {
      const gl = this.gl;
      const t = () => target(gl, this.width, this.height, gl.R32F);
      this.collision = { occ: [t(), t()], claims: t() };
    }
    return this.collision;
  }

  private rebuildOccupancy() {
    const col = this.ensureCollision();
    this.writeParams();
    const next = col.occ[flip(this.q)];
    clear(this.gl, next);
    this.points(2, next, this.gl.FUNC_ADD);
    this.q = flip(this.q);
  }
}
