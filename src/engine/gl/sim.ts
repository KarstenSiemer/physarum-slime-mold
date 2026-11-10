import type { Boundary, Settings } from '../../model/params';
import { scissorRects } from '../brush';
import { packParams, PARAMS_BYTES, START_ROUNDS, type AgentTool } from '../pack';
import { diffusePlan } from '../sizing';
import { EnvKind, type AgentState, type Sim, type Stroke } from '../types';
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
  private readonly tally: Target;
  private readonly mrt: Pair<WebGLFramebuffer>;
  private collision?: { occ: Pair<Target>; claims: Target };
  /** A wall was painted since the last clear: moves then check every cell they cross (agents.frag clearPath). */
  private walls = false;
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

  get envTexture(): WebGLTexture {
    return this.env.texture;
  }

  get countsTexture(): WebGLTexture {
    return this.counts.texture;
  }

  update(settings: Settings) {
    const switchedOn = settings.collisions && !this.settings.collisions;
    this.settings = settings;
    if (switchedOn) this.rebuildOccupancy();
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
   * One agent per cell from the first step (ADR 0008), as in sim.ts: START_ROUNDS claim rounds after init. A round
   * counts the cells taken so far, lets every waiting agent claim its cell (points.vert kind 5, MAX blending) and
   * settles the claims (init.frag).
   */
  private placeOnFreeCells() {
    const gl = this.gl;
    const col = this.ensureCollision();
    const occ = col.occ[flip(this.q)];
    for (let round = 0; round < START_ROUNDS; round++) {
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
      const mode = round === START_ROUNDS - 1 ? 2 : 1;
      this.pass(this.prog.init, this.agentsTex[flip(this.a)], textures, { agentWidth: this.agentWidth, mode });
      this.a = flip(this.a);
    }
  }

  run(steps: number, tool?: AgentTool) {
    for (let k = 0; k < steps; k++) {
      this.writeParams(k === 0 ? tool : undefined);
      this.encodeStep();
      this.step++;
    }
  }

  /**
   * Paints brush strokes in order. Every draw is scissored to the cells its brush can reach (brush.ts), and the
   * parameters, color mask and blending change only where the boundary or the kind of brush changes.
   */
  paint(strokes: readonly Stroke[]) {
    if (strokes.length === 0) return;
    const gl = this.gl;
    const p = this.prog.paint;
    let boundary: Boundary | undefined;
    let kind = -1;
    for (const stroke of strokes) {
      const b = stroke.boundary ?? this.settings.boundary;
      if (b !== boundary) {
        this.writeParams(undefined, 0, b);
        boundary = b;
      }
      if (kind === -1) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.env.fbo);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(p.program);
        gl.enable(gl.SCISSOR_TEST);
      }
      const k = EnvKind[stroke.kind];
      if (k !== kind) {
        gl.colorMask(...(MASKS[k] ?? [true, true, true, true]));
        if (k === EnvKind.light) this.blend(gl.MAX);
        else gl.disable(gl.BLEND);
        gl.uniform1i(p.loc('kind'), k);
        kind = k;
      }
      if (k === EnvKind.wall) this.walls = true;
      gl.uniform2f(p.loc('from'), ...stroke.from);
      gl.uniform2f(p.loc('to'), ...stroke.to);
      gl.uniform1f(p.loc('radius'), stroke.radius);
      for (const r of scissorRects(stroke, this.width, this.height, b === 'wrap')) {
        gl.scissor(...r);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.BLEND);
  }

  clearEnvironment() {
    clear(this.gl, this.env);
    this.walls = false;
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

  readCounts(): Promise<Float32Array> {
    return Promise.resolve(readTarget(this.gl, this.counts) as Float32Array);
  }

  readEnv(): Promise<Uint8Array> {
    return Promise.resolve(readTarget(this.gl, this.env) as Uint8Array);
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

  writeEnv(data: Uint8Array) {
    writeTarget(this.gl, this.env, 0, 0, this.width, this.height, data);
    this.walls = data.some((v, i) => i % 4 === 0 && v > 0);
  }

  destroy() {
    const gl = this.gl;
    const all = [...this.agentsTex, ...this.trail, ...this.scent, this.counts, this.env, this.tally];
    if (this.panels) all.push(this.panels);
    if (this.collision) all.push(...this.collision.occ, this.collision.claims);
    for (const t of all) destroyTarget(gl, t);
    for (const f of this.mrt) gl.deleteFramebuffer(f);
    gl.deleteBuffer(this.ubo);
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

  private encodeStep() {
    const gl = this.gl;
    const dummy = this.counts.texture; // for the unused samplers of the agent passes, which never draw into it
    const agentPass = (mode: number, src: Target, dst: Target, occ: WebGLTexture, claims: WebGLTexture) => {
      this.pass(
        this.prog.agents,
        dst,
        {
          agentsIn: src.texture,
          trail: this.trail[this.p].texture,
          scent: this.scent[this.p].texture,
          env: this.env.texture,
          occ,
          claims,
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
      this.points(1, col.claims, gl.MAX, B);
      agentPass(2, B, A, occ.texture, col.claims.texture);
      const next = col.occ[flip(this.q)];
      clear(gl, next);
      this.points(2, next, gl.FUNC_ADD);
      this.q = flip(this.q);
    }
    this.deposit();
    for (const v of diffusePlan(this.settings.diffusion)) {
      const out = flip(this.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mrt[out]);
      gl.viewport(0, 0, this.width, this.height);
      const d = this.prog.diffuse;
      gl.useProgram(d.program);
      textures(gl, d.program, {
        trailIn: this.trail[this.p].texture,
        scentIn: this.scent[this.p].texture,
        counts: this.counts.texture,
        env: this.env.texture,
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
    // env and occ are read for kind 5 only, but bound always: an active sampler on the target is a feedback loop.
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
