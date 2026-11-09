// WebGL2 resources, counting and readback in a real browser (ADR 0003, ADR 0010).
import { describe, expect, it } from 'vitest';
import { defaultSettings, defaultStrain, type Settings } from '../../model/params';
import type { AgentState } from '../types';
import { WebGl2Backend } from './backend';
import { compile } from './programs';
import { GlSim } from './sim';

/**
 * A canvas whose WebGL2 context counts live textures, framebuffers and renderbuffers, records
 * synchronous readPixels calls, and can fail a completeness check.
 */
function countingCanvas() {
  const live = { textures: 0, framebuffers: 0, renderbuffers: 0 };
  const syncReads: number[] = [];
  let checks = 0;
  let failAt = Infinity;
  const canvas = document.createElement('canvas');
  const getContext = canvas.getContext.bind(canvas);
  const wrap = (gl: WebGL2RenderingContext) =>
    new Proxy(gl, {
      get(t, key) {
        switch (key) {
          case 'createTexture':
            return () => (live.textures++, t.createTexture());
          case 'deleteTexture':
            return (x: WebGLTexture | null) => {
              if (x) live.textures--;
              t.deleteTexture(x);
            };
          case 'createFramebuffer':
            return () => (live.framebuffers++, t.createFramebuffer());
          case 'deleteFramebuffer':
            return (x: WebGLFramebuffer | null) => {
              if (x) live.framebuffers--;
              t.deleteFramebuffer(x);
            };
          case 'createRenderbuffer':
            return () => (live.renderbuffers++, t.createRenderbuffer());
          case 'deleteRenderbuffer':
            return (x: WebGLRenderbuffer | null) => {
              if (x) live.renderbuffers--;
              t.deleteRenderbuffer(x);
            };
          case 'checkFramebufferStatus':
            return (target: number) => (++checks === failAt ? 0 : t.checkFramebufferStatus(target));
          case 'readPixels':
            return (...a: unknown[]) => {
              if (ArrayBuffer.isView(a[6])) syncReads.push(performance.now());
              (t.readPixels as (...b: unknown[]) => void)(...a);
            };
        }
        const v: unknown = Reflect.get(t, key);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
  canvas.getContext = ((type: string, attrs?: WebGLContextAttributes) => {
    const gl = getContext(type, attrs);
    return gl instanceof WebGL2RenderingContext ? wrap(gl) : gl;
  }) as unknown as typeof canvas.getContext;
  return { canvas, live, syncReads, failAt: (n: number) => (failAt = checks + n) };
}

/** A WebGL2 context with float render targets, and whether it blends 32-bit floats. */
function context(canvas = document.createElement('canvas')) {
  const gl = canvas.getContext('webgl2');
  if (!gl?.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 with float render targets needed');
  return { gl, prog: compile(gl), floatBlend: gl.getExtension('EXT_float_blend') !== null };
}

/** Both counting paths where the GPU has float blending, else the half-float path only. */
const PATHS = [false, ...(context().floatBlend ? [true] : [])];

const settingsWith = (patch: Partial<Settings>): Settings => ({ ...defaultSettings(), ...patch });

/** Lets every microtask queued so far run, but not the next task (timers, GPU callbacks). */
async function microtasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function alivePerStrain(agents: AgentState[], strains: number) {
  const n = Array<number>(strains).fill(0);
  for (const a of agents) if (a.bits & 4) n[a.bits & 3] = (n[a.bits & 3] ?? 0) + 1;
  return n;
}

it('frees every texture and framebuffer of a half-built simulation', async () => {
  const { canvas, live, failAt } = countingCanvas();
  const backend = WebGl2Backend.create(canvas);
  const before = { ...live };
  let failures = 0;
  // Fail the 1st, 2nd, ... render target until the simulation is complete.
  for (let n = 1; n < 64; n++) {
    failAt(n);
    let sim;
    try {
      sim = await backend.createSim(defaultSettings(), 64, 32, 100);
    } catch {
      failures++;
      expect(live, `failed at render target ${n}`).toEqual(before);
      continue;
    }
    sim.destroy();
    expect(live).toEqual(before);
    break;
  }
  failAt(Infinity);
  expect(failures).toBeGreaterThanOrEqual(9); // agents ×2, trail ×2, scent ×2, counts, env, tally (+ collisions ×3)
  backend.destroy();
});

describe.each(PATHS)('float blending %s', (floatBlend) => {
  it('counts alive agents exactly, without a synchronous readback', async () => {
    const { canvas, syncReads } = countingCanvas();
    const { gl, prog } = context(canvas);
    const strains = [0, 1].map((i) => defaultStrain(i));
    const sim = new GlSim(gl, prog, settingsWith({ strains, shrink: 0.002 }), 64, 64, 100_000, floatBlend);
    sim.run(50); // some agents die
    syncReads.length = 0;
    const pending = sim.alive();
    let settled = false;
    void pending.then(() => (settled = true));
    await microtasks();
    expect(settled).toBe(false);
    const alive = await pending;
    expect(syncReads).toEqual([]);
    const expected = alivePerStrain(await sim.readAgents(), 2);
    expect(expected[0]).toBeLessThan(50_000);
    expect(alive).toEqual(expected);
    sim.destroy();
  });

  it('finish() resolves only after the GPU has run the work, never within the same task', async () => {
    const { gl, prog } = context();
    const sim = new GlSim(gl, prog, defaultSettings(), 256, 256, 65_536, floatBlend);
    sim.run(5);
    let done = false;
    const finished = sim.finish().then(() => (done = true));
    await microtasks();
    expect(done).toBe(false);
    await finished;
    expect(done).toBe(true);
    sim.destroy();
  });
});
