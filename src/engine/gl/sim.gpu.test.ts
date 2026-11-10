// WebGL2 resources, counting and readback in a real browser (ADR 0003, ADR 0010).
import { describe, expect, it } from 'vitest';
import { BOUNDARIES, defaultSettings, defaultStrain, STYLES, type Settings } from '../../model/params';
import { AgentToolKind } from '../pack';
import { BYTES_PER_CELL, BYTES_PER_CELL_HALF_FLOAT } from '../sizing';
import type { AgentState } from '../types';
import { WebGl2Backend } from './backend';
import { fence } from './gl';
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

describe.each(PATHS)('float blending %s', (floatBlend) => {
  it('frees every texture, framebuffer and renderbuffer of a half-built simulation', () => {
    const { canvas, live, failAt } = countingCanvas();
    const { gl, prog } = context(canvas);
    const before = { ...live };
    let failures = 0;
    // Fail the 1st, 2nd, ... render target until the simulation is complete.
    for (let n = 1; n < 64; n++) {
      failAt(n);
      let sim;
      try {
        sim = new GlSim(gl, prog, defaultSettings(), 64, 32, 100, floatBlend);
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
    // agents ×2, trail ×2, scent ×2, counts, env, tally; then collisions ×3 or the counting panels (×2 checks)
    expect(failures).toBeGreaterThanOrEqual(floatBlend ? 12 : 11);
  });

  // Half floats count exactly to 2048 only; condensed networks hold thousands of agents per cell.
  it('counts deposits exactly far above 2048 agents per cell and strain', async () => {
    const { gl, prog } = context();
    const strains = [0, 1, 2].map((i) => defaultStrain(i));
    // One cell on a periodic grid: every agent moves into it.
    const sim = new GlSim(gl, prog, settingsWith({ strains, shrink: 0 }), 1, 1, 100_000, floatBlend);
    sim.run(1);
    const counts = Array.from(await sim.readCounts());
    const expected = alivePerStrain(await sim.readAgents(), 3);
    expect(expected.every((n) => n > 30_000)).toBe(true); // over 100 carries of 256 each
    expect(counts).toEqual([...expected, 0]);
    // The deposit uses these counts: trail = keep · deposit · count after one step from zero.
    const trail = Array.from(await sim.readTrail());
    for (let s = 0; s < 3; s++) expect(trail[s] ?? 0).toBeCloseTo(0.9 * 5 * (expected[s] ?? 0), -1);
    sim.destroy();
  });

  // Without float blending each (cell, strain) has its own pixel in a 2 × 2 panel layout (deposit()):
  // grids that are not square catch a swapped width and height. The layout puts hundreds of agents of
  // each strain in the central cells, so the carries count too.
  it.each([
    [80, 24],
    [24, 80],
    [72, 40],
  ])('counts every cell and strain of a %i × %i grid exactly', async (w, h) => {
    const { gl, prog } = context();
    const strains = [0, 1, 2, 3].map((i) => defaultStrain(i));
    const settings = settingsWith({ strains, layout: 'center', shrink: 0 });
    const sim = new GlSim(gl, prog, settings, w, h, 12 * w * h, floatBlend);
    sim.run(1);
    // Every agent moves on a periodic grid without walls, so the counts are where the agents now are.
    const expected = new Array<number>(w * h * 4).fill(0);
    for (const a of await sim.readAgents()) {
      const [x, y] = [((Math.floor(a.x) % w) + w) % w, ((Math.floor(a.y) % h) + h) % h];
      if (a.bits & 4) expected[(y * w + x) * 4 + (a.bits & 3)] = (expected[(y * w + x) * 4 + (a.bits & 3)] ?? 0) + 1;
    }
    expect(Math.max(...expected)).toBeGreaterThan(256);
    expect(Array.from(await sim.readCounts())).toEqual(expected);
    sim.destroy();
  });

  // Without float blending the stencil holds the count mod 256 and the carry its 256s (deposit()).
  it.each([1, 255, 256, 257, 511, 512, 513, 65_535, 65_537])('counts exactly in a cell with n = %i', async (n) => {
    const { gl, prog } = context();
    const sim = new GlSim(gl, prog, settingsWith({ strains: [defaultStrain(0)], shrink: 0 }), 1, 1, n, floatBlend);
    sim.run(1);
    expect(Array.from(await sim.readCounts())).toEqual([n, 0, 0, 0]);
    sim.destroy();
  });

  it('counts alive agents exactly, without a synchronous readback', async () => {
    const { canvas, syncReads } = countingCanvas();
    const { gl, prog } = context(canvas);
    const strains = [0, 1].map((i) => defaultStrain(i));
    const sim = new GlSim(gl, prog, settingsWith({ strains, shrink: 0.004 }), 64, 64, 40_000, floatBlend);
    sim.run(20); // some agents die
    syncReads.length = 0;
    const pending = sim.alive();
    let settled = false;
    void pending.then(() => (settled = true));
    await microtasks();
    expect(settled).toBe(false);
    const alive = await pending;
    expect(syncReads).toEqual([]);
    const expected = alivePerStrain(await sim.readAgents(), 2);
    expect(expected[0]).toBeLessThan(20_000);
    expect(expected[0]).toBeGreaterThan(2048); // a single half-float pixel would stop there
    expect(alive).toEqual(expected);
    sim.destroy();
  });

  it('finish() resolves only after the GPU has run the work, never within the same task', async () => {
    const { gl, prog } = context();
    // 300 000 agents for 10 steps: longer than a task on the GPUs we test with (Metal, SwiftShader).
    const sim = new GlSim(gl, prog, defaultSettings(), 512, 288, 300_000, floatBlend);
    sim.run(10);
    const before = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!before) throw new Error('fenceSync failed');
    let done = false;
    const finished = sim.finish().then(() => (done = true));
    await microtasks();
    expect(done).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    // The work must still run a task later, or a finish() that never asks the GPU would pass too.
    expect(gl.getSyncParameter(before, gl.SYNC_STATUS)).toBe(gl.UNSIGNALED);
    await finished;
    expect(gl.getSyncParameter(before, gl.SYNC_STATUS)).toBe(gl.SIGNALED);
    gl.deleteSync(before);
    sim.destroy();
  });
});

it('polls a fence about once per millisecond, not every 4 ms like nested timers', async () => {
  const { gl } = context();
  // The fence reads as unsignalled for its first 20 polls, as if the GPU were busy.
  const polls: number[] = [];
  const busy = new Proxy(gl, {
    get(t, key) {
      if (key === 'clientWaitSync')
        return (sync: WebGLSync, flags: number, timeout: number) => {
          polls.push(performance.now());
          return polls.length <= 20 ? t.TIMEOUT_EXPIRED : t.clientWaitSync(sync, flags, timeout);
        };
      const v: unknown = Reflect.get(t, key);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  expect(await fence(busy)).toBe(true);
  expect(polls.length).toBeGreaterThan(20);
  // From the sixth poll on, nested timers are clamped to at least 4 ms (HTML timer rules).
  const gaps = polls.slice(6).map((t, i) => t - (polls[i + 5] ?? t));
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  expect(median).toBeLessThan(3.5);
});

/**
 * A canvas whose WebGL2 context hides EXT_float_blend, so the backend takes the half-float path, and
 * records every blended draw into a 32-bit float color attachment. Chromium turns float blending on
 * together with EXT_color_buffer_float, so here such a draw would work; without EXT_float_blend it
 * fails with INVALID_OPERATION.
 */
function halfFloatCanvas() {
  const blended: string[] = [];
  const canvas = document.createElement('canvas');
  const getContext = canvas.getContext.bind(canvas);
  const float32 = (t: WebGL2RenderingContext, attachment: number) => {
    const param = (p: number) => t.getFramebufferAttachmentParameter(t.DRAW_FRAMEBUFFER, attachment, p) as number;
    if (param(t.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE) === t.NONE) return false;
    return (
      param(t.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE) === t.FLOAT && param(t.FRAMEBUFFER_ATTACHMENT_RED_SIZE) === 32
    );
  };
  canvas.getContext = ((type: string, attrs?: WebGLContextAttributes) => {
    const gl = getContext(type, attrs);
    if (!(gl instanceof WebGL2RenderingContext)) return gl;
    return new Proxy(gl, {
      get(t, key) {
        if (key === 'getExtension')
          return (name: string): unknown => (name === 'EXT_float_blend' ? null : t.getExtension(name));
        if (key === 'drawArrays')
          return (mode: number, first: number, count: number) => {
            const framebuffer = t.getParameter(t.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
            if (t.isEnabled(t.BLEND) && framebuffer)
              for (const attachment of [t.COLOR_ATTACHMENT0, t.COLOR_ATTACHMENT1])
                if (float32(t, attachment)) blended.push(`mode ${mode}, ${count} vertices`);
            t.drawArrays(mode, first, count);
          };
        const v: unknown = Reflect.get(t, key);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
  }) as unknown as typeof canvas.getContext;
  return { canvas, blended };
}

it('never blends into a 32-bit float target without float blending', async () => {
  const { canvas, blended } = halfFloatCanvas();
  const backend = WebGl2Backend.create(canvas);
  expect(backend.supportsCollisions).toBe(false);
  const strains = [0, 1, 2, 3].map((i) => defaultStrain(i));
  for (const boundary of BOUNDARIES)
    for (const diffusion of [0, 1, 2]) {
      const settings = settingsWith({ boundary, diffusion, strains, shrink: 0.001 });
      const sim = await backend.createSim(settings, 48, 32, 3000);
      sim.paint({ kind: 'food', from: [10, 10], to: [20, 12], radius: 3 });
      sim.paint({ kind: 'light', from: [30, 20], to: [30, 20], radius: 4 });
      sim.paint({ kind: 'wall', from: [5, 25], to: [40, 25], radius: 1 });
      sim.paint({ kind: 'erase', from: [20, 25], to: [20, 25], radius: 2 });
      sim.run(3, { kind: AgentToolKind.inoculate, x: 24, y: 16, radius: 6, strain: 1, revive: 0.5, teleport: 0.3 });
      sim.run(2, { kind: AgentToolKind.cut, x: 12, y: 12, radius: 4, strain: 0, revive: 0, teleport: 0 });
      const view = { center: [24, 16] as [number, number], scale: 0.5 };
      for (const style of STYLES) {
        backend.draw(sim, { ...settings, style }, view, true);
        await backend.capture(sim, { ...settings, style }, view, 32, 32);
      }
      await backend.settle(sim);
      await sim.alive();
      sim.destroy();
    }
  backend.destroy();
  expect(blended).toEqual([]);
});

describe.each(PATHS)('backend, float blending %s', (floatBlend) => {
  const create = () => WebGl2Backend.create(floatBlend ? document.createElement('canvas') : halfFloatCanvas().canvas);

  it('reports the memory and grid limits of its counting path', () => {
    const backend = create();
    expect(backend.supportsCollisions).toBe(floatBlend);
    expect(backend.bytesPerCell).toBe(floatBlend ? BYTES_PER_CELL : BYTES_PER_CELL_HALF_FLOAT);
    backend.destroy();
  });

  // The gel height field has a one-cell border, so it is two texels larger than the grid (backend.ts).
  it.each([true, false])('draws a grid at the largest side it reports, in every style (wide %s)', async (wide) => {
    const backend = create();
    const side = backend.maxGridSide;
    const sim = await backend.createSim(defaultSettings(), wide ? side : 16, wide ? 16 : side, 64);
    for (const style of STYLES) {
      const settings = settingsWith({ style });
      const img = await backend.capture(sim, settings, { center: [8, 8], scale: 1 }, 8, 8);
      expect(img.width, style).toBe(8);
    }
    sim.destroy();
    backend.destroy();
  });
});
