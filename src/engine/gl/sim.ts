import type { Settings } from '../../model/params';
import { packParams, PARAMS_BYTES, type AgentTool } from '../pack';
import { diffusePlan } from '../sizing';
import { EnvKind, type AgentState, type Sim, type Stroke } from '../types';
import {
  clear,
  destroyTarget,
  readTarget,
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
  private readonly env: Target;
  private readonly tally: Target | undefined;
  private readonly mrt: Pair<WebGLFramebuffer>;
  private collision?: { occ: Pair<Target>; claims: Target };
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
      // Counts are small integers: exact in half floats too, which blend without EXT_float_blend.
      this.counts = t(width, height, floatBlend ? gl.RGBA32F : gl.RGBA16F);
      this.env = t(width, height, gl.RGBA8);
      this.tally = floatBlend ? t(1, 1, gl.RGBA32F) : undefined;
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
    this.pass(this.prog.init, this.agentsTex[0], { env: this.env.texture }, { agentWidth: this.agentWidth });
    if (this.settings.collisions) this.rebuildOccupancy();
  }

  run(steps: number, tool?: AgentTool) {
    for (let k = 0; k < steps; k++) {
      this.writeParams(k === 0 ? tool : undefined);
      this.encodeStep();
      this.step++;
    }
  }

  paint(stroke: Stroke) {
    const gl = this.gl;
    this.writeParams();
    const kind = EnvKind[stroke.kind];
    const mask: Record<number, [boolean, boolean, boolean, boolean]> = {
      0: [true, true, true, true],
      1: [true, true, true, true],
      2: [false, true, false, false],
      3: [false, false, true, false],
    };
    const [r, g, b, a] = mask[kind] ?? [true, true, true, true];
    gl.colorMask(r, g, b, a);
    if (kind === EnvKind.light) this.blend(gl.MAX);
    this.pass(this.prog.paint, this.env, {}, { kind }, (p) => {
      gl.uniform2f(p.loc('from'), ...stroke.from);
      gl.uniform2f(p.loc('to'), ...stroke.to);
      gl.uniform1f(p.loc('radius'), stroke.radius);
    });
    gl.colorMask(true, true, true, true);
    gl.disable(gl.BLEND);
  }

  clearEnvironment() {
    clear(this.gl, this.env);
  }

  finish(): Promise<void> {
    return Promise.resolve();
  }

  alive(): Promise<number[]> {
    if (!this.tally) return Promise.resolve([]);
    const gl = this.gl;
    this.writeParams();
    clear(gl, this.tally);
    this.points(3, this.tally, gl.FUNC_ADD);
    const px = new Float32Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tally.fbo);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
    return Promise.resolve(Array.from(px.slice(0, this.settings.strains.length), Math.round));
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

  writeAgent(index: number, a: AgentState) {
    const x = index % this.agentWidth;
    const y = Math.floor(index / this.agentWidth);
    writeTarget(this.gl, this.agentsTex[this.a], x, y, 1, 1, new Float32Array([a.x, a.y, a.heading, a.bits]));
  }

  writeTrail(data: Float32Array) {
    writeTarget(this.gl, this.currentTrail, 0, 0, this.width, this.height, data);
  }

  destroy() {
    const gl = this.gl;
    const all = [...this.agentsTex, ...this.trail, ...this.scent, this.counts, this.env];
    if (this.tally) all.push(this.tally);
    if (this.collision) all.push(...this.collision.occ, this.collision.claims);
    for (const t of all) destroyTarget(gl, t);
    for (const f of this.mrt) gl.deleteFramebuffer(f);
    gl.deleteBuffer(this.ubo);
  }

  private writeParams(tool?: AgentTool) {
    const gl = this.gl;
    const rt = { width: this.width, height: this.height, agents: this.agents, step: this.step, tool };
    gl.bindBufferBase(gl.UNIFORM_BUFFER, PARAMS_BINDING, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Uint8Array(packParams(this.settings, rt, this.paramData)));
  }

  private encodeStep() {
    const gl = this.gl;
    const dummy = this.counts.texture; // bound to unused samplers; never a render target here
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
    clear(gl, this.counts);
    this.points(0, this.counts, gl.FUNC_ADD);
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

  /** One point per agent into a per-cell target (see points.vert), combined by `equation` blending. */
  private points(kind: number, dst: Target, equation: number, agents = this.agentsTex[this.a]) {
    const gl = this.gl;
    const p = this.prog.points;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    gl.useProgram(p.program);
    textures(gl, p.program, { agents: agents.texture });
    gl.uniform1i(p.loc('agentWidth'), this.agentWidth);
    gl.uniform1i(p.loc('kind'), kind);
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
